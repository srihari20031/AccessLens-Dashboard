'use server';

import { revalidatePath } from 'next/cache';

import { clearDecision, saveDecision, saveSuggestions } from '@/lib/db/reviews';
import { loadFindingIdentities } from '@/lib/db/runs';
import { parseDecisionInput } from '@/lib/review/decisions';
import {
  entriesForRun,
  MAX_EXPLANATIONS_BYTES,
  parseExplanationsText,
} from '@/lib/review/explanations';

import { type DecisionState, type ExplanationsState } from './review-state';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]+$/;

const STORE_FAILED =
  'The suggestions could not be stored. If this database has not had ' +
  'supabase/migrations/0005_fix_reviews.sql run against it, run that first.';

const DECISION_FAILED =
  'That decision could not be saved. If this database has not had ' +
  'supabase/migrations/0005_fix_reviews.sql run against it, run that first.';

function importFailed(error: string, issues: string[] = []): ExplanationsState {
  return { error, issues, stored: null };
}

function countedSentence(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Store the AI text of an explanations file against one run.
 *
 * Order matters, and mirrors the report upload: size, then JSON, then shape, then the run's
 * own findings, then the database. Nothing from the file is treated as anything but bytes
 * until `parseExplanationsText` has been through it, and an entry whose finding is not in
 * this run is dropped and counted rather than stored — an explanations file made from another
 * report must not be poured into this one.
 *
 * Importing never touches a decision, and never touches a finding.
 */
export async function importExplanations(
  _previous: ExplanationsState,
  formData: FormData,
): Promise<ExplanationsState> {
  const runId = String(formData.get('run_id') ?? '');
  if (!UUID.test(runId)) return importFailed('That run was not found.');

  const file = formData.get('explanations');
  if (!(file instanceof File) || file.size === 0) {
    return importFailed('Choose an explanations file to upload.');
  }
  if (file.size > MAX_EXPLANATIONS_BYTES) {
    const megabytes = (file.size / (1024 * 1024)).toFixed(1);
    return importFailed(
      `That file is ${megabytes} MB, over the ${MAX_EXPLANATIONS_BYTES / (1024 * 1024)} MB limit.`,
    );
  }

  const parsed = parseExplanationsText(await file.text());
  if (!parsed.ok) return importFailed(parsed.message, parsed.issues);

  let hashes: string[];
  try {
    const identities = await loadFindingIdentities([runId]);
    hashes = (identities.get(runId) ?? []).map((identity) => identity.finding_hash);
  } catch (error) {
    console.error('importExplanations: reading the run failed', error);
    return importFailed('The findings of this run could not be read. Try again in a moment.');
  }

  const { kept, unknown } = entriesForRun(parsed.value.entries, hashes);
  if (kept.length === 0) {
    return importFailed(
      'None of the suggestions in that file is for a finding in this run. An explanations ' +
        'file belongs to the report it was made from — run "accesslens explain" on this ' +
        "run's own report.",
    );
  }

  try {
    await saveSuggestions(runId, kept);
  } catch (error) {
    // The database's text can name tables, constraints or values; it goes to the server log.
    console.error('importExplanations: storing suggestions failed', error);
    return importFailed(STORE_FAILED);
  }

  const ignored = unknown + parsed.value.skipped;
  const stored =
    `Stored ${countedSentence(kept.length, 'suggestion', 'suggestions')} for this run.` +
    (ignored > 0
      ? ` ${countedSentence(ignored, 'entry was', 'entries were')} ignored: unusable, or for a finding that is not in this run.`
      : '');

  revalidatePath(`/runs/${runId}/review`);
  revalidatePath(`/runs/${runId}`);
  return { error: null, issues: [], stored };
}

/**
 * Record one decision about one suggested fix.
 *
 * What this writes is a judgement about the *text*. It does not touch `run_findings`, and
 * there is no code path from here to an outcome, a severity or a band: rejecting a suggestion
 * leaves the finding exactly as the scanner reported it, and accepting one fixes nothing.
 */
export async function recordDecision(
  _previous: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const runId = String(formData.get('run_id') ?? '');
  const findingHash = String(formData.get('finding_hash') ?? '');
  if (!UUID.test(runId) || !HEX.test(findingHash)) {
    return { status: 'error', message: 'That finding was not found.' };
  }

  const parsed = parseDecisionInput({
    decision: formData.get('decision'),
    edited_fix: formData.get('edited_fix'),
    reason: formData.get('reason'),
  });
  if (!parsed.ok) return { status: 'error', message: parsed.error };

  try {
    if (parsed.value.decision === 'pending') {
      // Taking a decision back removes the row, so the finding counts as not yet reviewed
      // again — the same state as a suggestion nobody has looked at.
      await clearDecision(runId, findingHash);
    } else {
      await saveDecision(runId, findingHash, parsed.value);
    }
  } catch (error) {
    console.error('recordDecision: saving the decision failed', error);
    return { status: 'error', message: DECISION_FAILED };
  }

  revalidatePath(`/runs/${runId}/review`);
  revalidatePath(`/runs/${runId}`);
  return {
    status: 'saved',
    message:
      parsed.value.decision === 'pending'
        ? 'Decision cleared. This suggestion counts as not yet reviewed again.'
        : 'Decision saved. The finding itself is unchanged.',
  };
}
