'use server';

import { revalidatePath } from 'next/cache';

import { clearPatchDecision, savePatchDecision, savePatches } from '@/lib/db/patches';
import { loadFindingIdentities } from '@/lib/db/runs';
import { parsePatchDecisionInput } from '@/lib/review/patch-decisions';
import { MAX_PATCHES_BYTES, parsePatchesText, patchesForRun } from '@/lib/review/patches';

import { type PatchDecisionState, type PatchImportState } from './patch-state';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]+$/;

const STORE_FAILED =
  'The patches could not be stored. If this database has not had ' +
  'supabase/migrations/0006_patch_review.sql run against it, run that first.';

const DECISION_FAILED =
  'That decision could not be saved. If this database has not had ' +
  'supabase/migrations/0006_patch_review.sql run against it, run that first.';

function importFailed(error: string, issues: string[] = []): PatchImportState {
  return { error, issues, stored: null };
}

function countedSentence(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Store the proposed edits of a patch file against one run.
 *
 * Order matters, and mirrors the explanations import: size, then JSON, then shape, then the
 * run's own findings, then the database. Nothing from the file is treated as anything but bytes
 * until `parsePatchesText` has been through it, and a patch whose finding is not in this run is
 * dropped and counted rather than stored — a patch file made from another report names lines in
 * a file this run never saw.
 *
 * Importing never touches a decision, never touches a finding, and never touches a file. The
 * edits are stored as text and displayed; applying one is something a person does on their own
 * machine, under version control.
 */
export async function importPatches(
  _previous: PatchImportState,
  formData: FormData,
): Promise<PatchImportState> {
  const runId = String(formData.get('run_id') ?? '');
  if (!UUID.test(runId)) return importFailed('That run was not found.');

  const file = formData.get('patches');
  if (!(file instanceof File) || file.size === 0) {
    return importFailed('Choose a patch file to upload.');
  }
  if (file.size > MAX_PATCHES_BYTES) {
    const megabytes = (file.size / (1024 * 1024)).toFixed(1);
    return importFailed(
      `That file is ${megabytes} MB, over the ${MAX_PATCHES_BYTES / (1024 * 1024)} MB limit.`,
    );
  }

  const parsed = parsePatchesText(await file.text());
  if (!parsed.ok) return importFailed(parsed.message, parsed.issues);

  let hashes: string[];
  try {
    const identities = await loadFindingIdentities([runId]);
    hashes = (identities.get(runId) ?? []).map((identity) => identity.finding_hash);
  } catch (error) {
    console.error('importPatches: reading the run failed', error);
    return importFailed('The findings of this run could not be read. Try again in a moment.');
  }

  const { kept, unknown } = patchesForRun(parsed.value.entries, hashes);
  if (kept.length === 0) {
    return importFailed(
      'None of the patches in that file is for a finding in this run. A patch file belongs ' +
        'to the report it was made from — run "accesslens fix" on this run’s own report.',
    );
  }

  try {
    await savePatches(runId, kept);
  } catch (error) {
    // The database's text can name tables, constraints or values; it goes to the server log.
    console.error('importPatches: storing patches failed', error);
    return importFailed(STORE_FAILED);
  }

  const ignored = unknown + parsed.value.skipped;
  const stored =
    `Stored ${countedSentence(kept.length, 'patch', 'patches')} for this run.` +
    (ignored > 0
      ? ` ${countedSentence(ignored, 'entry was', 'entries were')} ignored: unusable, or for a finding that is not in this run.`
      : '');

  revalidatePath(`/runs/${runId}/patches`);
  revalidatePath(`/runs/${runId}`);
  return { error: null, issues: [], stored };
}

/**
 * Record one decision about one proposed edit.
 *
 * What this writes is a judgement about the *edit*. It does not touch `run_findings`, and there
 * is no code path from here to an outcome, a severity or a band: rejecting a patch leaves the
 * finding exactly as the scanner reported it, and accepting one changes no file. "Applied" is
 * a person saying they made the edit themselves — this dashboard has no way to make it.
 */
export async function recordPatchDecision(
  _previous: PatchDecisionState,
  formData: FormData,
): Promise<PatchDecisionState> {
  const runId = String(formData.get('run_id') ?? '');
  const findingHash = String(formData.get('finding_hash') ?? '');
  if (!UUID.test(runId) || !HEX.test(findingHash)) {
    return { status: 'error', message: 'That finding was not found.' };
  }

  const parsed = parsePatchDecisionInput({
    decision: formData.get('decision'),
    reason: formData.get('reason'),
  });
  if (!parsed.ok) return { status: 'error', message: parsed.error };

  try {
    if (parsed.value.decision === 'pending') {
      // Taking a decision back removes the row, so the patch counts as not yet reviewed
      // again — the same state as an edit nobody has looked at.
      await clearPatchDecision(runId, findingHash);
    } else {
      await savePatchDecision(runId, findingHash, parsed.value);
    }
  } catch (error) {
    console.error('recordPatchDecision: saving the decision failed', error);
    return { status: 'error', message: DECISION_FAILED };
  }

  revalidatePath(`/runs/${runId}/patches`);
  revalidatePath(`/runs/${runId}`);
  return {
    status: 'saved',
    message:
      parsed.value.decision === 'pending'
        ? 'Decision cleared. This patch counts as not yet reviewed again.'
        : 'Decision saved. The finding is unchanged, and no file has been edited.',
  };
}
