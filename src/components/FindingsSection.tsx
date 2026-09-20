import {
  BANDS,
  BAND_LABELS,
  compareCriteria,
  countBands,
  type Band,
} from '@/lib/report/bands';
import type { FindingRow } from '@/lib/report/map';
import { pluralise } from '@/lib/format';

import { BandTag } from './BandStrip';
import { FindingCard } from './FindingCard';

export type FindingFilters = { band: string; criterion: string; page: string };

/**
 * Which findings are open: everything, nothing, or the default (criticals only).
 *
 * It is a query parameter rather than client state so that "Expand all" is a plain link and
 * works with JavaScript off — the same decision as the filters below it, and the same cost:
 * it is a page navigation, so focus returns to the top. A `<details name>` group would have
 * needed no navigation at all, but that makes an accordion where opening one closes the rest,
 * which is the opposite of expanding them all.
 */
export type FindingExpansion = 'all' | 'none' | null;

export function readExpand(params: Record<string, string | string[] | undefined>): FindingExpansion {
  const value = Array.isArray(params.expand) ? params.expand[0] : params.expand;
  return value === 'all' || value === 'none' ? value : null;
}

/** Open by default: a critical finding, and nothing else. */
function isOpen(band: Band, expand: FindingExpansion): boolean {
  if (expand === 'all') return true;
  if (expand === 'none') return false;
  return band === 'critical';
}

export function readFilters(params: Record<string, string | string[] | undefined>): FindingFilters {
  const one = (value: string | string[] | undefined): string =>
    Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
  return { band: one(params.band), criterion: one(params.criterion), page: one(params.page) };
}

export function applyFilters(findings: FindingRow[], filters: FindingFilters): FindingRow[] {
  return findings.filter((finding) => {
    if (filters.band && finding.band !== filters.band) return false;
    if (filters.criterion && finding.criterion !== filters.criterion) return false;
    if (filters.page && !finding.pages.some((page) => page.url === filters.page)) return false;
    return true;
  });
}

function criteriaOf(findings: FindingRow[]): { value: string; label: string }[] {
  const byCriterion = new Map<string, string>();
  for (const finding of findings) byCriterion.set(finding.criterion, finding.criterion_name);
  return [...byCriterion.entries()]
    .sort(([a], [b]) => compareCriteria(a, b))
    .map(([value, name]) => ({ value, label: `${value} ${name}` }));
}

function pagesOf(findings: FindingRow[]): string[] {
  const urls = new Set<string>();
  for (const finding of findings) for (const page of finding.pages) urls.add(page.url);
  return [...urls].sort();
}

/**
 * The findings of one run, filterable.
 *
 * The filters are a plain GET form, so they work without JavaScript, every control is a real
 * labelled form field, and the resulting view has its own URL. The "Apply filters" button is
 * not decoration: without it a keyboard user would have to rely on change events firing.
 */
export function FindingsSection({
  findings,
  filters,
  expand = null,
  action,
  hiddenFields = {},
}: {
  findings: FindingRow[];
  filters: FindingFilters;
  expand?: FindingExpansion;
  action: string;
  /** Query parameters the filter form must carry through, e.g. which sample report is shown. */
  hiddenFields?: Record<string, string>;
}) {
  const shown = applyFilters(findings, filters);
  const counts = countBands(shown.map((finding) => finding.band));
  const criteria = criteriaOf(findings);
  const pages = pagesOf(findings);
  const filtered = shown.length !== findings.length;

  return (
    <section aria-labelledby="findings-heading" className="stack">
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div className="stack-tight">
          <h2 id="findings-heading">Findings</h2>
          <p className="muted small" role="status">
            Showing {shown.length} of {findings.length}{' '}
            {pluralise(findings.length, 'finding', 'findings')}
            {filtered ? ' (filtered)' : ''}. Each one opens for its element, evidence and
            source line; criticals start open.
          </p>
        </div>
        {shown.length > 0 ? (
          <div className="row">
            <a className="button button--quiet" href={expandHref(action, hiddenFields, filters, 'all')}>
              Expand all
              <span className="visually-hidden"> findings</span>
            </a>
            <a className="button button--quiet" href={expandHref(action, hiddenFields, filters, 'none')}>
              Collapse all
              <span className="visually-hidden"> findings</span>
            </a>
          </div>
        ) : null}
      </div>

      <form method="get" action={action} className="sheet">
        <div className="sheet__body filters">
          {Object.entries(hiddenFields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          {/* Filtering must not silently re-collapse what the reader expanded. */}
          {expand !== null ? <input type="hidden" name="expand" value={expand} /> : null}
          <div className="field">
            <label htmlFor="filter-band">Severity band</label>
            <select id="filter-band" name="band" defaultValue={filters.band}>
              <option value="">All bands</option>
              {BANDS.map((band) => (
                <option key={band} value={band}>
                  {BAND_LABELS[band]} ({countBands(findings.map((f) => f.band))[band]})
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="filter-criterion">Success criterion</label>
            <select id="filter-criterion" name="criterion" defaultValue={filters.criterion}>
              <option value="">All criteria</option>
              {criteria.map((criterion) => (
                <option key={criterion.value} value={criterion.value}>
                  {criterion.label}
                </option>
              ))}
            </select>
          </div>

          {pages.length > 1 ? (
            <div className="field">
              <label htmlFor="filter-page">Page</label>
              <select id="filter-page" name="page" defaultValue={filters.page}>
                <option value="">All pages</option>
                {pages.map((url) => (
                  <option key={url} value={url}>
                    {url}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <button type="submit" className="button">
            Apply filters
          </button>
          {filtered ? (
            <a className="button button--quiet" href={clearHref(action, hiddenFields, expand)}>
              Clear filters
            </a>
          ) : null}
        </div>
      </form>

      {shown.length === 0 ? (
        <div className="sheet">
          <p className="sheet__body prose muted">
            {findings.length === 0
              ? 'The automated checks reported nothing to fail or review on these pages. That is not a statement of conformance.'
              : 'No finding matches those filters. Widen them, or clear them to see everything again.'}
          </p>
        </div>
      ) : (
        BANDS.filter((band) => counts[band] > 0).map((band) => (
          <BandGroup
            key={band}
            band={band}
            findings={shown.filter((f) => f.band === band)}
            expand={expand}
          />
        ))
      )}
    </section>
  );
}

function href(action: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  return query === '' ? action : `${action}?${query}`;
}

/** Clearing the filters leaves the disclosure state alone; it is not one of them. */
function clearHref(
  action: string,
  hiddenFields: Record<string, string>,
  expand: FindingExpansion,
): string {
  return href(action, expand === null ? hiddenFields : { ...hiddenFields, expand });
}

/*
 * A plain link, not a button: no script, its own URL, and the browser's own back button
 * undoes it. It carries the filters through so expanding does not also widen the view.
 */
function expandHref(
  action: string,
  hiddenFields: Record<string, string>,
  filters: FindingFilters,
  expand: 'all' | 'none',
): string {
  const params: Record<string, string> = { ...hiddenFields, expand };
  if (filters.band) params.band = filters.band;
  if (filters.criterion) params.criterion = filters.criterion;
  if (filters.page) params.page = filters.page;
  return href(action, params);
}

function BandGroup({
  band,
  findings,
  expand,
}: {
  band: Band;
  findings: FindingRow[];
  expand: FindingExpansion;
}) {
  const headingId = `band-${band}`;
  return (
    <section aria-labelledby={headingId} className="stack-tight">
      <div className="row">
        <h3 id={headingId}>
          <BandTag band={band} />
        </h3>
        <span className="muted small">
          {findings.length} {pluralise(findings.length, 'finding', 'findings')}
        </span>
      </div>
      <div className="sheet">
        {findings.map((finding) => (
          <FindingCard
            key={finding.finding_hash}
            finding={finding}
            open={isOpen(finding.band, expand)}
          />
        ))}
      </div>
    </section>
  );
}
