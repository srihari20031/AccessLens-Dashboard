import { OUTCOME_LABELS } from '@/lib/report/bands';
import type { FindingRow } from '@/lib/report/map';
import { formatEvidenceKey, formatEvidenceValue, pluralise } from '@/lib/format';

import { BandTag } from './BandStrip';

/**
 * One finding.
 *
 * Everything that came out of the scanned page — the message, the selector, the snippet, the
 * evidence values — is placed in a text node. `snippet` is raw HTML captured from the page
 * being audited; React escapes it, and it must stay that way. There is no
 * `dangerouslySetInnerHTML` anywhere in this project.
 */
export function FindingCard({ finding }: { finding: FindingRow }) {
  const evidence = Object.entries(finding.evidence);
  const pages = finding.pages;

  return (
    <article className={`finding band-${finding.band}`}>
      <div className="finding__head">
        <BandTag band={finding.band} />
        <h3 className="finding__criterion">
          <span className="mono">{finding.criterion}</span> {finding.criterion_name}
        </h3>
        <span className="muted small">{OUTCOME_LABELS[finding.outcome]}</span>
      </div>

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

      {evidence.length > 0 ? (
        <>
          <h4 className="visually-hidden">Evidence</h4>
          <dl className="evidence" style={{ marginTop: 'var(--space-3)' }}>
            {evidence.map(([key, value]) => (
              <div key={key} style={{ display: 'contents' }}>
                <dt>{formatEvidenceKey(key)}</dt>
                <dd className="mono">{formatEvidenceValue(value)}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}

      <SourceLine location={finding.source_location} />

      {pages.length > 0 ? <PagesSeen pages={pages} /> : null}

      <p className="xsmall muted" style={{ marginTop: 'var(--space-3)' }}>
        Rule {finding.rule_id} version {finding.rule_version} · identity{' '}
        <span className="mono">{finding.finding_hash.slice(0, 12)}</span>
      </p>
    </article>
  );
}

/*
 * "Cannot map to source" is an answer, not a gap (ADR 0003): a wrong line number costs a
 * developer a search before they learn to distrust the tool, so none is ever guessed.
 */
function SourceLine({ location }: { location: FindingRow['source_location'] }) {
  return (
    <p className="small" style={{ marginTop: 'var(--space-3)' }}>
      <span style={{ fontWeight: 600 }}>Source: </span>
      {location === null ? (
        <span className="muted">
          not mapped. This element was found in a page loaded from a URL, and the report records
          no source file and line for it.
        </span>
      ) : (
        <span className="mono">
          {location.path}:{location.line}:{location.column}
        </span>
      )}
    </p>
  );
}

function PagesSeen({ pages }: { pages: FindingRow['pages'] }) {
  const heading = `Seen on ${pages.length} ${pluralise(pages.length, 'page', 'pages')}`;

  if (pages.length <= 3) {
    return (
      <div style={{ marginTop: 'var(--space-3)' }}>
        <h4 className="small">{heading}</h4>
        <ul className="pages-seen">
          {pages.map((page) => (
            <li key={`${page.url}#${page.document_order}`} className="mono">
              {page.url}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <details style={{ marginTop: 'var(--space-3)' }}>
      <summary className="small">{heading}</summary>
      <ul className="pages-seen">
        {pages.map((page) => (
          <li key={`${page.url}#${page.document_order}`} className="mono">
            {page.url}
          </li>
        ))}
      </ul>
    </details>
  );
}
