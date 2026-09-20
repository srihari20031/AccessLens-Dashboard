import Link from 'next/link';

import { describeJob, hasActiveJob, type AnnouncedJob } from '@/lib/audit/status';
import type { AuditJob } from '@/lib/db/jobs';
import { formatDateTime } from '@/lib/format';

import { AuditRefresher } from './AuditRefresher';
import { OpenResultsForm } from './OpenResultsForm';

/**
 * The user's recent audits. A Server Component: statuses are worded on the server against one
 * instant, and `AuditRefresher` re-renders this while any job is still waiting or running.
 *
 * Every URL and error here is shown as text. The URL was typed by the user and the error is one
 * of the worker's fixed messages, but neither is ever treated as markup or as a link.
 */
export function AuditJobs({ jobs, now }: { jobs: AuditJob[]; now: Date }) {
  const described = jobs.map((job) => ({ job, status: describeJob(job, now) }));
  const announced: AnnouncedJob[] = described.map(({ job, status }) => ({
    id: job.id,
    url: job.url,
    label: status.label,
  }));
  const active = hasActiveJob(jobs, now);

  return (
    <section aria-labelledby="audits-heading" className="stack-tight">
      <h2 id="audits-heading">Your audits</h2>
      <AuditRefresher active={active} jobs={announced} />
      {jobs.length === 0 ? (
        // In a sheet, as the run list's own empty state is. Every other block on this screen
        // is a bordered panel, and a bare line of grey text read as something half-rendered.
        <div className="sheet">
          <p className="sheet__body prose small muted">
            No audits yet. Audits you start above are listed here, newest first, and each one
            becomes a run when you open its results.
          </p>
        </div>
      ) : (
        <>
          <div className="sheet table-scroll">
            <table className="data-table">
              <caption className="visually-hidden">
                Your most recent audits, newest first, with their status
              </caption>
              <thead>
                <tr>
                  <th scope="col">Address</th>
                  <th scope="col">Kind</th>
                  <th scope="col">Status</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">
                    <span className="visually-hidden">Results</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {described.map(({ job, status }) => (
                  <tr key={job.id}>
                    <th scope="row" style={{ fontWeight: 400 }}>
                      <span className="mono small" style={{ overflowWrap: 'anywhere' }}>
                        {job.url}
                      </span>
                    </th>
                    <td>
                      {job.kind === 'crawl'
                        ? `Crawl, up to ${job.max_pages} ${job.max_pages === 1 ? 'page' : 'pages'}`
                        : 'Scan'}
                    </td>
                    <td>{status.label}</td>
                    <td>{formatDateTime(job.created_at)}</td>
                    <td>
                      {job.run_id !== null ? (
                        <Link href={`/runs/${job.run_id}`}>
                          View run<span className="visually-hidden"> of {job.url}</span>
                        </Link>
                      ) : job.status === 'done' ? (
                        <OpenResultsForm jobId={job.id} url={job.url} />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted prose">
            {active
              ? 'This list updates by itself every few seconds while an audit is waiting or running.'
              : 'A finished audit becomes a run when you open its results.'}
          </p>
        </>
      )}
    </section>
  );
}
