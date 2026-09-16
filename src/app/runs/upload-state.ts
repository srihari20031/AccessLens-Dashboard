/**
 * The shape an upload attempt reports back, and the size cap.
 *
 * Kept out of actions.ts because a `'use server'` module may only export async functions.
 */
export type UploadState = { error: string | null; issues: string[] };

export const EMPTY_UPLOAD_STATE: UploadState = { error: null, issues: [] };

/** Five megabytes. A crawl of a few hundred pages is well under one. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
