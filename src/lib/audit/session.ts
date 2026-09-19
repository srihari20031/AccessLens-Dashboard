/**
 * Which access token may be handed to the worker.
 *
 * Pure: the current time is passed in. The worker runs a job for up to `JOB_TIMEOUT_S`
 * (15 minutes by default) and then writes the result back with the same token, so it refuses a
 * token with less than `JOB_TIMEOUT_S` + 30 minutes left. The dashboard refreshes the session
 * right before submitting (a fresh Supabase token has an hour) and checks the same minimum
 * itself, so a short-lived token is caught here with a clear message instead of a worker 401.
 */

/** The worker's default job timeout plus its 30-minute margin, in seconds. */
export const MIN_TOKEN_LIFETIME_S = 900 + 1800;

export type SessionLike = { access_token?: string; expires_at?: number } | null | undefined;

/** The session's access token, or null when there is none or it expires too soon. */
export function tokenForWorker(session: SessionLike, nowSeconds: number): string | null {
  if (session == null) return null;
  const token = session.access_token;
  const expiresAt = session.expires_at;
  if (typeof token !== 'string' || token === '') return null;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null;
  return expiresAt - nowSeconds >= MIN_TOKEN_LIFETIME_S ? token : null;
}
