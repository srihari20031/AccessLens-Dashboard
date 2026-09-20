import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BandSentence, BandStrip } from '@/components/BandStrip';
import { FindingsSection, readFilters } from '@/components/FindingsSection';
import { PagesTable, type NotVisited, type SkippedEntry } from '@/components/PagesTable';
import { PatchSummary } from '@/components/PatchSummary';
import { ReviewSummary } from '@/components/ReviewSummary';
import { SetupNotice } from '@/components/SetupNotice';
import { loadPatchData } from '@/lib/db/patches';
import { loadReviewData } from '@/lib/db/reviews';
import { listRuns, loadRun, loadRunSummary } from '@/lib/db/runs';
import { countDecisions, reviewedTotal } from '@/lib/review/decisions';
import { countPatchDecisions, patchesReviewedTotal } from '@/lib/review/patch-decisions';
import { bandDelta, numberRuns, previousRun } from '@/lib/report/history';
import { historyHref } from '@/lib/links';
import { formatDateTime, pluralise } from '@/lib/format';
import { isConfigured } from '@/lib/supabase/config';

/*
 * Never prerendered. These pages show one user's data, and what they show depends on the
 * session cookie. Without this, a build made before Supabase was configured renders the
 * setup notice and bakes it in as static — and a page of per-user data that can be
 * prerendered at all is a bug waiting to happen.
 */
export const dynamic = 'force-dynamic';


type Params = { id: string };
type Search = Record<string, string | string[] | undefined>;

/*
 * Every run page used to be titled "Run — AccessLens". Open three runs in three tabs and the
 * tab strip, the browser history and a screen reader's window list all read the same word
 * three times, which is what 2.4.2 Page Titled is for. The label the user gave the run, or
 * the address it looked at, is the thing that tells them apart.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  if (!isConfigured()) return { title: 'Run' };
  const { id } = await params;
  const run = await loadRunSummary(id).catch(() => null);
  if (run === null) return { title: 'Run not found' };
  return { title: `${run.kind === 'crawl' ? 'Crawl' : 'Scan'} of ${run.label ?? run.target_url}` };
}

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

  const [allRuns, reviewData, patchData] = await Promise.all([
    listRuns(),
    loadReviewData(id),
    loadPatchData(id),
  ]);
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

      <FixReviewSection
        runId={run.id}
        findingHashes={findings.map((finding) => finding.finding_hash)}
        data={reviewData}
      />

      <SourcePatchesSection
        runId={run.id}
        findingHashes={findings.map((finding) => finding.finding_hash)}
        data={patchData}
      />

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
 * What a person has decided about this run's AI text, without opening the review screen.
 *
 * Counts only. A decision is about the suggested wording, never about a finding, so nothing
 * here is added to, subtracted from or shown beside a band count.
 */
function FixReviewSection({
  runId,
  findingHashes,
  data,
}: {
  runId: string;
  findingHashes: string[];
  data: Awaited<ReturnType<typeof loadReviewData>>;
}) {
  // Migration 0005 has not been run. The run page says nothing about it: the review screen is
  // where that is explained, and a nag on every run page would be noise.
  if (data === null) return null;

  const withText = findingHashes.filter((hash) =>
    data.suggestions.some((suggestion) => suggestion.finding_hash === hash),
  );
  const counts = countDecisions(withText, data.reviews);

  return (
    <section aria-labelledby="review-heading" className="stack-tight">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <h2 id="review-heading">Fix review</h2>
        <Link href={`/runs/${runId}/review`} className="button button--quiet">
          {withText.length === 0 ? 'Open fix review' : 'Review the AI suggestions'}
          <span className="visually-hidden"> for this run</span>
        </Link>
      </div>
      {withText.length === 0 ? (
        <p className="prose small muted">
          This run carries no AI text. <code className="mono">accesslens explain</code> writes a
          suggested fix per finding; upload what it writes on the fix review screen, and accept,
          edit or reject each suggestion there. Nothing you decide there changes a finding.
        </p>
      ) : (
        <>
          <p className="prose small muted">
            {reviewedTotal(counts)} of {withText.length}{' '}
            {pluralise(withText.length, 'suggestion has', 'suggestions have')} been reviewed by a
            person. These are decisions about the suggested text only — no finding&rsquo;s
            outcome, severity or band is affected by them.
          </p>
          <ReviewSummary
            counts={counts}
            caption="Decisions recorded on this run's AI suggestions"
          />
        </>
      )}
    </section>
  );
}

/*
 * What `accesslens fix` proposed for this run, and what a person decided about it, without
 * opening the patch screen.
 *
 * Counts only, and the same rule as the section above: a decision is about a proposed edit,
 * never about a finding, so nothing here is added to, subtracted from or shown beside a band
 * count. Nothing on the patch screen edits a file either, which is why this section says so
 * in the one sentence it has.
 */
function SourcePatchesSection({
  runId,
  findingHashes,
  data,
}: {
  runId: string;
  findingHashes: string[];
  data: Awaited<ReturnType<typeof loadPatchData>>;
}) {
  // Migration 0006 has not been run. The run page says nothing about it: the patch screen is
  // where that is explained, and a nag on every run page would be noise. The same silence the
  // fix-review section keeps about 0005.
  if (data === null) return null;

  const withPatch = findingHashes.filter((hash) =>
    data.patches.some((patch) => patch.finding_hash === hash),
  );
  const counts = countPatchDecisions(withPatch, data.reviews);
  const questions = data.patches.filter((patch) => patch.status === 'needs-input').length;
  const ready = data.patches.filter((patch) => patch.status === 'ready').length;

  return (
    <section aria-labelledby="patches-heading" className="stack-tight">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <h2 id="patches-heading">Source patches</h2>
        <Link href={`/runs/${runId}/patches`} className="button button--quiet">
          {withPatch.length === 0 ? 'Open source patches' : 'Review the proposed edits'}
          <span className="visually-hidden"> for this run</span>
        </Link>
      </div>
      {withPatch.length === 0 ? (
        <p className="prose small muted">
          This run carries no patch set. <code className="mono">accesslens fix</code> turns a
          scan of a local HTML file into proposed edits, and into questions where no machine
          should choose the answer; upload what it writes on the source patches screen, and
          accept, reject or mark each one applied there. Nothing you decide there changes a
          finding, and nothing there edits a file.
        </p>
      ) : (
        <>
          <p className="prose small muted">
            {patchesReviewedTotal(counts)} of {withPatch.length}{' '}
            {pluralise(withPatch.length, 'proposal has', 'proposals have')} been reviewed by a
            person: {ready} {pluralise(ready, 'edit', 'edits')} ready to make and {questions}{' '}
            {pluralise(questions, 'question', 'questions')} to answer. These are decisions about
            the proposed edits only — no finding&rsquo;s outcome, severity or band is affected
            by them, and no file is changed by them.
          </p>
          <PatchSummary
            counts={counts}
            caption="Decisions recorded on this run's proposed source edits"
          />
        </>
      )}
    </section>
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
