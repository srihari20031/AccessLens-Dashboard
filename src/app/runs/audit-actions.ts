'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { friendlyInsertError, parseAuditInput } from '@/lib/audit/input';
import { reportByteLength, STORE_FAILED_MESSAGE } from '@/lib/audit/results';
import { tokenForWorker } from '@/lib/audit/session';
import {
  claimJobRun,
  createJob,
  failQueuedJob,
  JobInsertError,
  loadJob,
  loadJobReport,
} from '@/lib/db/jobs';
import { deleteRun, importRun } from '@/lib/db/runs';
import { toImportPayload } from '@/lib/report/map';
import { parseReport } from '@/lib/report/schema';
import { createClient } from '@/lib/supabase/server';
import { workerUrl, submitJob } from '@/lib/worker';

import {
  EMPTY_AUDIT_VALUES,
  type AuditFormState,
  type AuditFormValues,
  type OpenResultsState,
} from './audit-state';
import { MAX_UPLOAD_BYTES } from './upload-state';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formError(values: AuditFormValues, message: string): AuditFormState {
  return { status: 'error', message, fieldErrors: {}, values };
}

/**
 * Start an audit: validate, insert the job as the user, hand its id to the worker.
 *
 * The insert comes first so that row-level security and the quota trigger decide whether the
 * audit may run at all; the worker is only told about a row that already exists and belongs to
 * this user, and it reads the URL from that row rather than from anything sent here.
 */
export async function startAudit(
  _previous: AuditFormState,
  formData: FormData,
): Promise<AuditFormState> {
  const values: AuditFormValues = {
    url: String(formData.get('url') ?? ''),
    kind: formData.get('kind') === 'crawl' ? 'crawl' : 'scan',
    max_pages: String(formData.get('max_pages') ?? ''),
    permission: formData.get('permission') === 'on',
  };

  if (workerUrl() === null) {
    return formError(values, 'Scanning from the dashboard is not set up here.');
  }

  const parsed = parseAuditInput({
    url: formData.get('url'),
    kind: formData.get('kind'),
    max_pages: formData.get('max_pages'),
    permission: formData.get('permission'),
  });
  if (!parsed.ok) {
    return {
      status: 'error',
      message: 'The audit was not started. Check the fields marked below.',
      fieldErrors: parsed.errors,
      values,
    };
  }

  const supabase = await createClient();
  // getUser() revalidates the session with Supabase; getSession() alone would trust the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user === null) {
    return formError(values, 'Your session has ended. Sign in again to run an audit.');
  }

  // The worker keeps this token for the whole job and writes the result back with it, and it
  // refuses one with less than its job timeout plus 30 minutes left. Refresh now, so the token
  // handed over is a fresh one (an hour on Supabase), however long ago the cookie was issued.
  // This runs just before the insert and the submit, so nothing slow sits in between, and a
  // session that cannot be renewed stops here rather than leaving a failed job behind.
  const {
    data: { session },
    error: refreshError,
  } = await supabase.auth.refreshSession();
  const accessToken = refreshError ? null : tokenForWorker(session, Math.floor(Date.now() / 1000));
  if (accessToken === null) {
    return formError(values, 'Your session could not be renewed. Sign in again to run an audit.');
  }

  let jobId: string;
  try {
    jobId = await createJob(parsed.value);
  } catch (error) {
    const message = error instanceof JobInsertError ? error.message : '';
    return formError(values, friendlyInsertError(message));
  }

  const submitted = await submitJob(jobId, accessToken);
  if (!submitted.ok) {
    try {
      // Only a job still queued is marked: if the worker did pick it up, its own status wins.
      await failQueuedJob(jobId, submitted.message);
    } catch {
      // The job then shows as waiting until it goes stale after 30 minutes. Nothing better
      // can be done from here, and the user is told below either way.
    }
    revalidatePath('/runs');
    return formError(values, submitted.message);
  }

  revalidatePath('/runs');
  return {
    status: 'started',
    message: `Audit started for ${parsed.value.url}. Its progress is shown in Your audits below.`,
    fieldErrors: {},
    values: EMPTY_AUDIT_VALUES,
  };
}

function openFailed(error: string, issues: string[] = []): OpenResultsState {
  return { error, issues };
}

/**
 * Open a finished audit's results, importing them the first time.
 *
 * Idempotent: once the job records a run it only redirects there. The report goes through the
 * same `parseReport` → `toImportPayload` → `import_run` path as an uploaded file, so a report
 * from the worker is trusted exactly as much as one from disk. If two clicks race, the second
 * import is removed and both land on the run the job recorded.
 */
export async function openAuditResults(
  _previous: OpenResultsState,
  formData: FormData,
): Promise<OpenResultsState> {
  const id = String(formData.get('job_id') ?? '');
  if (!UUID.test(id)) return openFailed('That audit was not found.');

  const job = await loadJob(id);
  if (job === null) return openFailed('That audit was not found.');
  if (job.run_id !== null) redirect(`/runs/${job.run_id}`);
  if (job.status !== 'done') return openFailed('This audit has no results to open.');

  const report = await loadJobReport(id);
  // The same cap as a file upload. The table also refuses a report over 5 MB, so this only
  // matters for a row stored before that check existed; it is kept so both paths agree.
  if (reportByteLength(report) > MAX_UPLOAD_BYTES) {
    return openFailed(
      `The audit finished, but its report is over the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB ` +
        'limit and cannot be opened. Audit fewer pages.',
    );
  }
  const parsed = parseReport(report);
  if (!parsed.ok) {
    return openFailed(
      `The audit finished, but its report could not be read: ${parsed.message}`,
      parsed.issues,
    );
  }

  let runId: string;
  try {
    runId = await importRun(toImportPayload(parsed.value, `Audit · ${job.url}`));
  } catch (error) {
    // The database's text can name tables, constraints or values; it goes to the server log.
    console.error('openAuditResults: import_run failed', error);
    return openFailed(STORE_FAILED_MESSAGE);
  }

  let target = runId;
  try {
    if (!(await claimJobRun(id, runId))) {
      await deleteRun(runId);
      const winner = await loadJob(id);
      if (winner?.run_id == null) return openFailed('The results could not be opened. Try again.');
      target = winner.run_id;
    }
  } catch {
    // The run is stored even if the job could not be linked to it; open it rather than fail.
  }

  revalidatePath('/runs');
  redirect(`/runs/${target}`);
}
