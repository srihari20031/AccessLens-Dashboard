/**
 * Validation for an uploaded AccessLens explanations file.
 *
 * `accesslens explain <report.json> --out <file>` writes one entry per distinct non-passing
 * finding: a plain-language explanation, a suggested fix and the model's stated confidence,
 * keyed by `finding_hash`. This module turns such a file into rows, and it treats every byte
 * of it as hostile — the text inside was written by a language model that was shown markup
 * taken from a scanned page, so both the page and the model are untrusted input here.
 *
 * Pure: no Next.js, no Supabase, no I/O. It decides nothing about any finding; it only reads
 * text that will be shown next to one.
 *
 * Deliberately tolerant about the file's *shape* and strict about every *value*. The CLI
 * writes canonical JSON, but the format has moved once already (the explanations file is a
 * newer artefact than the report), so a list, a `suggestions`/`explanations` list, and a plain
 * hash-keyed object are all accepted. What is never tolerated: a hash that is not lowercase
 * hex, a confidence outside low/medium/high, a value of the wrong type, or text over the
 * length the database will store. Anything that fails is dropped and counted, never guessed.
 */

export const CONFIDENCES = ['low', 'medium', 'high'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/** The same caps as `run_suggestions_sizes` in migration 0005. */
export const MAX_EXPLANATION_CHARS = 4000;
export const MAX_FIX_CHARS = 8000;

/** One entry per distinct non-passing finding; a crawl of a large site is still far under. */
export const MAX_ENTRIES = 5000;

/** Five megabytes, the same cap as a report upload. */
export const MAX_EXPLANATIONS_BYTES = 5 * 1024 * 1024;

export type SuggestionEntry = {
  finding_hash: string;
  explanation: string;
  fix: string;
  confidence: Confidence | null;
  model: string | null;
  prompt_version: string | null;
  rule_version: string | null;
};

export type ParsedExplanations = {
  entries: SuggestionEntry[];
  /** Entries that were recognisable but unusable, and duplicates after the first. */
  skipped: number;
};

export type ExplanationsResult =
  | { ok: true; value: ParsedExplanations }
  | { ok: false; message: string; issues: string[] };

const HEX = /^[0-9a-f]+$/;

function failed(message: string, issues: string[] = []): ExplanationsResult {
  return { ok: false, message, issues };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A string field, trimmed and capped. Anything else — a number, an object — is not text. */
function text(value: unknown, cap: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > cap ? trimmed.slice(0, cap) : trimmed;
}

/**
 * A short label such as a model name or a version.
 *
 * A version may be written as a number (`"prompt_version": 3`), so a finite number is read as
 * its decimal form. Nothing else becomes a label.
 */
function label(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed.slice(0, 120);
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function confidenceOf(value: unknown): Confidence | null {
  if (typeof value !== 'string') return null;
  const word = value.trim().toLowerCase();
  return (CONFIDENCES as readonly string[]).includes(word) ? (word as Confidence) : null;
}

/**
 * The entries of a file, as (hash-or-null, entry) pairs, whatever shape it came in.
 *
 * Returns null when the top level is not something that could hold entries at all, which is
 * the difference between "the wrong file" and "a file with bad entries in it".
 */
function locateEntries(input: unknown): [string | null, unknown][] | null {
  if (Array.isArray(input)) return input.map((entry) => [null, entry]);
  if (!isRecord(input)) return null;

  for (const key of ['suggestions', 'explanations', 'entries'] as const) {
    const found = input[key];
    if (Array.isArray(found)) return found.map((entry) => [null, entry]);
    if (isRecord(found)) return Object.entries(found).map(([hash, entry]) => [hash, entry]);
  }

  // A bare object keyed by finding hash. Only accepted when every key looks like one, so a
  // report (whose top level has "schema_version", "run", "findings") is not mistaken for it.
  const pairs = Object.entries(input);
  if (pairs.length > 0 && pairs.every(([key, value]) => HEX.test(key) && isRecord(value))) {
    return pairs;
  }
  return null;
}

function readEntry(hashFromKey: string | null, raw: unknown): SuggestionEntry | null {
  if (!isRecord(raw)) return null;

  const hash = hashFromKey ?? (typeof raw.finding_hash === 'string' ? raw.finding_hash : '');
  if (!HEX.test(hash)) return null;

  const explanation = text(raw.explanation, MAX_EXPLANATION_CHARS);
  // `fix` is what the CLI writes; `suggested_fix` is accepted as the obvious other spelling.
  const fix = text(raw.fix ?? raw.suggested_fix, MAX_FIX_CHARS);
  // An entry with neither is nothing to review. The CLI writes null for a finding it could
  // not explain, and a row of empty strings would show as a suggestion that is not there.
  if (explanation === '' && fix === '') return null;

  return {
    finding_hash: hash,
    explanation,
    fix,
    confidence: confidenceOf(raw.confidence),
    model: label(raw.model),
    prompt_version: label(raw.prompt_version),
    rule_version: label(raw.rule_version),
  };
}

/**
 * Validate an already-parsed JSON value as an explanations file.
 *
 * File-level `model` and `prompt_version` fill in for entries that carry none, because the
 * CLI records the request once for the whole file and the pair is part of what a reader needs
 * to tell one import from another.
 */
export function parseExplanations(input: unknown): ExplanationsResult {
  const located = locateEntries(input);
  if (located === null) {
    return failed(
      'That file is not an AccessLens explanations file. Upload the JSON that ' +
        '"accesslens explain <report.json> --out <file>" writes.',
    );
  }
  if (located.length === 0) {
    return failed('That explanations file is empty: it holds no suggestions.');
  }
  if (located.length > MAX_ENTRIES) {
    return failed(
      `That file holds ${located.length} entries, over the ${MAX_ENTRIES} this dashboard reads.`,
    );
  }

  const fileModel = isRecord(input) ? label(input.model) : null;
  const filePrompt = isRecord(input) ? label(input.prompt_version) : null;

  const entries: SuggestionEntry[] = [];
  const seen = new Set<string>();
  let skipped = 0;

  for (const [hashFromKey, raw] of located) {
    const entry = readEntry(hashFromKey, raw);
    if (entry === null || seen.has(entry.finding_hash)) {
      skipped += 1;
      continue;
    }
    seen.add(entry.finding_hash);
    entries.push({
      ...entry,
      model: entry.model ?? fileModel,
      prompt_version: entry.prompt_version ?? filePrompt,
    });
  }

  if (entries.length === 0) {
    return failed(
      'No usable suggestion was found in that file. An entry needs a lowercase-hex ' +
        '"finding_hash" and an "explanation" or a "fix".',
      [`${skipped} ${skipped === 1 ? 'entry was' : 'entries were'} unusable.`],
    );
  }

  return { ok: true, value: { entries, skipped } };
}

/** Text straight off an upload: a JSON error is reported the same way as a shape error. */
export function parseExplanationsText(content: string): ExplanationsResult {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failed(
      'That file is not valid JSON. The explanations file is exactly what ' +
        '"accesslens explain" writes with --out.',
      [detail],
    );
  }
  return parseExplanations(value);
}

/**
 * Keep only the entries whose finding is in this run.
 *
 * The HTML report does the same (it "ignores entries whose hash or criterion is not in the
 * report"), and the database would refuse the rest anyway: `run_suggestions` has a foreign key
 * onto `run_findings`. Dropping them here means one clear sentence instead of a constraint
 * error, and it is what stops an explanations file for run A being poured into run B.
 */
export function entriesForRun(
  entries: readonly SuggestionEntry[],
  findingHashes: Iterable<string>,
): { kept: SuggestionEntry[]; unknown: number } {
  const known = new Set(findingHashes);
  const kept = entries.filter((entry) => known.has(entry.finding_hash));
  return { kept, unknown: entries.length - kept.length };
}
