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

let warnedRefused = false;

/**
 * The worker's base URL, or null when no worker is connected (the form is then hidden).
 *
 * A URL that is set but refused — not http(s), or plain http to anything but loopback — is
 * treated exactly as unset, and the server log says so once, without echoing the value.
 */
export function workerUrl(): string | null {
  const raw = process.env.ACCESSLENS_WORKER_URL;
  const url = normaliseWorkerUrl(raw);
  if (url === null && (raw ?? '').trim() !== '' && !warnedRefused) {
    warnedRefused = true;
    console.warn(
      'ACCESSLENS_WORKER_URL is set but refused: it must be https, or http only on loopback ' +
        '(127.0.0.1, ::1, localhost). Run audit is disabled.',
    );
  }
  return url;
}

export async function submitJob(jobId: string, accessToken: string): Promise<SubmitResult> {
  const baseUrl = workerUrl();
  if (baseUrl === null) return { ok: false, message: WORKER_UNREACHABLE_MESSAGE, status: null };
  return submit({ baseUrl, jobId, accessToken });
}
