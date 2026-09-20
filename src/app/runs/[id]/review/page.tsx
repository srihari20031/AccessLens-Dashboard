import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BandTag } from '@/components/BandStrip';
import { ReviewSummary } from '@/components/ReviewSummary';
import { SetupNotice } from '@/components/SetupNotice';
import { loadReviewData, type SuggestionRecord } from '@/lib/db/reviews';
import { loadRun } from '@/lib/db/runs';
import { formatDateTime, pluralise } from '@/lib/format';
import type { FindingRow } from '@/lib/report/map';
import {
  countDecisions,
  DECISION_SHORT_LABELS,
  describeDecision,
  suggestionChangedSinceDecision,
  type ReviewRecord,
} from '@/lib/review/decisions';
import { isConfigured } from '@/lib/supabase/config';

import { readExpand, type FindingExpansion } from '@/components/FindingsSection';

import { DecisionForm } from './DecisionForm';
import { ExplanationsForm } from './ExplanationsForm';

export const metadata: Metadata = { title: 'Fix review' };

/*
 * Never prerendered, for the same reason as the run page: this shows one user's data and
 * depends on the session cookie.
 */
export const dynamic = 'force-dynamic';

type Params = { id: string };

const CONFIDENCE_WORDS = { low: 'Low', medium: 'Medium', high: 'High' } as const;

export default async function FixReviewPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const expand = readExpand(await searchParams);
  if (!isConfigured()) return <SetupNotice />;

  const { id } = await params;
  const loaded = await loadRun(id);
  if (loaded === null) notFound();

  const { run, findings } = loaded;
  const runName = run.label ?? (run.kind === 'crawl' ? 'Crawl' : 'Scan');
  const data = await loadReviewData(id);

  return (
    <div className="stack">
      <div className="page-head">
        <div className="stack-tight">
          <p className="small muted">
            <Link href="/runs">Runs</Link> · <Link href={`/runs/${run.id}`}>{runName}</Link>
          </p>
          <h1>Fix review</h1>
          <p className="mono small">{run.target_url}</p>
          <p className="lede">
            The AI text this run carries, and what a person decided about it. The scanner found
            the problems; a language model drafted words about them; this screen records a human
            judgement of those words.
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
          Accepting, editing or rejecting a suggestion records what <strong>you</strong> think of
          the <strong>suggested text</strong>. It does not change the finding: its outcome,
          severity and band are the scanner&rsquo;s, and nothing on this screen can alter them.
          Rejecting a suggestion does not dismiss the problem, and accepting one does not fix it
          — the fix happens in your code, and the next run is what shows whether it worked.
        </p>
        <p className="prose small">
          The text itself is unverified. Nothing checks that a suggested fix is correct,
          complete or even valid HTML; the model was shown the finding&rsquo;s own data and
          never the page. Read it as a draft written by a stranger who has not seen your site.
        </p>
      </div>

      {data === null ? (
        <div className="notice notice--warning">
          <h2 className="small">Fix review is not set up in this database yet</h2>
          <p className="prose small">
            Run <code className="mono">supabase/migrations/0005_fix_reviews.sql</code> in the
            Supabase SQL editor, then reload this page. Until then the rest of the dashboard
            works unchanged.
          </p>
        </div>
      ) : (
        <ReviewBody runId={run.id} findings={findings} data={data} expand={expand} />
      )}
    </div>
  );
}

function ReviewBody({
  runId,
  findings,
  data,
  expand,
}: {
  runId: string;
  findings: FindingRow[];
  data: NonNullable<Awaited<ReturnType<typeof loadReviewData>>>;
  expand: FindingExpansion;
}) {
  const suggestions = new Map(data.suggestions.map((row) => [row.finding_hash, row]));
  const reviews = new Map(data.reviews.map((row) => [row.finding_hash, row]));
  // The run's own order — band, then criterion numerically, then selector — so a reader works
  // down the same list they saw on the run page.
  const items = findings.filter((finding) => suggestions.has(finding.finding_hash));
  const counts = countDecisions(
    items.map((finding) => finding.finding_hash),
    data.reviews,
  );

  return (
    <>
      <section aria-labelledby="progress-heading" className="stack-tight">
        <h2 id="progress-heading">Progress</h2>
        <ReviewSummary counts={counts} caption="Decisions recorded on this run's AI text" />
      </section>

      <ExplanationsForm runId={runId} hasSuggestions={items.length > 0} />

      <section aria-labelledby="suggestions-heading" className="stack">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <h2 id="suggestions-heading">Suggestions</h2>
          <p className="muted small" role="status">
            {items.length} of {findings.length}{' '}
            {pluralise(findings.length, 'finding', 'findings')} in this run{' '}
            {pluralise(items.length, 'carries', 'carry')} AI text. Each suggestion opens for
            its explanation and evidence; criticals start open, and you can decide on one
            without opening it.
          </p>
          {/*
            Plain links, so expanding needs no script and has its own URL — the same decision,
            and the same cost, as the source-patches screen and the findings filters.
          */}
          {items.length > 0 ? (
            <div className="row">
              <a className="button button--quiet" href={`/runs/${runId}/review?expand=all`}>
                Expand all
                <span className="visually-hidden"> suggestions</span>
              </a>
              <a className="button button--quiet" href={`/runs/${runId}/review?expand=none`}>
                Collapse all
                <span className="visually-hidden"> suggestions</span>
              </a>
            </div>
          ) : null}
        </div>

        {items.length === 0 ? (
          <div className="sheet">
            <div className="empty stack-tight">
              <h3>No AI text for this run yet</h3>
              <p className="prose muted">
                Produce it on the command line from this run&rsquo;s own report, then upload the
                file above:
              </p>
              <code className="code-well">
                uv run accesslens explain report.json --out explanations.json
              </code>
              <p className="prose muted small">
                It needs <code className="mono">uv sync --extra ai</code> and an API key. Every
                suggestion it writes is labelled for review before use, which is what this screen
                is for.
              </p>
            </div>
          </div>
        ) : (
          <div className="sheet">
            {items.map((finding) => (
              <SuggestionItem
                key={finding.finding_hash}
                runId={runId}
                finding={finding}
                suggestion={suggestions.get(finding.finding_hash)!}
                review={reviews.get(finding.finding_hash) ?? null}
                open={expand === 'all' || (expand === null && finding.band === 'critical')}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

/**
 * One finding, the AI text about it, and the decision controls.
 *
 * Everything shown here came from a scanned page or from a language model, and both are
 * treated as hostile: every value below lands in a text node, which React escapes. There is
 * no `dangerouslySetInnerHTML` in this project and there must not be — a suggested fix is
 * usually a fragment of HTML, and rendering it as markup would let a model (or a page that
 * talked one into it) put live elements into this page.
 */
function SuggestionItem({
  runId,
  finding,
  suggestion,
  review,
  open,
}: {
  runId: string;
  finding: FindingRow;
  suggestion: SuggestionRecord;
  review: ReviewRecord | null;
  open: boolean;
}) {
  const decision = review?.decision ?? 'pending';
  const stale = suggestionChangedSinceDecision(suggestion.imported_at, review?.decided_at ?? null);

  /*
   * Collapsed to one line, exactly as the sibling source-patches screen is: a reviewer moves
   * between the two and they must behave the same way. The decision controls stay *outside*
   * the disclosure, so twenty suggestions can be accepted or rejected without opening one,
   * and nothing interactive is nested inside the <summary>.
   */
  return (
    <article className={`finding finding--collapsible band-${finding.band}`}>
      <details open={open}>
        <summary className="finding__summary">
          <h3 className="finding__criterion">
            <BandTag band={finding.band} /> <span className="mono">{finding.criterion}</span>{' '}
            {finding.criterion_name}{' '}
            <span className="status-tag" data-decision={decision}>
              {DECISION_SHORT_LABELS[decision]}
            </span>
          </h3>
          <span className="finding__line">
            <code className="finding__element mono">{finding.snippet}</code>
            <span className="finding__excerpt">
              {suggestion.explanation !== '' ? suggestion.explanation : finding.message}
            </span>
          </span>
        </summary>
        <div className="finding__body">
          <p className="finding__message">{finding.message}</p>

          <div className="stack-tight">
            <div>
              <span className="visually-hidden">Element</span>
              <code className="code-well">{finding.snippet}</code>
            </div>
            <div>
              <span className="visually-hidden">CSS selector</span>
              <code className="code-well xsmall muted">{finding.selector}</code>
            </div>
          </div>

          <div className="suggestion">
        <h4 className="suggestion__label">AI suggestion — review before use</h4>
        {suggestion.explanation !== '' ? (
          <p className="prose small">{suggestion.explanation}</p>
        ) : (
          <p className="prose small muted">The model wrote no explanation for this finding.</p>
        )}

        {suggestion.fix !== '' ? (
          <>
            <h5 className="small">Suggested fix</h5>
            <code className="code-well">{suggestion.fix}</code>
          </>
        ) : (
          <p className="small muted">The model suggested no fix for this finding.</p>
        )}

        <dl className="evidence suggestion__meta">
          <dt>Stated confidence</dt>
          <dd>
            {suggestion.confidence === null
              ? 'None recorded'
              : `${CONFIDENCE_WORDS[suggestion.confidence]} — the model's own, not a measure of whether the fix is right`}
          </dd>
          <dt>Written by</dt>
          <dd className="mono">
            {suggestion.model ?? 'model not recorded'}
            {suggestion.prompt_version !== null ? ` · prompt ${suggestion.prompt_version}` : ''}
          </dd>
              <dt>Imported</dt>
              <dd>{formatDateTime(suggestion.imported_at)}</dd>
            </dl>
          </div>

          <div className="stack-tight decision__state">
        <p className="small">
          <strong>Decision: </strong>
          {describeDecision(review, formatDateTime)}
        </p>
        {stale ? (
          <p className="small">
            The AI text was imported after this decision was made, so the decision may be about
            wording that is no longer shown above. Decide again if it matters.
          </p>
        ) : null}
        {review?.decision === 'edited' && review.edited_fix !== null ? (
          <div>
            <h4 className="small">The fix as you edited it</h4>
            <code className="code-well">{review.edited_fix}</code>
          </div>
        ) : null}
            {review?.decision === 'rejected' && review.reason !== null ? (
              <p className="small">
                <strong>Reason given: </strong>
                {review.reason}
              </p>
            ) : null}
          </div>
        </div>
      </details>

      <DecisionForm
        runId={runId}
        findingHash={finding.finding_hash}
        criterion={finding.criterion}
        selector={finding.selector}
        suggestedFix={suggestion.fix}
        review={review}
      />
    </article>
  );
}
