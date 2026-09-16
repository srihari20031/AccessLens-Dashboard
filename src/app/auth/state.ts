/**
 * The shape a sign-in attempt reports back.
 *
 * It lives here rather than in actions.ts because a `'use server'` module may only export
 * async functions — a constant exported from one is a build error.
 */
export type AuthState = { error: string | null; notice: string | null };

export const EMPTY_AUTH_STATE: AuthState = { error: null, notice: null };
