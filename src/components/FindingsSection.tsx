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
  action,
  hiddenFields = {},
}: {
  findings: FindingRow[];
  filters: FindingFilters;
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
        <h2 id="findings-heading">Findings</h2>
        <p className="muted small" role="status">
          Showing {shown.length} of {findings.length}{' '}
          {pluralise(findings.length, 'finding', 'findings')}
          {filtered ? ' (filtered)' : ''}
        </p>
      </div>

      <form method="get" action={action} className="sheet">
        <div className="sheet__body filters">
          {Object.entries(hiddenFields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
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
            <a className="button button--quiet" href={clearHref(action, hiddenFields)}>
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
          <BandGroup key={band} band={band} findings={shown.filter((f) => f.band === band)} />
        ))
      )}
    </section>
  );
}

function clearHref(action: string, hiddenFields: Record<string, string>): string {
  const query = new URLSearchParams(hiddenFields).toString();
  return query === '' ? action : `${action}?${query}`;
}

function BandGroup({ band, findings }: { band: Band; findings: FindingRow[] }) {
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
          <FindingCard key={finding.finding_hash} finding={finding} />
        ))}
      </div>
    </section>
  );
}
