import { describe, expect, it } from 'vitest';

import {
  announceChanges,
  describeJob,
  hasActiveJob,
  type JobStatusInput,
} from '@/lib/audit/status';

const NOW = new Date('2026-09-19T12:00:00Z');

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function job(overrides: Partial<JobStatusInput> = {}): JobStatusInput {
  return {
    status: 'queued',
    error: null,
    created_at: minutesAgo(1),
    started_at: null,
    ...overrides,
  };
}

describe('a job status in words', () => {
  it('says a fresh queued job is waiting', () => {
    expect(describeJob(job(), NOW)).toEqual({ label: 'Waiting to start', active: true });
  });

  it('says a fresh running job is running', () => {
    const running = job({ status: 'running', created_at: minutesAgo(40), started_at: minutesAgo(5) });
    expect(describeJob(running, NOW)).toEqual({ label: 'Running', active: true });
  });

  it('says a done job is finished', () => {
    expect(describeJob(job({ status: 'done' }), NOW)).toEqual({ label: 'Finished', active: false });
  });

  it('gives the reason a job failed', () => {
    const failed = job({ status: 'failed', error: 'The page could not be loaded.' });
    expect(describeJob(failed, NOW)).toEqual({
      label: 'Failed: The page could not be loaded.',
      active: false,
    });
  });

  it('still says something when a failure has no reason recorded', () => {
    expect(describeJob(job({ status: 'failed' }), NOW).label).toBe('Failed: no reason was recorded.');
  });

  it('treats a job queued more than 30 minutes ago as stopped', () => {
    expect(describeJob(job({ created_at: minutesAgo(31) }), NOW)).toEqual({
      label: 'Stopped: took longer than 30 minutes',
      active: false,
    });
  });

  it('treats a job running for more than 30 minutes as stopped', () => {
    const running = job({ status: 'running', created_at: minutesAgo(35), started_at: minutesAgo(31) });
    expect(describeJob(running, NOW).label).toBe('Stopped: took longer than 30 minutes');
  });

  it('falls back to the creation time for a running job with no start time', () => {
    const running = job({ status: 'running', created_at: minutesAgo(45), started_at: null });
    expect(describeJob(running, NOW).active).toBe(false);
  });

  it('keeps a job at exactly 30 minutes active, like the database', () => {
    expect(describeJob(job({ created_at: minutesAgo(29.9) }), NOW).active).toBe(true);
    expect(describeJob(job({ created_at: minutesAgo(30) }), NOW).active).toBe(false);
  });

  it('never calls a finished job stale', () => {
    expect(describeJob(job({ status: 'done', created_at: minutesAgo(600) }), NOW).label).toBe(
      'Finished',
    );
  });
});

describe('whether the list should keep refreshing', () => {
  it('is true while any job is fresh and queued or running', () => {
    expect(hasActiveJob([job({ status: 'done' }), job({ status: 'running', started_at: minutesAgo(1) })], NOW)).toBe(true);
  });

  it('is false when every job is finished, failed or stale', () => {
    expect(
      hasActiveJob(
        [job({ status: 'done' }), job({ status: 'failed' }), job({ created_at: minutesAgo(60) })],
        NOW,
      ),
    ).toBe(false);
  });

  it('is false with no jobs', () => {
    expect(hasActiveJob([], NOW)).toBe(false);
  });
});

describe('what is announced when statuses change', () => {
  const a = { id: 'a', url: 'https://a.example/', label: 'Waiting to start' };
  const b = { id: 'b', url: 'https://b.example/', label: 'Running' };

  it('announces nothing when nothing changed', () => {
    expect(announceChanges([a, b], [a, b])).toBe('');
  });

  it('announces a job whose status changed', () => {
    expect(announceChanges([a, b], [{ ...a, label: 'Running' }, b])).toBe(
      'Audit of https://a.example/: Running.',
    );
  });

  it('announces a new job', () => {
    expect(announceChanges([b], [a, b])).toBe('Audit of https://a.example/: Waiting to start.');
  });

  it('joins several changes into one message', () => {
    expect(
      announceChanges([a, b], [{ ...a, label: 'Finished' }, { ...b, label: 'Failed: The scan took too long and was stopped.' }]),
    ).toBe(
      'Audit of https://a.example/: Finished. Audit of https://b.example/: Failed: The scan took too long and was stopped.',
    );
  });

  it('does not add a second full stop', () => {
    expect(announceChanges([], [{ ...a, label: 'Failed: The page could not be loaded.' }])).toBe(
      'Audit of https://a.example/: Failed: The page could not be loaded.',
    );
  });

  it('says nothing about a job that dropped off the list', () => {
    expect(announceChanges([a, b], [b])).toBe('');
  });
});
