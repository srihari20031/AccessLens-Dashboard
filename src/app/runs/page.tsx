import type { Metadata } from 'next';
import Link from 'next/link';

import { BandChips } from '@/components/BandStrip';
import { SetupNotice } from '@/components/SetupNotice';
import { listRuns } from '@/lib/db/runs';
import { BANDS, BAND_LABELS } from '@/lib/report/bands';
import type { RunSummary } from '@/lib/db/runs';
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

      {/*
        Collapsed unless there is nothing to list: the list is what a returning user came for,
        and this used to be the tallest block on the page, above it, on every visit.
      */}
      <UploadForm defaultOpen={runs.length === 0} />

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

          {/*
            Below 40rem the table is replaced by this list rather than restyled. Setting
            `display: block` on table elements takes their roles away in Chromium and Firefox,
            and the header associations are the only thing tying a "3" to "Critical"; a second
            rendering keeps real markup on both sides of the breakpoint. Whichever copy is not
            in use is `display: none`, which takes it out of the accessibility tree too, so
            nothing here is announced twice.
          */}
          <ul className="sheet narrow-cards">
            {runs.map((run) => (
              <RunCard key={run.id} run={run} number={numbers.get(run.id)} />
            ))}
          </ul>

          <div className="sheet table-scroll wide-table">
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

/**
 * One run, for the narrow layout.
 *
 * The same facts as the table row, in the order they are asked for: which run, then how bad
 * it is. The counts are chips rather than columns because at 390px the columns were behind a
 * sideways scroll, so "does this run have three criticals?" could not be answered without
 * dragging the table.
 */
function RunCard({ run, number }: { run: RunSummary; number: number | undefined }) {
  const name = run.label ?? run.target_url;

  return (
    <li className="narrow-card">
      <div className="stack-tight">
        <Link href={`/runs/${run.id}`} style={{ fontWeight: 600 }}>
          {name}
        </Link>
        {run.label !== null ? <div className="mono xsmall muted">{run.target_url}</div> : null}
        <div className="xsmall muted">
          {run.kind === 'crawl' ? 'Crawl' : 'Scan'} · Run #{number} of this site ·{' '}
          <Link href={historyHref(run)}>
            history
            <span className="visually-hidden">
              {' '}
              of {run.kind} runs of {run.target_url}
            </span>
          </Link>{' '}
          · accesslens {run.tool_version} · uploaded {formatDateTime(run.created_at)}
        </div>
      </div>

      <BandChips counts={run.site_bands} label={`Severity band counts for ${name}`} />

      <details>
        <summary className="small">
          Delete
          <span className="visually-hidden"> {name}</span>
        </summary>
        <form action={removeRun} style={{ marginTop: 'var(--space-2)' }}>
          <input type="hidden" name="id" value={run.id} />
          <button type="submit" className="button button--danger">
            Delete this run
            <span className="visually-hidden"> — {name}</span>
          </button>
        </form>
      </details>
    </li>
  );
}
