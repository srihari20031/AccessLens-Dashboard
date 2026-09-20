import type { Metadata } from 'next';
import Link from 'next/link';

import { SetupNotice } from '@/components/SetupNotice';
import { listRuns } from '@/lib/db/runs';
import { BANDS, BAND_LABELS } from '@/lib/report/bands';
import { formatDateTime } from '@/lib/format';
import { historyHref } from '@/lib/links';
import { numberRuns } from '@/lib/report/history';
import { isConfigured } from '@/lib/supabase/config';

import { listRecentJobs } from '@/lib/db/jobs';
import { workerUrl } from '@/lib/worker';

import { AuditJobs } from './AuditJobs';
import { RunAuditForm } from './RunAuditForm';
import { UploadForm } from './UploadForm';
import { removeRun } from './actions';

export const metadata: Metadata = { title: 'Runs' };

/*
 * Never prerendered. These pages show one user's data, and what they show depends on the
 * session cookie. Without this, a build made before Supabase was configured renders the
 * setup notice and bakes it in as static — and a page of per-user data that can be
 * prerendered at all is a bug waiting to happen.
 */
export const dynamic = 'force-dynamic';


export default async function RunsPage() {
  if (!isConfigured()) return <SetupNotice />;

  // Read per request: the page is dynamic, so connecting a worker needs no rebuild of the code.
  const auditsEnabled = workerUrl() !== null;
  const [runs, jobs] = await Promise.all([
    listRuns(),
    auditsEnabled ? listRecentJobs() : Promise.resolve(null),
  ]);
  const numbers = numberRuns(runs);
  const now = new Date();

  return (
    <div className="stack">
      <div className="page-head">
        <div className="stack-tight">
          <h1>Runs</h1>
          <p className="lede">
            {auditsEnabled
              ? 'Every report you have uploaded or opened from an audit, newest first.'
              : 'Every report you have uploaded, newest first.'} Counts are severity bands — there is no
            score here, and no badge.
          </p>
        </div>
        {runs.length > 1 ? (
          <Link href="/compare" className="button button--quiet">
            Compare two runs
          </Link>
        ) : null}
      </div>

      {auditsEnabled ? (
        <>
          <RunAuditForm />
          {jobs === null ? (
            <div className="notice notice--warning">
              <p className="small prose">
                Audits are not set up in this database yet. Run{' '}
                <code className="mono">supabase/migrations/0004_scan_jobs.sql</code> in the
                Supabase SQL editor, then reload this page.
              </p>
            </div>
          ) : (
            <AuditJobs jobs={jobs} now={now} />
          )}
        </>
      ) : (
        <p className="prose small muted">
          Scanning from the dashboard is not set up here, so scans run from the command line and
          you upload the report below. <Link href="/about">How AccessLens works</Link>.
        </p>
      )}

      <UploadForm />

      {runs.length === 0 ? (
        <div className="sheet">
          <div className="empty stack-tight">
            <h2>No runs yet</h2>
            <p className="prose muted">Produce a report on the command line, then upload it above:</p>
            <code className="code-well">
              uv run accesslens crawl https://example.com --i-have-permission &gt; crawl.json
            </code>
            <p className="prose muted small">
              For a single page, <code className="mono">uv run accesslens scan &lt;url&gt;</code>.
              {auditsEnabled
                ? ' Or run an audit above, and open its results when it finishes.'
                : ' Scans run in real Chromium, which is why they stay on the command line here.'}
            </p>
          </div>
        </div>
      ) : (
        <section aria-labelledby="runs-heading" className="stack-tight">
          {/*
            Visible, unlike the other headings' hidden siblings elsewhere: this is the table
            the page is named after, and it was the only block on the screen without a
            heading of its own, sitting below two forms that had one.
          */}
          <h2 id="runs-heading">Your runs</h2>
          <div className="sheet table-scroll">
            <table className="data-table">
              <caption className="visually-hidden">
                Uploaded runs with their severity band counts
              </caption>
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Kind</th>
                  {BANDS.map((band) => (
                    <th key={band} scope="col" className="num">
                      <span className={`band-${band}`} style={{ color: 'var(--band)' }}>
                        {BAND_LABELS[band]}
                      </span>
                    </th>
                  ))}
                  <th scope="col">Uploaded</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <th scope="row" style={{ fontWeight: 400 }}>
                      <Link href={`/runs/${run.id}`} style={{ fontWeight: 600 }}>
                        {run.label ?? run.target_url}
                      </Link>
                      {run.label !== null ? (
                        <div className="mono xsmall muted">{run.target_url}</div>
                      ) : null}
                      <div className="xsmall muted">
                        Run #{numbers.get(run.id)} of this site ·{' '}
                        <Link href={historyHref(run)}>
                          history
                          <span className="visually-hidden">
                            {' '}
                            of {run.kind} runs of {run.target_url}
                          </span>
                        </Link> · accesslens{' '}
                        {run.tool_version}
                      </div>
                    </th>
                    <td>{run.kind === 'crawl' ? 'Crawl' : 'Scan'}</td>
                    {BANDS.map((band) => (
                      <td key={band} className="num" data-zero={run.site_bands[band] === 0}>
                        {run.site_bands[band]}
                      </td>
                    ))}
                    <td>{formatDateTime(run.created_at)}</td>
                    {/* Without this the column collapses to its longest word and the
                        disclosure marker sits on a line of its own above "Delete". */}
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <details>
                        {/*
                          Every row's control said only "Delete". A screen reader lists them
                          as four identical controls with nothing to tell them apart, so the
                          run each one would delete is named in the control itself (2.4.6).
                        */}
                        <summary className="small">
                          Delete
                          <span className="visually-hidden">
                            {' '}
                            {run.label ?? run.target_url}
                          </span>
                        </summary>
                        <form action={removeRun} style={{ marginTop: 'var(--space-2)' }}>
                          <input type="hidden" name="id" value={run.id} />
                          <button type="submit" className="button button--danger">
                            Delete this run
                            <span className="visually-hidden">
                              {' '}
                              — {run.label ?? run.target_url}
                            </span>
                          </button>
                        </form>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted prose">
            Deleting a run removes its pages and findings with it. It cannot be undone — the report
            file on your machine is the only other copy.
          </p>
        </section>
      )}
    </div>
  );
}
