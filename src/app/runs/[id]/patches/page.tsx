import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BandTag } from '@/components/BandStrip';
import { PatchSummary } from '@/components/PatchSummary';
import { SetupNotice } from '@/components/SetupNotice';
import { loadPatchData, type PatchRecord } from '@/lib/db/patches';
import { loadRun } from '@/lib/db/runs';
import { formatDateTime, pluralise } from '@/lib/format';
import type { FindingRow } from '@/lib/report/map';
import {
  countPatchDecisions,
  describePatchDecision,
  patchChangedSinceDecision,
  PATCH_DECISION_SHORT_LABELS,
  type PatchReviewRecord,
} from '@/lib/review/patch-decisions';
import {
  PATCH_SOURCE_LABELS,
  PATCH_STATUSES,
  PATCH_STATUS_LABELS,
  PATCH_STATUS_NOTES,
  type PatchStatus,
} from '@/lib/review/patches';
import { isConfigured } from '@/lib/supabase/config';

import { PatchDecisionForm } from './PatchDecisionForm';
import { PatchDiff } from './PatchDiff';
import { PatchesForm } from './PatchesForm';

export const metadata: Metadata = { title: 'Source patches' };

/*
 * Never prerendered, for the same reason as the run page: this shows one user's data and
 * depends on the session cookie.
 */
export const dynamic = 'force-dynamic';

type Params = { id: string };

export default async function SourcePatchesPage({ params }: { params: Promise<Params> }) {
  if (!isConfigured()) return <SetupNotice />;

  const { id } = await params;
  const loaded = await loadRun(id);
  if (loaded === null) notFound();

  const { run, findings } = loaded;
  const runName = run.label ?? (run.kind === 'crawl' ? 'Crawl' : 'Scan');
  const data = await loadPatchData(id);

  return (
    <div className="stack">
      <div className="page-head">
        <div className="stack-tight">
          <p className="small muted">
            <Link href="/runs">Runs</Link> · <Link href={`/runs/${run.id}`}>{runName}</Link>
          </p>
          <h1>Source patches</h1>
          <p className="mono small">{run.target_url}</p>
          <p className="lede">
            The edits <code className="mono">accesslens fix</code> proposed for this run&rsquo;s
            findings, and the questions it refused to answer for you. Each one is a proposal
            about your file, waiting for a person to accept it, reject it, or say it has been
            applied.
          </p>
        </div>
        <div className="row">
          <Link href={`/runs/${run.id}`} className="button button--quiet">
            Back to the run
          </Link>
        </div>
      </div>

      <div className="notice">
        <h2 className="small">What a decision here does, and does not, do</h2>
        <p className="prose small">
          This screen <strong>records decisions about proposed edits</strong>. It does not edit
          anything. No file on your machine, on a server, or anywhere else is touched by
          anything on this page — the edits are stored and displayed as text, and applying one
          is something you do yourself, in your own working copy, under version control.
        </p>
        <p className="prose small">
          Nor does a decision change the finding: its outcome, severity and band are the
          scanner&rsquo;s, and nothing here can alter them. Rejecting a patch does not dismiss
          the problem, and accepting one does not fix it — the next run is what shows whether a
          change worked.
        </p>
        <p className="prose small">
          A proposed edit is unverified. The tool checked that the text it replaces was really
          there when the patch was written; nothing checked that the replacement is correct,
          complete, or right for your site. Read every one before you use it.
        </p>
      </div>

      {data === null ? (
        <div className="notice notice--warning">
          <h2 className="small">Patch review is not set up in this database yet</h2>
          <p className="prose small">
            Run <code className="mono">supabase/migrations/0006_patch_review.sql</code> in the
            Supabase SQL editor, then reload this page. Until then the rest of the dashboard
            works unchanged.
          </p>
        </div>
      ) : (
        <PatchesBody runId={run.id} findings={findings} data={data} />
      )}
    </div>
  );
}

/** A patch, its finding and the decision about it, in the run's own display order. */
type PatchItem = {
  finding: FindingRow;
  patch: PatchRecord;
  review: PatchReviewRecord | null;
};

function PatchesBody({
  runId,
  findings,
  data,
}: {
  runId: string;
  findings: FindingRow[];
  data: NonNullable<Awaited<ReturnType<typeof loadPatchData>>>;
}) {
  const patches = new Map(data.patches.map((row) => [row.finding_hash, row]));
  const reviews = new Map(data.reviews.map((row) => [row.finding_hash, row]));

  // The run's own order — band, then criterion numerically, then selector — so a reader works
  // down the same list they saw on the run page, and the grouping below keeps it within a
  // status rather than inventing a second ordering.
  const items: PatchItem[] = findings.flatMap((finding) => {
    const patch = patches.get(finding.finding_hash);
    return patch === undefined
      ? []
      : [{ finding, patch, review: reviews.get(finding.finding_hash) ?? null }];
  });

  const counts = countPatchDecisions(
    items.map((item) => item.finding.finding_hash),
    data.reviews,
  );

  return (
    <>
      <section aria-labelledby="progress-heading" className="stack-tight">
        <h2 id="progress-heading">Progress</h2>
        <PatchSummary counts={counts} caption="Decisions recorded on this run's proposed edits" />
      </section>

      <PatchesForm runId={runId} hasPatches={items.length > 0} />

      {items.length === 0 ? (
        <section aria-labelledby="patches-heading" className="stack">
          <h2 id="patches-heading">Patches</h2>
          <div className="sheet">
            <div className="empty stack-tight">
              <h3>No patch set for this run yet</h3>
              <p className="prose muted">
                Produce it on the command line from this run&rsquo;s own report, then upload the
                file above:
              </p>
              <code className="code-well">
                uv run accesslens fix report.json --json patches.json
              </code>
              <p className="prose muted small">
                It works on a scan of a <strong>local HTML file</strong>, because only that kind
                of scan records the line and column of each finding. A scan of a live URL and a
                crawl have no file to patch.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <>
          <p className="prose small muted" role="status">
            {items.length} of {findings.length}{' '}
            {pluralise(findings.length, 'finding', 'findings')} in this run{' '}
            {pluralise(items.length, 'has', 'have')} a proposed edit or a question. Findings with
            neither are not listed here; the run page has all of them.
          </p>
          {PATCH_STATUSES.map((status) => (
            <StatusSection
              key={status}
              runId={runId}
              status={status}
              items={items.filter((item) => item.patch.status === status)}
            />
          ))}
        </>
      )}
    </>
  );
}

/**
 * One status, with its patches.
 *
 * Grouped by status, in the order `PATCH_STATUSES` fixes: the edits that can be made, then the
 * questions that need answering, then the three kinds of "the tool would not write one". An
 * empty group is not rendered at all rather than shown as a heading over nothing.
 */
function StatusSection({
  runId,
  status,
  items,
}: {
  runId: string;
  status: PatchStatus;
  items: PatchItem[];
}) {
  if (items.length === 0) return null;
  const headingId = `status-${status}`;

  return (
    <section aria-labelledby={headingId} className="stack">
      <div className="stack-tight">
        <h2 id={headingId}>
          {PATCH_STATUS_LABELS[status]} ({items.length})
        </h2>
        <p className="prose small muted">{PATCH_STATUS_NOTES[status]}</p>
      </div>
      <div className="sheet">
        {items.map((item) => (
          <PatchItemView key={item.patch.finding_hash} runId={runId} item={item} />
        ))}
      </div>
    </section>
  );
}

/**
 * One finding, the edit proposed for it, and the decision controls.
 *
 * Everything shown here came from a scanned page, from a rule that read it, or from a language
 * model, and all three are treated as hostile: every value below lands in a text node, which
 * React escapes. There is no `dangerouslySetInnerHTML` in this project and there must not be —
 * `old_text` and `new_text` are fragments of somebody's HTML by definition, and rendering
 * either as markup would put live elements from an audited page into this one.
 */
function PatchItemView({ runId, item }: { runId: string; item: PatchItem }) {
  const { finding, patch, review } = item;
  const decision = review?.decision ?? 'pending';
  const stale = patchChangedSinceDecision(patch.imported_at, review?.decided_at ?? null);
  const hasEdit = patch.old_text !== '' || patch.new_text !== '';
  const where =
    patch.path === ''
      ? `line ${patch.start_line}`
      : `${patch.path} line ${patch.start_line}`;

  return (
    <article className={`finding band-${finding.band}`}>
      <div className="finding__head">
        <BandTag band={finding.band} />
        <h3 className="finding__criterion">
          <span className="mono">{finding.criterion}</span> {finding.criterion_name}
        </h3>
        <span className="status-tag" data-patch-status={patch.status}>
          {PATCH_STATUS_LABELS[patch.status]}
        </span>
        <span className="status-tag" data-decision={decision}>
          {PATCH_DECISION_SHORT_LABELS[decision]}
        </span>
      </div>

      <p className="finding__message">{finding.message}</p>

      <dl className="evidence">
        <dt>Where</dt>
        <dd className="mono">
          {patch.path === '' ? 'file not recorded' : patch.path} · line {patch.start_line},
          column {patch.start_column}
        </dd>
        <dt>Element</dt>
        <dd>
          <code className="code-well xsmall">{finding.snippet}</code>
        </dd>
        <dt>Proposed by</dt>
        <dd>
          {PATCH_SOURCE_LABELS[patch.source]}
          {patch.rule_id === '' ? '' : ` · ${patch.rule_id}`}
        </dd>
        <dt>Imported</dt>
        <dd>{formatDateTime(patch.imported_at)}</dd>
      </dl>

      {patch.status === 'needs-input' ? (
        <div className="question">
          <h4 className="question__label">A question only you can answer</h4>
          <p className="prose question__text">
            {patch.question ??
              'This finding needs a person to decide what the value should be. The patch file ' +
                'carried no question for it, so read the finding above and decide from that.'}
          </p>
          {patch.description !== '' ? (
            <p className="prose small muted">{patch.description}</p>
          ) : null}
        </div>
      ) : (
        <div className="patch">
          <h4 className="patch__label">
            {patch.description === '' ? 'Proposed edit' : patch.description}
          </h4>
          {hasEdit ? (
            <PatchDiff oldText={patch.old_text} newText={patch.new_text} />
          ) : (
            <p className="prose small muted">
              No edit text was written for this finding, so there is nothing to compare. The
              fix is yours to make; the position above is where the scanner found the problem.
            </p>
          )}
          {patch.question !== null ? (
            <p className="prose small">
              <strong>The tool also asks: </strong>
              {patch.question}
            </p>
          ) : null}
        </div>
      )}

      <div className="stack-tight decision__state">
        <p className="small">
          <strong>Decision: </strong>
          {describePatchDecision(review, formatDateTime)}
        </p>
        {stale ? (
          <p className="small">
            This patch was imported after the decision was made, so the decision may be about an
            edit that is no longer the one shown above. Decide again if it matters.
          </p>
        ) : null}
        {review?.decision === 'rejected' && review.reason !== null ? (
          <p className="small">
            <strong>Reason given: </strong>
            {review.reason}
          </p>
        ) : null}
      </div>

      <PatchDecisionForm
        runId={runId}
        findingHash={patch.finding_hash}
        criterion={finding.criterion}
        where={where}
        review={review}
      />
    </article>
  );
}
