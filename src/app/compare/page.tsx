import type { Metadata } from 'next';
import Link from 'next/link';

import { FindingCard } from '@/components/FindingCard';
import { SetupNotice } from '@/components/SetupNotice';
import { listRuns, loadFindings, loadRunSummary, type RunSummary } from '@/lib/db/runs';
import { BANDS, BAND_LABELS, failureTotal } from '@/lib/report/bands';
import { DIFF_DESCRIPTIONS, DIFF_LABELS, diffRuns, ruleVersionDrift } from '@/lib/report/diff';
import type { DiffGroup } from '@/lib/report/diff';
import { formatDateTime, pluralise } from '@/lib/format';
import { isConfigured } from '@/lib/supabase/config';

export const metadata: Metadata = { title: 'Compare' };

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

function runName(run: RunSummary): string {
  return run.label ?? run.target_url;
}

export default async function ComparePage({ searchParams }: { searchParams: Promise<Search> }) {
  if (!isConfigured()) return <SetupNotice />;

  const params = await searchParams;
  const baseId = one(params.base);
  const headId = one(params.head);
  const runs = await listRuns();

  return (
    <div className="stack">
      <div className="stack-tight">
        <h1>Compare two runs</h1>
        <p className="lede">
          Findings are matched by identity, not by position, so a finding counts as the same one
          only when its rule, criterion, element and evidence all match.
        </p>
      </div>

      <ChooseRuns runs={runs} baseId={baseId} headId={headId} />

      {baseId !== '' && headId !== '' ? (
        <Comparison baseId={baseId} headId={headId} />
      ) : (
        <div className="sheet">
          <p className="sheet__body prose muted">
            {runs.length < 2
              ? 'Upload at least two runs to compare them.'
              : 'Choose an earlier run and a later run, then select Compare.'}
          </p>
        </div>
      )}
    </div>
  );
}

function ChooseRuns({
  runs,
  baseId,
  headId,
}: {
  runs: RunSummary[];
  baseId: string;
  headId: string;
}) {
  return (
    <form method="get" action="/compare" className="sheet">
      <div className="sheet__body filters">
        <div className="field">
          <label htmlFor="base">Earlier run</label>
          <select id="base" name="base" defaultValue={baseId}>
            <option value="">Choose a run</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {runName(run)} — {formatDateTime(run.created_at)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="head">Later run</label>
          <select id="head" name="head" defaultValue={headId}>
            <option value="">Choose a run</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {runName(run)} — {formatDateTime(run.created_at)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="button">
          Compare
        </button>
      </div>
    </form>
  );
}

async function Comparison({ baseId, headId }: { baseId: string; headId: string }) {
  if (baseId === headId) {
    return (
      <div className="notice notice--warning">
        <h2 className="small">Those are the same run</h2>
        <p className="small">Choose two different runs to see what changed between them.</p>
      </div>
    );
  }

  const [base, head] = await Promise.all([loadRunSummary(baseId), loadRunSummary(headId)]);
  if (base === null || head === null) {
    return (
      <div className="notice notice--error">
        <h2 className="small">Run not found</h2>
        <p className="small">
          One of those runs no longer exists. <Link href="/runs">Back to your runs</Link>.
        </p>
      </div>
    );
  }

  const [baseFindings, headFindings] = await Promise.all([
    loadFindings(baseId),
    loadFindings(headId),
  ]);
  const diff = diffRuns(baseFindings, headFindings);
  const drift = ruleVersionDrift(base.rule_versions, head.rule_versions);
  const differentTarget = base.target_url !== head.target_url;

  return (
    <div className="stack">
      {drift.length > 0 ? (
        <div className="notice notice--warning">
          <h2 className="small">These runs used different rule versions</h2>
          <p className="prose small">
            A rule&rsquo;s version is part of every finding&rsquo;s identity, so a rule that changed
            between these two runs will report its findings as fixed in the earlier run and new in
            the later one, even where the page did not change. Some of the difference below is the
            tool, not the site.
          </p>
          <ul className="notice__issues">
            {drift.map((change) => (
              <li key={change.rule_id} className="mono">
                {change.rule_id}: {change.base ?? 'not run'} → {change.head ?? 'not run'}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {differentTarget ? (
        <div className="notice notice--warning">
          <h2 className="small">These runs looked at different targets</h2>
          <p className="prose small">
            Earlier: <span className="mono">{base.target_url}</span>. Later:{' '}
            <span className="mono">{head.target_url}</span>. Comparing them is allowed, but nothing
            below is a before-and-after of the same thing.
          </p>
        </div>
      ) : null}

      <section aria-labelledby="summary-heading" className="stack-tight">
        <h2 id="summary-heading">What changed</h2>
        <div className="sheet table-scroll">
          <table className="data-table">
            <caption>
              {runName(base)} ({formatDateTime(base.created_at)}) compared with {runName(head)} (
              {formatDateTime(head.created_at)})
            </caption>
            <thead>
              <tr>
                <th scope="col">Change</th>
                {BANDS.map((band) => (
                  <th key={band} scope="col" className="num">
                    <span className={`band-${band}`} style={{ color: 'var(--band)' }}>
                      {BAND_LABELS[band]}
                    </span>
                  </th>
                ))}
                <th scope="col" className="num">
                  Failures
                </th>
              </tr>
            </thead>
            <tbody>
              {[diff.new, diff.fixed, diff.stillPresent].map((group) => (
                <tr key={group.status}>
                  <th scope="row" style={{ fontWeight: 600 }}>
                    {DIFF_LABELS[group.status]}
                    <div className="xsmall muted" style={{ fontWeight: 400 }}>
                      {DIFF_DESCRIPTIONS[group.status]}
                    </div>
                  </th>
                  {BANDS.map((band) => (
                    <td key={band} className="num">
                      {group.bands[band]}
                    </td>
                  ))}
                  <td className="num">{failureTotal(group.bands)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="prose muted small">
          &ldquo;Fixed&rdquo; means the automated checks no longer report that finding. It is not
          evidence that the underlying barrier was removed — the element may simply have moved, or
          been deleted along with the page.
        </p>
      </section>

      <DiffSection group={diff.new} />
      <DiffSection group={diff.fixed} />
      <DiffSection group={diff.stillPresent} />
    </div>
  );
}

function DiffSection({ group }: { group: DiffGroup }) {
  const headingId = `diff-${group.status}`;
  const total = group.findings.length;

  return (
    <section aria-labelledby={headingId} className="stack-tight">
      <div className="row">
        <h2 id={headingId}>{DIFF_LABELS[group.status]}</h2>
        <span className="muted small">
          {total} {pluralise(total, 'finding', 'findings')}
        </span>
      </div>
      {total === 0 ? (
        <div className="sheet">
          <p className="sheet__body muted small">Nothing in this group.</p>
        </div>
      ) : (
        <details>
          <summary className="small">
            Show the {total} {pluralise(total, 'finding', 'findings')}
          </summary>
          <div className="sheet" style={{ marginTop: 'var(--space-2)' }}>
            {group.findings.map((finding) => (
              <FindingCard key={finding.finding_hash} finding={finding} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
