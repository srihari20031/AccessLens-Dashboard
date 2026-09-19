import { describe, expect, it, vi } from 'vitest';

import {
  normaliseWorkerUrl,
  submitJob,
  WORKER_UNREACHABLE_MESSAGE,
} from '@/lib/audit/worker-client';

describe('the worker URL', () => {
  it('is null when unset or blank', () => {
    expect(normaliseWorkerUrl(undefined)).toBeNull();
    expect(normaliseWorkerUrl('')).toBeNull();
    expect(normaliseWorkerUrl('   ')).toBeNull();
  });

  it('loses trailing slashes and surrounding whitespace', () => {
    expect(normaliseWorkerUrl(' http://127.0.0.1:8080/ ')).toBe('http://127.0.0.1:8080');
    expect(normaliseWorkerUrl('https://worker.example//')).toBe('https://worker.example');
    expect(normaliseWorkerUrl('https://worker.example/base/')).toBe('https://worker.example/base');
  });

  it('is kept as given otherwise', () => {
    expect(normaliseWorkerUrl('https://worker.example')).toBe('https://worker.example');
  });

  it('is null when it is not an http(s) URL, rather than failing later', () => {
    expect(normaliseWorkerUrl('worker.example')).toBeNull();
    expect(normaliseWorkerUrl('ftp://worker.example')).toBeNull();
  });
});

function fakeFetch(respond: () => Promise<Response>) {
  return vi.fn<typeof fetch>(respond);
}

const JOB = '0b8c2f4e-1111-4a5b-9c3d-2e7f6a8b9c0d';

describe('submitting a job to the worker', () => {
  it('posts the job id with the user token, as the contract says', async () => {
    const fetchImpl = fakeFetch(async () => new Response('{"status":"queued"}', { status: 202 }));
    const result = await submitJob({
      baseUrl: 'http://127.0.0.1:8080',
      jobId: JOB,
      accessToken: 'token-123',
      fetchImpl,
    });
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8080/jobs');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer token-123');
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({ job_id: JOB });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.cache).toBe('no-store');
  });

  it.each([200, 400, 401, 404, 409, 500, 503])('treats %i as not accepted', async (status) => {
    const fetchImpl = fakeFetch(async () => new Response('{}', { status }));
    const result = await submitJob({ baseUrl: 'http://w', jobId: JOB, accessToken: 't', fetchImpl });
    expect(result).toEqual({ ok: false, message: WORKER_UNREACHABLE_MESSAGE, status });
  });

  it('treats a network error as not accepted', async () => {
    const fetchImpl = fakeFetch(async () => {
      throw new TypeError('fetch failed');
    });
    const result = await submitJob({ baseUrl: 'http://w', jobId: JOB, accessToken: 't', fetchImpl });
    expect(result).toEqual({ ok: false, message: WORKER_UNREACHABLE_MESSAGE, status: null });
  });

  it('gives up after the timeout', async () => {
    const fetchImpl = fakeFetch(
      () =>
        new Promise<Response>(() => {
          /* never answers */
        }),
    );
    // The fake ignores the signal, as a hung socket might; the timeout must still win.
    const result = await submitJob({
      baseUrl: 'http://w',
      jobId: JOB,
      accessToken: 't',
      fetchImpl,
      timeoutMs: 20,
    });
    expect(result).toEqual({ ok: false, message: WORKER_UNREACHABLE_MESSAGE, status: null });
  });

  it('uses a fixed message, never the worker body', async () => {
    const fetchImpl = fakeFetch(async () => new Response('Traceback: secret', { status: 500 }));
    const result = await submitJob({ baseUrl: 'http://w', jobId: JOB, accessToken: 't', fetchImpl });
    expect(JSON.stringify(result)).not.toMatch(/secret/);
  });

  it('is the fixed message the brief names', () => {
    expect(WORKER_UNREACHABLE_MESSAGE).toBe('The scan service could not be reached. Try again later.');
  });
});
