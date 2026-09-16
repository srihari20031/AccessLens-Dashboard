import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BandSentence, BandStrip } from '@/components/BandStrip';
import { FindingsSection, readFilters } from '@/components/FindingsSection';
import { PagesTable, type NotVisited, type SkippedEntry } from '@/components/PagesTable';
import { SetupNotice } from '@/components/SetupNotice';
import { listRuns, loadRun } from '@/lib/db/runs';
import { bandDelta, numberRuns, previousRun } from '@/lib/report/history';
import { historyHref } from '@/lib/links';
import { formatDateTime, pluralise } from '@/lib/format';
import { isConfigured } from '@/lib/supabase/config';

export const metadata: Metadata = { title: 'Run' };

/*
 * Never prerendered. These pages show one user's data, and what they show depends on the
 * session cookie. Without this, a build made before Supabase was configured renders the
 * setup notice and bakes it in as static — and a page of per-user data that can be
 * prerendered at all is a bug waiting to happen.
 */
export const dynamic = 'force-dynamic';


type Params = { id: string };
type Search = Record<string, string | string[] | undefined>;

/** `run_meta` is whatever the CLI wrote. Read it defensively; never assume a shape. */
function readMeta(meta: Record<string, unknown>) {
  const skipped: SkippedEntry[] = Array.isArray(meta.skipped)
    ? meta.skipped.flatMap((entry) =>
        typeof entry === 'object' && entry !== null
          ? [
              {
                url: String((entry as Record<string, unknown>).url ?? ''),
                reason: String((entry as Record<string, unknown>).reason ?? ''),
              },
            ]
          : [],
      )
    : [];

  const rawNotVisited = meta.not_visited;
  const notVisited: NotVisited | null =
    typeof rawNotVisited === 'object' && rawNotVisited !== null
      ? {
          page_limit: Number((rawNotVisited as Record<string, unknown>).page_limit ?? 0) || 0,
          depth_limit: Number((rawNotVisited as Record<string, unknown>).depth_limit ?? 0) || 0,
        }
      : null;

  const asObject = (value: unknown): Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  return {
    skipped,
    notVisited,
    settle: asObject(meta.settle),
    limits: asObject(meta.limits),
    robots: asObject(meta.robots),
    permission: meta.permission_confirmed,
  };
}

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  if (!isConfigured()) return <SetupNotice />;

  const { id } = await params;
  const loaded = await loadRun(id);
  if (loaded === null) notFound();

  const { run, pages, findings } = loaded;
  const filters = readFilters(await searchParams);
  const meta = readMeta(run.run_meta);
  const isCrawl = run.kind === 'crawl';

  const allRuns = await listRuns();
  const numbers = numberRuns(allRuns);
  const number = numbers.get(run.id);
  const previous = previousRun(allRuns, run.id);
  const previousName = previous !== null ? `run #${numbers.get(previous.id)}` : null;
  const toolChanged =
    previous !== null &&
    JSON.stringify(Object.entries(previous.rule_versions).sort()) !==
      JSON.stringify(Object.entries(run.rule_versions).sort());

  return (
    <div className="stack">
      <div className="page-head">
        <div className="stack-tight">
          <p className="small muted">
            <Link href="/runs">Runs</Link>
          </p>
          <h1>{run.label ?? (isCrawl ? 'Crawl' : 'Scan')}</h1>
          <p className="mono small">{run.target_url}</p>
          <p className="small muted">
            {number !== undefined ? `Run #${number} of this site · ` : null}
            {isCrawl ? 'Crawl' : 'Single-page scan'} · accesslens {run.tool_version} · uploaded{' '}
            {formatDateTime(run.created_at)}
          </p>
          <p className="small muted">{isCrawl ? crawlSummary(pages, meta) : scanSummary(meta)}</p>
        </div>
        <div className="row">
          <Link href={historyHref(run)} className="button button--quiet">
            History of this site
          </Link>
          <Link href={`/compare?base=${run.id}`} className="button button--quiet">
            Compare with another run
          </Link>
        </div>
      </div>

      <section aria-labelledby="bands-heading" className="stack-tight">
        <h2 id="bands-heading" className="visually-hidden">
          Severity bands
        </h2>
        <BandStrip
          counts={run.site_bands}
          label="Severity band counts for this run"
          change={
            previous !== null && previousName !== null
              ? { delta: bandDelta(previous.site_bands, run.site_bands), since: previousName }
              : undefined
          }
        />
        <BandSentence counts={run.site_bands} />
        {previous !== null && previousName !== null ? (
          <p className="prose small muted">
            Changes are counted against {previousName}, uploaded{' '}
            {formatDateTime(previous.created_at)}.{' '}
            <Link href={`/compare?base=${previous.id}&head=${run.id}`}>
              See which findings are new, fixed or still present
            </Link>
            .
            {toolChanged
              ? ' The two runs used different rule versions, so part of this change may be the tool rather than the site.'
              : null}
          </p>
        ) : (
          <p className="prose small muted">
            This is the first run of this site in your account, so there is nothing to count
            changes against yet.
          </p>
        )}
        {isCrawl ? (
          <p className="prose muted small">
            Each distinct finding is counted once here, however many pages it appears on.
          </p>
        ) : null}
      </section>

      {isCrawl ? (
        <PagesTable pages={pages} skipped={meta.skipped} notVisited={meta.notVisited} />
      ) : (
        <section aria-labelledby="page-heading" className="stack-tight">
          <h2 id="page-heading">Page</h2>
          <div className="sheet">
            <p className="sheet__body small">
              <span className="mono">{pages[0]?.url ?? run.target_url}</span>
              <br />
              <span className="muted">
                {pages[0]?.pass_count ?? 0}{' '}
                {pluralise(pages[0]?.pass_count ?? 0, 'check passed', 'checks passed')} on this
                page. A passing check means that one rule found nothing wrong, not that the page is
                accessible.
              </span>
            </p>
          </div>
        </section>
      )}

      <FindingsSection findings={findings} filters={filters} action={`/runs/${run.id}`} />

      <section aria-labelledby="how-heading" className="stack-tight">
        <h2 id="how-heading">How this run was made</h2>
        <div className="sheet">
          <dl className="evidence sheet__body">
            <dt>Rules</dt>
            <dd className="mono">
              {Object.entries(run.rule_versions)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([rule, version]) => `${rule}@${version}`)
                .join(', ') || '—'}
            </dd>

            <dt>Settle</dt>
            <dd className="mono">{describe(meta.settle)}</dd>

            {isCrawl ? (
              <>
                <dt>Limits</dt>
                <dd className="mono">{describe(meta.limits)}</dd>
                <dt>robots.txt</dt>
                <dd className="mono">{describe(meta.robots)}</dd>
                <dt>Permission</dt>
                <dd className="mono">{String(meta.permission ?? '—')}</dd>
              </>
            ) : null}

            <dt>Report schema</dt>
            <dd className="mono">version {run.schema_version}</dd>
          </dl>
        </div>
        <p className="prose small muted">
          A rule version is part of a finding&rsquo;s identity. Comparing two runs made by
          different rule versions will show the same problem as both fixed and new, so the compare
          screen warns when they differ.
        </p>
      </section>
    </div>
  );
}

/*
 * One line saying how the crawl was bounded, in the order a reader asks: how much was looked
 * at, how far and how fast it went, and whether it asked permission.
 */
function crawlSummary(pages: { status: string }[], meta: ReturnType<typeof readMeta>): string {
  const evaluated = pages.filter((page) => page.status === 'evaluated').length;
  const parts = [
    `${pages.length} ${pluralise(pages.length, 'page', 'pages')} attempted, ${evaluated} evaluated`,
  ];
  if (typeof meta.limits.max_depth === 'number') parts.push(`depth limit ${meta.limits.max_depth}`);
  if (typeof meta.limits.max_pages === 'number') parts.push(`page limit ${meta.limits.max_pages}`);
  if (typeof meta.limits.effective_delay_ms === 'number') {
    parts.push(`${meta.limits.effective_delay_ms} ms between requests`);
  }
  if (typeof meta.robots.status === 'string') parts.push(`robots.txt ${meta.robots.status}`);
  if (meta.permission !== undefined) parts.push(`permission: ${String(meta.permission)}`);
  return parts.join(' · ');
}

function scanSummary(meta: ReturnType<typeof readMeta>): string {
  const parts = ['One page'];
  if (typeof meta.settle.wait_until === 'string') parts.push(`waited for ${meta.settle.wait_until}`);
  if (typeof meta.settle.settle_ms === 'number') parts.push(`then ${meta.settle.settle_ms} ms to settle`);
  return parts.join(' · ');
}

function describe(value: Record<string, unknown>): string {
  const entries = Object.entries(value);
  if (entries.length === 0) return '—';
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${key}=${entry === null ? 'none' : String(entry)}`)
    .join('  ');
}
