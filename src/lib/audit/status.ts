/**
 * A job's status in words, and what changed between two looks at the list.
 *
 * Pure: the current time is passed in, so the stale rule is testable and the same instant is
 * used for every job on one render.
 */

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export type JobStatusInput = {
  status: JobStatus;
  error: string | null;
  created_at: string;
  started_at: string | null;
};

export type JobDescription = { label: string; active: boolean };

/** The same window the `scan_jobs` quota trigger uses: older active jobs no longer block. */
export const STALE_AFTER_MS = 30 * 60 * 1000;

export const STALE_LABEL = 'Stopped: took longer than 30 minutes';

const LABELS: Record<JobStatus, string> = {
  queued: 'Waiting to start',
  running: 'Running',
  done: 'Finished',
  failed: 'Failed',
};

function isFresh(iso: string, now: Date): boolean {
  const time = new Date(iso).getTime();
  // An unreadable time cannot prove the job is fresh; treat it as stale rather than poll forever.
  if (Number.isNaN(time)) return false;
  return time > now.getTime() - STALE_AFTER_MS;
}

export function describeJob(job: JobStatusInput, now: Date): JobDescription {
  switch (job.status) {
    case 'queued':
      return isFresh(job.created_at, now)
        ? { label: LABELS.queued, active: true }
        : { label: STALE_LABEL, active: false };
    case 'running':
      return isFresh(job.started_at ?? job.created_at, now)
        ? { label: LABELS.running, active: true }
        : { label: STALE_LABEL, active: false };
    case 'done':
      return { label: LABELS.done, active: false };
    case 'failed':
      return { label: `Failed: ${job.error ?? 'no reason was recorded.'}`, active: false };
  }
}

export function hasActiveJob(jobs: readonly JobStatusInput[], now: Date): boolean {
  return jobs.some((job) => describeJob(job, now).active);
}

export type AnnouncedJob = { id: string; url: string; label: string };

/**
 * One sentence per job that is new or whose status changed, for a polite live region.
 *
 * Only changes are announced, so a refresh that finds nothing new says nothing.
 */
export function announceChanges(
  before: readonly AnnouncedJob[],
  after: readonly AnnouncedJob[],
): string {
  const previous = new Map(before.map((job) => [job.id, job.label]));
  return after
    .filter((job) => previous.get(job.id) !== job.label)
    .map((job) => {
      const sentence = `Audit of ${job.url}: ${job.label}`;
      return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
    })
    .join(' ');
}
