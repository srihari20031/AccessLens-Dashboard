/**
 * What the fix-review forms report back.
 *
 * Kept out of actions.ts because a `'use server'` module may only export async functions.
 */

export type ExplanationsState = {
  /** A sentence naming what went wrong, or null. */
  error: string | null;
  issues: string[];
  /** A sentence naming what was stored, shown when the import succeeded. */
  stored: string | null;
};

export const EMPTY_EXPLANATIONS_STATE: ExplanationsState = {
  error: null,
  issues: [],
  stored: null,
};

export type DecisionState = {
  status: 'idle' | 'saved' | 'error';
  message: string | null;
};

export const EMPTY_DECISION_STATE: DecisionState = { status: 'idle', message: null };
