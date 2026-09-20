/**
 * What the patch-review forms report back.
 *
 * Kept out of actions.ts because a `'use server'` module may only export async functions.
 */

export type PatchImportState = {
  /** A sentence naming what went wrong, or null. */
  error: string | null;
  issues: string[];
  /** A sentence naming what was stored, shown when the import succeeded. */
  stored: string | null;
};

export const EMPTY_PATCH_IMPORT_STATE: PatchImportState = {
  error: null,
  issues: [],
  stored: null,
};

export type PatchDecisionState = {
  status: 'idle' | 'saved' | 'error';
  message: string | null;
};

export const EMPTY_PATCH_DECISION_STATE: PatchDecisionState = { status: 'idle', message: null };
