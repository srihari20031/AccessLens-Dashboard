/**
 * Talking to the scan worker, with `fetch` passed in so it is testable without a network.
 *
 * The contract (`POST {worker}/jobs`, `Authorization: Bearer <user token>`, body
 * `{"job_id": ...}`, 202 on success) is shared with the Python worker; see README "Run audit".
 * Only the job id is sent: the worker reads the URL and limits from the job row itself.
 */

export const WORKER_UNREACHABLE_MESSAGE = 'The scan service could not be reached. Try again later.';

export const DEFAULT_WORKER_TIMEOUT_MS = 10_000;

/** Hosts where plain http is allowed: the token then never leaves the machine. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '[::1]', 'localhost']);

/**
 * The configured worker URL without trailing slashes, or null when unset or unusable.
 *
 * The user's access token is sent to this address, so it must be https — except on loopback
 * (`127.0.0.1`, `::1`, `localhost`), where local development runs the worker over plain http.
 */
export function normaliseWorkerUrl(raw: string | undefined): string | null {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (trimmed === '') return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:') return trimmed;
    // `URL` lower-cases the host and keeps IPv6 brackets, so the comparison is exact.
    if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) return trimmed;
    return null;
  } catch {
    return null;
  }
}

export type SubmitResult = { ok: true } | { ok: false; message: string; status: number | null };

export type SubmitOptions = {
  baseUrl: string;
  jobId: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Ask the worker to run a job. Anything but 202 Accepted — an error status, a network error, a
 * timeout — is reported with one fixed message; the worker's own response text is never shown.
 */
export async function submitJob(options: SubmitOptions): Promise<SubmitResult> {
  const { baseUrl, jobId, accessToken, fetchImpl = fetch } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve('timeout');
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetchImpl(`${baseUrl}/jobs`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ job_id: jobId }),
        signal: controller.signal,
        cache: 'no-store',
      }),
      timedOut,
    ]);
    if (response === 'timeout') {
      return { ok: false, message: WORKER_UNREACHABLE_MESSAGE, status: null };
    }
    // The body is not needed and not trusted; release it without reading it into anything.
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 202) return { ok: true };
    return { ok: false, message: WORKER_UNREACHABLE_MESSAGE, status: response.status };
  } catch {
    return { ok: false, message: WORKER_UNREACHABLE_MESSAGE, status: null };
  } finally {
    clearTimeout(timer);
  }
}
