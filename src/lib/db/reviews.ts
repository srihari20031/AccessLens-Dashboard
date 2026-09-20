/**
 * Fix review (`public.run_suggestions` and `public.fix_reviews`, migration 0005), always read
 * and written as the signed-in user: row-level security limits every query here to rows
 * reachable through that user's own runs, and the trigger on `fix_reviews` stamps who decided
 * and when from their own token.
 *
 * Nothing in this module writes to `run_findings`. A decision never changes a finding.
 */
import type { Decision, DecisionInput, ReviewRecord } from '@/lib/review/decisions';
import { DECISIONS } from '@/lib/review/decisions';
import type { Confidence, SuggestionEntry } from '@/lib/review/explanations';
import { CONFIDENCES } from '@/lib/review/explanations';
import { createClient } from '@/lib/supabase/server';

export type SuggestionRecord = {
  finding_hash: string;
  explanation: string;
  fix: string;
  confidence: Confidence | null;
  model: string | null;
  prompt_version: string | null;
  rule_version: string | null;
  imported_at: string;
};

const SUGGESTION_COLUMNS =
  'finding_hash, explanation, fix, confidence, model, prompt_version, rule_version, imported_at';
const REVIEW_COLUMNS = 'finding_hash, decision, edited_fix, reason, decided_by_email, decided_at';

/** Written in batches: one statement per few hundred rows keeps a request well under any cap. */
const WRITE_CHUNK = 250;

/**
 * The two codes PostgREST returns for a table that is not there yet.
 *
 * Migration 0005 may not have been run, and the same "the rest of the dashboard still works"
 * rule as `listRecentJobs` applies: the screen says which file to run rather than failing.
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

function toSuggestion(row: Record<string, unknown>): SuggestionRecord {
  const confidence = asText(row.confidence);
  return {
    finding_hash: asText(row.finding_hash),
    explanation: asText(row.explanation),
    fix: asText(row.fix),
    confidence: (CONFIDENCES as readonly string[]).includes(confidence)
      ? (confidence as Confidence)
      : null,
    model: asOptionalText(row.model),
    prompt_version: asOptionalText(row.prompt_version),
    rule_version: asOptionalText(row.rule_version),
    imported_at: asText(row.imported_at),
  };
}

function toReview(row: Record<string, unknown>): ReviewRecord {
  const decision = asText(row.decision);
  return {
    finding_hash: asText(row.finding_hash),
    // An unknown word is read as no decision rather than shown as one: a state this build
    // does not understand must never be presented as a person's judgement.
    decision: (DECISIONS as readonly string[]).includes(decision)
      ? (decision as Decision)
      : 'pending',
    edited_fix: asOptionalText(row.edited_fix),
    reason: asOptionalText(row.reason),
    decided_by_email: asOptionalText(row.decided_by_email),
    decided_at: asText(row.decided_at),
  };
}

export type ReviewData = {
  suggestions: SuggestionRecord[];
  reviews: ReviewRecord[];
};

/**
 * Every suggestion and decision of one run, or null when migration 0005 has not been run.
 *
 * Both tables hold at most one row per finding, so they are read whole: a run big enough for
 * that to matter is already past the point where this dashboard renders all its findings
 * (see "No pagination" in the README).
 */
export async function loadReviewData(runId: string): Promise<ReviewData | null> {
  const supabase = await createClient();
  const [suggestionsResult, reviewsResult] = await Promise.all([
    supabase.from('run_suggestions').select(SUGGESTION_COLUMNS).eq('run_id', runId),
    supabase.from('fix_reviews').select(REVIEW_COLUMNS).eq('run_id', runId),
  ]);

  if (suggestionsResult.error) {
    if (isMissingTable(suggestionsResult.error)) return null;
    throw new Error(suggestionsResult.error.message);
  }
  if (reviewsResult.error) {
    if (isMissingTable(reviewsResult.error)) return null;
    throw new Error(reviewsResult.error.message);
  }

  return {
    suggestions: (suggestionsResult.data ?? []).map((row) =>
      toSuggestion(row as Record<string, unknown>),
    ),
    reviews: (reviewsResult.data ?? []).map((row) => toReview(row as Record<string, unknown>)),
  };
}

/**
 * Store the suggestions of an explanations file against a run.
 *
 * An upsert on (run_id, finding_hash): importing the file twice replaces the text rather than
 * duplicating it, and leaves every decision where it was. The row's `imported_at` moves, which
 * is what lets the screen say a decision is older than the text it is about.
 *
 * Every entry must already have been matched to a finding of this run (`entriesForRun`); the
 * foreign key onto `run_findings` refuses the rest anyway.
 */
export async function saveSuggestions(
  runId: string,
  entries: readonly SuggestionEntry[],
): Promise<void> {
  const supabase = await createClient();
  for (let from = 0; from < entries.length; from += WRITE_CHUNK) {
    const rows = entries.slice(from, from + WRITE_CHUNK).map((entry) => ({
      run_id: runId,
      finding_hash: entry.finding_hash,
      explanation: entry.explanation,
      fix: entry.fix,
      confidence: entry.confidence,
      model: entry.model,
      prompt_version: entry.prompt_version,
      rule_version: entry.rule_version,
      imported_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from('run_suggestions')
      .upsert(rows, { onConflict: 'run_id,finding_hash' });
    if (error) throw new Error(error.message);
  }
}

/**
 * Record one reviewer's decision about one suggestion.
 *
 * `decided_by`, `decided_by_email` and `decided_at` are deliberately not sent: the trigger in
 * migration 0005 writes all three from the caller's own token and the database clock, so what
 * the record says about who decided cannot come from a form field.
 */
export async function saveDecision(
  runId: string,
  findingHash: string,
  input: DecisionInput,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('fix_reviews').upsert(
    {
      run_id: runId,
      finding_hash: findingHash,
      decision: input.decision,
      edited_fix: input.editedFix,
      reason: input.reason,
    },
    { onConflict: 'run_id,finding_hash' },
  );
  if (error) throw new Error(error.message);
}

/** Take a decision back: the finding returns to "not yet reviewed". */
export async function clearDecision(runId: string, findingHash: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('fix_reviews')
    .delete()
    .eq('run_id', runId)
    .eq('finding_hash', findingHash);
  if (error) throw new Error(error.message);
}
