/**
 * Patch review (`public.run_patches` and `public.patch_reviews`, migration 0006), always read
 * and written as the signed-in user: row-level security limits every query here to rows
 * reachable through that user's own runs, and the trigger on `patch_reviews` stamps who decided
 * and when from their own token.
 *
 * Nothing in this module writes to `run_findings`. A decision never changes a finding.
 *
 * Nothing in this module touches a file, either. It stores proposed edits as text and reads
 * them back; there is no filesystem call anywhere in this feature, and `tests/patch-boundary.
 * test.ts` checks that there is not.
 */
import type { PatchDecision, PatchDecisionInput, PatchReviewRecord } from '@/lib/review/patch-decisions';
import { PATCH_DECISIONS } from '@/lib/review/patch-decisions';
import type { PatchEntry, PatchSource, PatchStatus } from '@/lib/review/patches';
import { PATCH_SOURCES, PATCH_STATUSES } from '@/lib/review/patches';
import { createClient } from '@/lib/supabase/server';

export type PatchRecord = PatchEntry & { imported_at: string };

/*
 * One string literal, not a concatenation: the Supabase client parses this at the type level
 * to work out the row shape, and a `+` in the middle of it leaves it with nothing to parse.
 */
const PATCH_COLUMNS =
  'finding_hash, criterion, rule_id, description, status, source, path, start_line, start_column, old_text, new_text, question, imported_at';
const PATCH_REVIEW_COLUMNS = 'finding_hash, decision, reason, decided_by_email, decided_at';

/** Written in batches: one statement per few hundred rows keeps a request well under any cap. */
const WRITE_CHUNK = 250;

/**
 * The two codes PostgREST returns for a table that is not there yet.
 *
 * Migration 0006 may not have been run, and the same "the rest of the dashboard still works"
 * rule as `loadReviewData` applies: the screen says which file to run rather than failing.
 */
function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asOptionalText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asPosition(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : 1;
}

function toPatch(row: Record<string, unknown>): PatchRecord {
  const status = asText(row.status);
  const source = asText(row.source);
  return {
    finding_hash: asText(row.finding_hash),
    criterion: asText(row.criterion),
    rule_id: asText(row.rule_id),
    description: asText(row.description),
    // A word this build does not know is read as "no edit could be written" rather than shown
    // as something it might not be: the one state that promises the reader nothing.
    status: (PATCH_STATUSES as readonly string[]).includes(status)
      ? (status as PatchStatus)
      : 'unsupported',
    source: (PATCH_SOURCES as readonly string[]).includes(source)
      ? (source as PatchSource)
      : 'rule',
    path: asText(row.path),
    start_line: asPosition(row.start_line),
    start_column: asPosition(row.start_column),
    old_text: asText(row.old_text),
    new_text: asText(row.new_text),
    question: asOptionalText(row.question),
    imported_at: asText(row.imported_at),
  };
}

function toPatchReview(row: Record<string, unknown>): PatchReviewRecord {
  const decision = asText(row.decision);
  return {
    finding_hash: asText(row.finding_hash),
    // An unknown word is read as no decision rather than shown as one: a state this build
    // does not understand must never be presented as a person's judgement.
    decision: (PATCH_DECISIONS as readonly string[]).includes(decision)
      ? (decision as PatchDecision)
      : 'pending',
    reason: asOptionalText(row.reason),
    decided_by_email: asOptionalText(row.decided_by_email),
    decided_at: asText(row.decided_at),
  };
}

export type PatchData = {
  patches: PatchRecord[];
  reviews: PatchReviewRecord[];
};

/**
 * Every patch and decision of one run, or null when migration 0006 has not been run.
 *
 * Both tables hold at most one row per finding, so they are read whole, exactly as
 * `loadReviewData` does.
 */
export async function loadPatchData(runId: string): Promise<PatchData | null> {
  const supabase = await createClient();
  const [patchesResult, reviewsResult] = await Promise.all([
    supabase.from('run_patches').select(PATCH_COLUMNS).eq('run_id', runId),
    supabase.from('patch_reviews').select(PATCH_REVIEW_COLUMNS).eq('run_id', runId),
  ]);

  if (patchesResult.error) {
    if (isMissingTable(patchesResult.error)) return null;
    throw new Error(patchesResult.error.message);
  }
  if (reviewsResult.error) {
    if (isMissingTable(reviewsResult.error)) return null;
    throw new Error(reviewsResult.error.message);
  }

  return {
    patches: (patchesResult.data ?? []).map((row) => toPatch(row as Record<string, unknown>)),
    reviews: (reviewsResult.data ?? []).map((row) =>
      toPatchReview(row as Record<string, unknown>),
    ),
  };
}

/**
 * Store the patches of a patch file against a run.
 *
 * An upsert on (run_id, finding_hash): importing the file twice replaces the proposed edits
 * rather than duplicating them, and leaves every decision where it was. The row's `imported_at`
 * moves, which is what lets the screen say a decision is older than the edit it is about.
 *
 * Every entry must already have been matched to a finding of this run (`patchesForRun`); the
 * foreign key onto `run_findings` refuses the rest anyway.
 */
export async function savePatches(
  runId: string,
  entries: readonly PatchEntry[],
): Promise<void> {
  const supabase = await createClient();
  for (let from = 0; from < entries.length; from += WRITE_CHUNK) {
    const rows = entries.slice(from, from + WRITE_CHUNK).map((entry) => ({
      run_id: runId,
      finding_hash: entry.finding_hash,
      criterion: entry.criterion,
      rule_id: entry.rule_id,
      description: entry.description,
      status: entry.status,
      source: entry.source,
      path: entry.path,
      start_line: entry.start_line,
      start_column: entry.start_column,
      old_text: entry.old_text,
      new_text: entry.new_text,
      question: entry.question,
      imported_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from('run_patches')
      .upsert(rows, { onConflict: 'run_id,finding_hash' });
    if (error) throw new Error(error.message);
  }
}

/**
 * Record one reviewer's decision about one proposed edit.
 *
 * `decided_by`, `decided_by_email` and `decided_at` are deliberately not sent: the trigger in
 * migration 0006 writes all three from the caller's own token and the database clock, so what
 * the record says about who decided cannot come from a form field.
 */
export async function savePatchDecision(
  runId: string,
  findingHash: string,
  input: PatchDecisionInput,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('patch_reviews').upsert(
    {
      run_id: runId,
      finding_hash: findingHash,
      decision: input.decision,
      reason: input.reason,
    },
    { onConflict: 'run_id,finding_hash' },
  );
  if (error) throw new Error(error.message);
}

/** Take a decision back: the patch returns to "not yet reviewed". */
export async function clearPatchDecision(runId: string, findingHash: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('patch_reviews')
    .delete()
    .eq('run_id', runId)
    .eq('finding_hash', findingHash);
  if (error) throw new Error(error.message);
}
