/**
 * The scan worker, as the server sees it.
 *
 * Server-only: import this from Server Components and Server Actions, never from a Client
 * Component. `ACCESSLENS_WORKER_URL` is deliberately not `NEXT_PUBLIC_`, so it is never
 * compiled into the browser bundle; it is read at request time on dynamic pages only.
 */
import {
  normaliseWorkerUrl,
  submitJob as submit,
  WORKER_UNREACHABLE_MESSAGE,
  type SubmitResult,
} from '@/lib/audit/worker-client';

/** The worker's base URL, or null when no worker is connected (the form is then hidden). */
export function workerUrl(): string | null {
  return normaliseWorkerUrl(process.env.ACCESSLENS_WORKER_URL);
}

export async function submitJob(jobId: string, accessToken: string): Promise<SubmitResult> {
  const baseUrl = workerUrl();
  if (baseUrl === null) return { ok: false, message: WORKER_UNREACHABLE_MESSAGE, status: null };
  return submit({ baseUrl, jobId, accessToken });
}
