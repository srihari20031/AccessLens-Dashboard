/**
 * Audit jobs (`public.scan_jobs`, migration 0004), always read and written as the signed-in
 * user: row-level security limits every query here to that user's own rows, and the quota
 * trigger runs on every insert.
 */
import type { AuditInput, AuditKind } from '@/lib/audit/input';
import type { JobStatus } from '@/lib/audit/status';
import { createClient } from '@/lib/supabase/server';

export type AuditJob = {
  id: string;
  url: string;
  kind: AuditKind;
  max_pages: number;
  status: JobStatus;
  error: string | null;
  run_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

const JOB_COLUMNS =
  'id, url, kind, max_pages, status, error, run_id, created_at, started_at, finished_at';

const STATUSES: readonly JobStatus[] = ['queued', 'running', 'done', 'failed'];

export const RECENT_JOBS_LIMIT = 20;

function toJob(row: Record<string, unknown>): AuditJob {
  const status = STATUSES.includes(row.status as JobStatus) ? (row.status as JobStatus) : 'failed';
  return {
    id: String(row.id),
    url: String(row.url),
    kind: row.kind === 'crawl' ? 'crawl' : 'scan',
    max_pages: typeof row.max_pages === 'number' ? row.max_pages : 1,
    status,
    error: typeof row.error === 'string' ? row.error : null,
    run_id: typeof row.run_id === 'string' ? row.run_id : null,
    created_at: String(row.created_at),
    started_at: typeof row.started_at === 'string' ? row.started_at : null,
    finished_at: typeof row.finished_at === 'string' ? row.finished_at : null,
  };
}

/** Thrown with the database's message, which the caller turns into a friendly one. */
export class JobInsertError extends Error {}

export async function createJob(input: AuditInput): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('scan_jobs')
    .insert({
      url: input.url,
      kind: input.kind,
      max_pages: input.maxPages,
      permission_confirmed: input.permissionConfirmed,
    })
    .select('id')
    .single();
  if (error) throw new JobInsertError(error.message);
  return String((data as Record<string, unknown>).id);
}

/**
 * The user's most recent jobs, newest first. Null when the table does not exist yet
 * (migration 0004 not run), so the Runs page can say so instead of failing.
 */
export async function listRecentJobs(limit = RECENT_JOBS_LIMIT): Promise<AuditJob[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('scan_jobs')
    .select(JOB_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return null;
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => toJob(row as Record<string, unknown>));
}

/** One of the user's jobs, without its report; null when it is not theirs or does not exist. */
export async function loadJob(id: string): Promise<AuditJob | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('scan_jobs')
    .select(JOB_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data === null ? null : toJob(data as Record<string, unknown>);
}

/**
 * The stored report of one of the user's jobs, as untrusted JSON. Read separately because
 * only the import needs it and a crawl's report can run to megabytes.
 */
export async function loadJobReport(id: string): Promise<unknown> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('scan_jobs')
    .select('report')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Record<string, unknown> | null)?.report ?? null;
}

/**
 * Record the imported run on the job, only if no run is recorded yet.
 *
 * Returns true when this call set it, false when another import got there first — the caller
 * then removes its own duplicate run and uses the one already recorded.
 */
export async function claimJobRun(id: string, runId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('scan_jobs')
    .update({ run_id: runId })
    .eq('id', id)
    .is('run_id', null)
    .select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** Mark a job failed with one of the fixed messages, if it has not started yet. */
export async function failQueuedJob(id: string, message: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('scan_jobs')
    .update({ status: 'failed', error: message, finished_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'queued');
  if (error) throw new Error(error.message);
}
