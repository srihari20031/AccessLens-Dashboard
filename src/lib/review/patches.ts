/**
 * Validation for an uploaded AccessLens patch file.
 *
 * `accesslens fix <report.json> --json <file>` turns a scan of a local HTML file into a set of
 * proposed source edits: for each non-passing finding, either a concrete text edit anchored to
 * the line and column the scan recorded, or — where no machine may choose the right value — a
 * plain question for the page's owner. This module turns such a file into rows.
 *
 * Every byte of it is treated as hostile. `old_text` and `new_text` are raw markup lifted out
 * of a scanned page, and a `question` may quote it; the AI layer may have written some of it.
 * Nothing here is ever rendered as markup, and nothing here is ever applied to a file.
 *
 * Pure: no Next.js, no Supabase, no I/O. It decides nothing about any finding.
 *
 * Unlike `explanations.ts`, this parser is strict about the file's *shape* as well as its
 * values. The patch format is fixed and versioned — one object with `patch_schema_version: 1`,
 * `counts`, `report` and `patches` — so there is no older spelling to be generous towards, and
 * a file that does not say which version it is could be anything. Every value is then checked
 * on its own: a hash that is not lowercase hex, a status outside the five, a position that is
 * not a 1-based integer, or an edit longer than the database stores is dropped and counted,
 * never guessed and never half-kept.
 */

/** The five states the CLI reports, in the order the screen shows them. */
export const PATCH_STATUSES = [
  'ready',
  'needs-input',
  'conflict',
  'stale',
  'unsupported',
] as const;
export type PatchStatus = (typeof PATCH_STATUSES)[number];

/**
 * What each status is called on screen.
 *
 * Written out in words wherever a status is shown, so nothing about a patch's state depends on
 * a colour or a border. "Needs input" is a heading over work, not a failure: a question the
 * tool refuses to answer for you is the honest half of this feature.
 */
export const PATCH_STATUS_LABELS: Record<PatchStatus, string> = {
  ready: 'Edit ready to review',
  'needs-input': 'Question for you',
  conflict: 'Overlaps another edit',
  stale: 'File has changed since the scan',
  unsupported: 'No edit could be written',
};

/** One sentence per status, saying what it means and what a reader should do about it. */
export const PATCH_STATUS_NOTES: Record<PatchStatus, string> = {
  ready:
    'The text below matched the file when the patch was written, so the edit can be made as ' +
    'shown. Read it first: nothing has checked that it is the right fix, only that it applies.',
  'needs-input':
    'No machine may choose this value — an alt text, a heading level, a link name. The tool ' +
    'asks instead of guessing, and the answer is yours to write into the file.',
  conflict:
    'Two edits want the same stretch of the file, so neither was written out. Make them one ' +
    'at a time by hand, or re-run the scan after the first.',
  stale:
    'The file on disk no longer matches what the scan saw at this position, so the edit was ' +
    'not written. Scan the file again and produce a fresh patch set.',
  unsupported:
    'This rule has no edit generator yet. The finding stands exactly as the scanner reported ' +
    'it; the fix is a person’s to write.',
};

/** Who proposed the edit. Neither is a verdict: the finding is the scanner's either way. */
export const PATCH_SOURCES = ['rule', 'ai'] as const;
export type PatchSource = (typeof PATCH_SOURCES)[number];

/** How a patch's author is described. An AI-written edit is labelled, as the AI text is. */
export const PATCH_SOURCE_LABELS: Record<PatchSource, string> = {
  rule: 'Written by the rule that found the problem',
  ai: 'Drafted by a language model — review before use',
};

/** The only version of the format this build understands. */
export const PATCH_SCHEMA_VERSION = 1;

/** The same caps as `run_patches_sizes` in migration 0006. */
export const MAX_PATCH_TEXT_CHARS = 8000;
export const MAX_DESCRIPTION_CHARS = 500;
export const MAX_QUESTION_CHARS = 2000;
export const MAX_PATH_CHARS = 1000;
export const MAX_CRITERION_CHARS = 20;
export const MAX_RULE_ID_CHARS = 120;

/** One patch per non-passing finding; a scan of one file is nowhere near this. */
export const MAX_PATCHES = 5000;

/** Five megabytes, the same cap as a report upload. */
export const MAX_PATCHES_BYTES = 5 * 1024 * 1024;

export type PatchEntry = {
  finding_hash: string;
  criterion: string;
  rule_id: string;
  description: string;
  status: PatchStatus;
  source: PatchSource;
  path: string;
  start_line: number;
  start_column: number;
  /** Raw file text. Empty for an insertion. Never trimmed: whitespace is part of the edit. */
  old_text: string;
  /** Raw file text. Empty for a deletion. */
  new_text: string;
  /** The question a `needs-input` patch asks. Null when the file carried none. */
  question: string | null;
};

export type ParsedPatches = {
  entries: PatchEntry[];
  /** Patches that were recognisable but unusable, and duplicates after the first. */
  skipped: number;
  /** What the file says it was made from, for the sentence after an import. Never trusted. */
  target_url: string | null;
  report_kind: string | null;
};

export type PatchesResult =
  | { ok: true; value: ParsedPatches }
  | { ok: false; message: string; issues: string[] };

const HEX = /^[0-9a-f]+$/;
/** The same shape the report schema requires of a criterion. */
const CRITERION = /^\d+(\.\d+)*$/;

const NOT_A_PATCH_FILE =
  'That file is not an AccessLens patch file. Upload the JSON that ' +
  '"accesslens fix <report.json> --json <file>" writes.';

function failed(message: string, issues: string[] = []): PatchesResult {
  return { ok: false, message, issues };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A prose field: trimmed and truncated at the cap.
 *
 * Safe to shorten because nobody acts on a description or a question character by character —
 * they are read. The two edit texts are handled quite differently below.
 */
function prose(value: unknown, cap: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > cap ? trimmed.slice(0, cap) : trimmed;
}

/** A 1-based position. Anything that is not a whole number of at least 1 is not one. */
function position(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return null;
  return value;
}

function statusOf(value: unknown): PatchStatus | null {
  if (typeof value !== 'string') return null;
  const word = value.trim().toLowerCase();
  return (PATCH_STATUSES as readonly string[]).includes(word) ? (word as PatchStatus) : null;
}

function sourceOf(value: unknown): PatchSource | null {
  if (typeof value !== 'string') return null;
  const word = value.trim().toLowerCase();
  return (PATCH_SOURCES as readonly string[]).includes(word) ? (word as PatchSource) : null;
}

/**
 * One patch, or null if anything about it is wrong.
 *
 * The rule for the two edit texts is the one thing here worth arguing about. A description too
 * long for the column is truncated; an *edit* too long for the column is thrown away instead,
 * patch and all. A half an edit shown under the heading "the text this would put in its place"
 * is a lie about what would happen to somebody's file, and the cap (8000 characters for one
 * element's start tag) is far past anything the generators produce — so a patch that trips it
 * is a file worth refusing rather than a display to be tidied up.
 */
function readPatch(raw: unknown): PatchEntry | null {
  if (!isRecord(raw)) return null;

  const findingHash = typeof raw.finding_hash === 'string' ? raw.finding_hash : '';
  if (!HEX.test(findingHash)) return null;

  const status = statusOf(raw.status);
  if (status === null) return null;

  // Missing means "the file did not say", and a patch whose author is unknown is not shown as
  // either one. The CLI always writes it.
  const source = sourceOf(raw.source);
  if (source === null) return null;

  const startLine = position(raw.start_line);
  const startColumn = position(raw.start_column);
  if (startLine === null || startColumn === null) return null;

  const criterion = prose(raw.criterion, MAX_CRITERION_CHARS);
  if (!CRITERION.test(criterion)) return null;

  if (typeof raw.old_text !== 'string' || typeof raw.new_text !== 'string') return null;
  if (
    raw.old_text.length > MAX_PATCH_TEXT_CHARS ||
    raw.new_text.length > MAX_PATCH_TEXT_CHARS
  ) {
    return null;
  }

  const question = prose(raw.question, MAX_QUESTION_CHARS);

  return {
    finding_hash: findingHash,
    criterion,
    rule_id: prose(raw.rule_id, MAX_RULE_ID_CHARS),
    description: prose(raw.description, MAX_DESCRIPTION_CHARS),
    status,
    source,
    path: prose(raw.path, MAX_PATH_CHARS),
    start_line: startLine,
    start_column: startColumn,
    // Not trimmed, and not normalised: an edit is exactly the characters it is.
    old_text: raw.old_text,
    new_text: raw.new_text,
    question: question === '' ? null : question,
  };
}

/** The `report` block a patch file carries, for the sentence the screen prints after an import. */
function reportBlock(input: Record<string, unknown>): { url: string | null; kind: string | null } {
  const report = isRecord(input.report) ? input.report : {};
  const url = typeof report.target_url === 'string' ? report.target_url.slice(0, 2000) : '';
  const kind = typeof report.kind === 'string' ? report.kind.slice(0, 40) : '';
  return { url: url === '' ? null : url, kind: kind === '' ? null : kind };
}

/** Validate an already-parsed JSON value as a patch file. */
export function parsePatches(input: unknown): PatchesResult {
  if (!isRecord(input)) return failed(NOT_A_PATCH_FILE);

  const version = input.patch_schema_version;
  if (typeof version !== 'number' || !Number.isFinite(version)) return failed(NOT_A_PATCH_FILE);
  if (version !== PATCH_SCHEMA_VERSION) {
    return failed(
      `That patch file is written in schema version ${version}; this dashboard reads ` +
        `version ${PATCH_SCHEMA_VERSION}. Upgrade the dashboard, or produce the file with ` +
        'the version of AccessLens this one was built against.',
    );
  }

  const raw = input.patches;
  if (!Array.isArray(raw)) return failed(NOT_A_PATCH_FILE);
  if (raw.length === 0) {
    return failed(
      'That patch file is empty: it proposes no edits and asks no questions. ' +
        '"accesslens fix" writes an empty set when a report has nothing it can act on.',
    );
  }
  if (raw.length > MAX_PATCHES) {
    return failed(
      `That file holds ${raw.length} patches, over the ${MAX_PATCHES} this dashboard reads.`,
    );
  }

  const entries: PatchEntry[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const candidate of raw) {
    const entry = readPatch(candidate);
    // One patch per finding, as the CLI produces: a second one for the same finding would
    // overwrite the first in the table, so it is dropped here where it can be counted.
    if (entry === null || seen.has(entry.finding_hash)) {
      skipped += 1;
      continue;
    }
    seen.add(entry.finding_hash);
    entries.push(entry);
  }

  const { url, kind } = reportBlock(input);

  if (entries.length === 0) {
    return failed(
      'No usable patch was found in that file. A patch needs a lowercase-hex "finding_hash", ' +
        'a criterion, a status of ready, needs-input, unsupported, stale or conflict, a ' +
        'source of rule or ai, and a 1-based line and column.',
      [`${skipped} ${skipped === 1 ? 'patch was' : 'patches were'} unusable.`],
    );
  }

  return { ok: true, value: { entries, skipped, target_url: url, report_kind: kind } };
}

/** Text straight off an upload: a JSON error is reported the same way as a shape error. */
export function parsePatchesText(content: string): PatchesResult {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failed(
      'That file is not valid JSON. The patch file is exactly what "accesslens fix" writes ' +
        'with --json.',
      [detail],
    );
  }
  return parsePatches(value);
}

/**
 * Keep only the patches whose finding is in this run.
 *
 * The same guard as `entriesForRun` in `explanations.ts`, for the same reason: `run_patches`
 * has a foreign key onto `run_findings`, so the database would refuse the rest anyway, and
 * dropping them here means one clear sentence instead of a constraint error. It is also what
 * stops a patch file made from run A being poured into run B — which matters more here than it
 * does for text, because a patch names a file and a line in it.
 */
export function patchesForRun(
  entries: readonly PatchEntry[],
  findingHashes: Iterable<string>,
): { kept: PatchEntry[]; unknown: number } {
  const known = new Set(findingHashes);
  const kept = entries.filter((entry) => known.has(entry.finding_hash));
  return { kept, unknown: entries.length - kept.length };
}
