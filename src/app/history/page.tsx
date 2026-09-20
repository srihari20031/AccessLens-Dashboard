import type { Metadata } from 'next';
import Link from 'next/link';

import { HistoryChart } from '@/components/HistoryChart';
import { SetupNotice } from '@/components/SetupNotice';
import { listRuns, loadFindingIdentities, type RunSummary } from '@/lib/db/runs';
import { BANDS, BAND_LABELS } from '@/lib/report/bands';
import { groupSites, siteKey, siteTimeline, type Site, type TimelineEntry } from '@/lib/report/history';
import { formatDateTime, pluralise } from '@/lib/format';
import { historyHref } from '@/lib/links';
import { isConfigured } from '@/lib/supabase/config';


/*
 * Never prerendered. These pages show one user's data, and what they show depends on the
 * session cookie. Without this, a build made before Supabase was configured renders the
 * setup notice and bakes it in as static — and a page of per-user data that can be
 * prerendered at all is a bug waiting to happen.
 */
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

/*
 * One site's history is a different page from the index of sites, and from another site's
 * history, so it says which site it is (2.4.2). The URL is read straight from the query —
 * no database work for a title — and is shown as text, never as a link.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Search>;
}): Promise<Metadata> {
  const params = await searchParams;
  const url = one(params.url);
  const kind = one(params.kind);
  if (url === '' || (kind !== 'scan' && kind !== 'crawl')) return { title: 'History' };
  return { title: `History — ${kind === 'crawl' ? 'crawls' : 'scans'} of ${url}` };
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<Search> }) {
  if (!isConfigured()) return <SetupNotice />;

  const params = await searchParams;
  const kind = one(params.kind);
  const url = one(params.url);
  const sites = groupSites(await listRuns());

  if (kind === '' || url === '') return <AllSites sites={sites} />;

  const site = sites.find(
    (candidate) => candidate.key === siteKey({ kind: kind === 'crawl' ? 'crawl' : 'scan', target_url: url }),
  );
  if (site === undefined || (kind !== 'scan' && kind !== 'crawl')) {
    return (
      <div className="stack">
        <h1>History</h1>
        <div className="sheet">
          <p className="sheet__body prose">
            You have no {kind === 'crawl' ? 'crawls' : 'scans'} of{' '}
            <span className="mono">{url}</span>. They may have been deleted.{' '}
            <Link href="/history">See every site you have runs for</Link>.
          </p>
        </div>
      </div>
    );
  }

  const findings = await loadFindingIdentities(site.runs.map((run) => run.id));
  return <SiteHistory site={site} timeline={siteTimeline(site.runs, findings)} />;
}

function AllSites({ sites }: { sites: Site<RunSummary>[] }) {
  return (
    <div className="stack">
      <div className="stack-tight">
        <h1>History</h1>
        <p className="lede">
          Accessibility is re-audited, not passed once. Each site here is every run you have
          uploaded for one target, in order. A scan and a crawl of the same URL are kept apart,
          because they measure different amounts of the site.
        </p>
      </div>

      {sites.length === 0 ? (
        <div className="sheet">
          <p className="sheet__body prose muted">
            No runs yet. <Link href="/runs">Upload a report</Link> to start a history.
          </p>
        </div>
      ) : (
        <div className="sheet table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">
              Sites with uploaded runs, and the band counts of each site&rsquo;s latest run
            </caption>
            <thead>
              <tr>
                <th scope="col">Site</th>
                <th scope="col">Kind</th>
                <th scope="col" className="num">
                  Runs
                </th>
                {BANDS.map((band) => (
                  <th key={band} scope="col" className="num">
                    <span className={`band-${band}`} style={{ color: 'var(--band)' }}>
                      {BAND_LABELS[band]}
                    </span>
                    <span className="visually-hidden"> in the latest run</span>
                  </th>
                ))}
                <th scope="col">Latest upload</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => {
                const latest = site.runs[site.runs.length - 1];
                return (
                  <tr key={site.key}>
                    <th scope="row" style={{ fontWeight: 400 }}>
                      <Link href={historyHref(site)} className="mono" style={{ fontWeight: 600 }}>
                        {site.target_url}
                      </Link>
                      <span className="visually-hidden"> ({site.kind})</span>
                    </th>
                    <td>{site.kind === 'crawl' ? 'Crawl' : 'Scan'}</td>
                    <td className="num">{site.runs.length}</td>
                    {BANDS.map((band) => (
                      <td key={band} className="num">
                        {latest.site_bands[band]}
                      </td>
                    ))}
                    <td>{formatDateTime(latest.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SiteHistory({
  site,
  timeline,
}: {
  site: Site<RunSummary>;
  timeline: TimelineEntry<RunSummary>[];
}) {
  const latest = timeline[timeline.length - 1];
  const kindWord = site.kind === 'crawl' ? 'Crawl' : 'Scan';

  return (
    <div className="stack">
      <div className="stack-tight">
        <p className="small muted">
          <Link href="/history">History</Link>
        </p>
        <h1>
          <span className="mono" style={{ wordBreak: 'break-all' }}>
            {site.target_url}
          </span>
        </h1>
        <p className="small muted">
          {kindWord} · {site.runs.length} {pluralise(site.runs.length, 'run', 'runs')} · run
          numbers count this site&rsquo;s uploads in your account, oldest first
        </p>
      </div>

      {latest.change !== null ? <LatestChange entry={latest} /> : null}

      <section aria-labelledby="trend-heading" className="stack-tight">
        <h2 id="trend-heading">Band counts by run</h2>
        {timeline.length < 2 ? (
          <div className="sheet">
            <p className="sheet__body prose muted">
              Only one run so far. Upload another {kindWord.toLowerCase()} of this site to see how
              it changes.
            </p>
          </div>
        ) : (
          <div className="sheet">
            <div className="sheet__body">
              <HistoryChart timeline={timeline} />
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="runs-heading" className="stack-tight">
        <h2 id="runs-heading">Every run</h2>
        <div className="sheet table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">
              Each run of this site with its band counts and what changed since the run before it
            </caption>
            <thead>
              <tr>
                <th scope="col">Run</th>
                {BANDS.map((band) => (
                  <th key={band} scope="col" className="num">
                    <span className={`band-${band}`} style={{ color: 'var(--band)' }}>
                      {BAND_LABELS[band]}
                    </span>
                  </th>
                ))}
                <th scope="col" className="num">
                  New
                </th>
                <th scope="col" className="num">
                  Resolved
                </th>
                <th scope="col" className="num">
                  Came back
                </th>
                <th scope="col">
                  <span className="visually-hidden">Compare</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {[...timeline].reverse().map((entry, index, reversed) => {
                const earlier = reversed[index + 1];
                return (
                  <tr key={entry.run.id}>
                    <th scope="row" style={{ fontWeight: 400 }}>
                      <Link href={`/runs/${entry.run.id}`} style={{ fontWeight: 600 }}>
                        Run #{entry.number}
                      </Link>
                      {entry.run.label !== null ? (
                        <div className="small">{entry.run.label}</div>
                      ) : null}
                      <div className="xsmall muted">{formatDateTime(entry.run.created_at)}</div>
                    </th>
                    {BANDS.map((band) => (
                      <td key={band} className="num" data-zero={entry.run.site_bands[band] === 0}>
                        {entry.run.site_bands[band]}
                      </td>
                    ))}
                    <td className="num" data-zero={entry.change?.new === 0}>
                      {entry.change?.new ?? '—'}
                    </td>
                    <td className="num" data-zero={entry.change?.resolved === 0}>
                      {entry.change?.resolved ?? '—'}
                    </td>
                    <td className="num" data-zero={entry.change?.regressions === 0}>
                      {entry.change?.regressions ?? '—'}
                    </td>
                    <td>
                      {earlier !== undefined ? (
                        <Link href={`/compare?base=${earlier.run.id}&head=${entry.run.id}`} className="small">
                          Compare
                          <span className="visually-hidden">
                            {' '}
                            run #{entry.number} with run #{earlier.number}
                          </span>
                        </Link>
                      ) : (
                        <span className="small muted">First run</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="prose small muted">
          <strong>New</strong> and <strong>resolved</strong> are counted against the run before.{' '}
          <strong>Came back</strong> counts new findings that an even earlier run had already
          reported: a problem that was gone and has returned. &ldquo;Resolved&rdquo; means the
          automated checks no longer report a finding, not that the barrier was removed.
        </p>
      </section>
    </div>
  );
}

function LatestChange({ entry }: { entry: TimelineEntry<RunSummary> }) {
  const change = entry.change;
  if (change === null) return null;

  return (
    <section aria-labelledby="latest-heading" className="sheet">
      <div className="sheet__body stack-tight">
        <h2 id="latest-heading">
          Run #{entry.number} compared with run #{change.previous_number}
        </h2>
        <ul className="prose">
          <li>
            {change.resolved} {pluralise(change.resolved, 'finding', 'findings')} no longer
            reported
          </li>
          <li>
            {change.new} new {pluralise(change.new, 'finding', 'findings')}
          </li>
          <li>
            {change.still_present} still present
          </li>
          <li>
            {change.regressions} {pluralise(change.regressions, 'finding', 'findings')} that had
            gone and came back
          </li>
        </ul>
        {change.rule_versions_changed ? (
          <p className="notice notice--warning small">
            These two runs used different rule versions. A rule version is part of every
            finding&rsquo;s identity, so some of the &ldquo;new&rdquo; and &ldquo;no longer
            reported&rdquo; findings may be the same problem seen by two versions of the tool.
          </p>
        ) : null}
      </div>
    </section>
  );
}
