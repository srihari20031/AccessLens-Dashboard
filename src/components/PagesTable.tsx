import { BANDS, BAND_LABELS } from '@/lib/report/bands';
import type { PageRow } from '@/lib/report/map';
import { summarisePages } from '@/lib/report/map';
import { formatPageStatus, formatSkipReason, pluralise } from '@/lib/format';

export type SkippedEntry = { url: string; reason: string };
export type NotVisited = { page_limit: number; depth_limit: number };

/**
 * Every page the crawler attempted, evaluated or not.
 *
 * A page that failed to load is as much a result as one that failed a check — it is a page
 * whose accessibility is simply unknown — so load and HTTP errors are listed here rather than
 * quietly dropped.
 */
export function PagesTable({
  pages,
  skipped,
  notVisited,
}: {
  pages: PageRow[];
  skipped: SkippedEntry[];
  notVisited: NotVisited | null;
}) {
  const summary = summarisePages(pages);

  return (
    <section aria-labelledby="pages-heading" className="stack-tight">
      <h2 id="pages-heading">Pages</h2>
      <p className="prose muted small">
        {summary.attempted} {pluralise(summary.attempted, 'page', 'pages')} attempted,{' '}
        {summary.evaluated} evaluated, {summary.notEvaluated} not evaluated. Band counts here are
        per page, so one finding on several pages is counted on each of them.
      </p>

      <div className="sheet table-scroll">
        <table className="data-table">
          <caption className="visually-hidden">Pages attempted in this run</caption>
          <thead>
            <tr>
              <th scope="col">URL</th>
              <th scope="col" className="num">
                Depth
              </th>
              <th scope="col">Status</th>
              <th scope="col" className="num">
                HTTP
              </th>
              {BANDS.map((band) => (
                <th key={band} scope="col" className="num">
                  {BAND_LABELS[band]}
                </th>
              ))}
              <th scope="col" className="num">
                Passes
              </th>
            </tr>
          </thead>
          <tbody>
            {pages.map((page) => (
              <tr key={page.url}>
                <th scope="row" style={{ fontWeight: 400 }}>
                  <span className="mono xsmall">{page.url}</span>
                </th>
                <td className="num">{page.depth ?? '—'}</td>
                <td>
                  {formatPageStatus(page.status)}
                  {page.error_kind ? <span className="muted"> ({page.error_kind})</span> : null}
                </td>
                <td className="num">{page.http_status ?? '—'}</td>
                {BANDS.map((band) => (
                  <td
                    key={band}
                    className="num"
                    data-zero={page.status === 'evaluated' && page.bands[band] === 0}
                  >
                    {page.status === 'evaluated' ? page.bands[band] : '—'}
                  </td>
                ))}
                <td className="num" data-zero={page.status === 'evaluated' && page.pass_count === 0}>
                  {page.status === 'evaluated' ? page.pass_count : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {skipped.length > 0 ? (
        <details>
          <summary className="small">
            {skipped.length} {pluralise(skipped.length, 'URL', 'URLs')} skipped before loading
          </summary>
          <ul className="pages-seen" style={{ marginTop: 'var(--space-2)' }}>
            {skipped.map((entry) => (
              <li key={entry.url}>
                <span className="mono xsmall">{entry.url}</span>{' '}
                <span className="muted">— {formatSkipReason(entry.reason)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {notVisited !== null && (notVisited.page_limit > 0 || notVisited.depth_limit > 0) ? (
        <p className="small muted prose">
          Not visited: {notVisited.page_limit} beyond the page limit, {notVisited.depth_limit}{' '}
          beyond the depth limit. Those pages were never looked at, so nothing here says anything
          about them.
        </p>
      ) : null}
    </section>
  );
}
