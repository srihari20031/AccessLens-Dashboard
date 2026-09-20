import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Metadata } from 'next';
import Link from 'next/link';

import { BandSentence, BandStrip } from '@/components/BandStrip';
import { FindingsSection, readFilters } from '@/components/FindingsSection';
import { PagesTable, type NotVisited, type SkippedEntry } from '@/components/PagesTable';
import { toImportPayload } from '@/lib/report/map';
import { parseReport } from '@/lib/report/schema';
import { pluralise } from '@/lib/format';


/**
 * The run-detail screen rendered straight from a committed sample report.
 *
 * It exists so the UI can be looked at, and demonstrated, before a Supabase project is
 * connected. It reads one of the files in web/fixtures/, runs it through exactly the same
 * validation and mapping as an upload, and renders exactly the same components — so what you
 * see here is what a stored run looks like. It touches no database and no user data.
 */
const FIXTURES = {
  crawl: { file: 'crawl-small-site.json', name: 'Crawl of the small-site fixture' },
  contrast: { file: 'scan-contrast.json', name: 'Scan of the 1.4.3 contrast fixture page' },
  'non-text-contrast': {
    file: 'scan-non-text-contrast.json',
    name: 'Scan of the 1.4.11 non-text contrast fixture page',
  },
  index: { file: 'scan-index.json', name: 'Scan of the small-site index page' },
  'keyboard-trap': {
    file: 'scan-keyboard-trap.json',
    name: 'Scan of the 2.1.2 keyboard trap fixture page',
  },
} as const;

type FixtureKey = keyof typeof FIXTURES;

function isFixtureKey(value: string): value is FixtureKey {
  return Object.hasOwn(FIXTURES, value);
}

type Search = Record<string, string | string[] | undefined>;

/** Which sample is on screen, so five previews in five tabs are five different titles. */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Search>;
}): Promise<Metadata> {
  const params = await searchParams;
  const raw = Array.isArray(params.report) ? params.report[0] : params.report;
  const key: FixtureKey = raw !== undefined && isFixtureKey(raw) ? raw : 'crawl';
  return { title: `Preview — ${FIXTURES[key].name}` };
}

export default async function PreviewPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const raw = Array.isArray(params.report) ? params.report[0] : params.report;
  const key: FixtureKey = raw !== undefined && isFixtureKey(raw) ? raw : 'crawl';
  const chosen = FIXTURES[key];

  const file = path.join(process.cwd(), 'fixtures', chosen.file);
  const parsed = parseReport(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.ok) {
    return (
      <div className="notice notice--error">
        <h1>That sample report did not validate</h1>
        <p className="small">{parsed.message}</p>
      </div>
    );
  }

  const payload = toImportPayload(parsed.value, chosen.name);
  const { run, pages, findings } = payload;
  const filters = readFilters(params);
  const isCrawl = run.kind === 'crawl';

  const meta = run.run_meta;
  const skipped = (Array.isArray(meta.skipped) ? meta.skipped : []) as SkippedEntry[];
  const notVisited = (meta.not_visited ?? null) as NotVisited | null;

  return (
    <div className="stack">
      {/*
        The notice's "Preview" was an <h2> standing before the page's own <h1>, so the
        outline began at level 2 and dropped to level 1. It is a label on a notice, not a
        section of the document, so it is written as one.
      */}
      <div className="notice notice--ok">
        <p className="small" style={{ fontWeight: 600 }}>
          Preview
        </p>
        <p className="prose small">
          This is the run-detail screen rendered from a committed sample report in{' '}
          <code className="mono">web/fixtures/</code>, through the same validation and mapping an
          upload goes through. No database is involved. Connect Supabase to upload your own.
        </p>
      </div>

      <nav aria-label="Sample reports" className="row">
        {(Object.keys(FIXTURES) as FixtureKey[]).map((option) => (
          <Link
            key={option}
            href={`/preview?report=${option}`}
            aria-current={option === key ? 'page' : undefined}
          >
            {FIXTURES[option].name}
          </Link>
        ))}
      </nav>

      <div className="page-head">
        <div className="stack-tight">
          <h1>{run.label}</h1>
          <p className="mono small">{run.target_url}</p>
          <p className="small muted">
            {isCrawl ? 'Crawl' : 'Single-page scan'} · accesslens {run.tool_version}
          </p>
        </div>
      </div>

      <section aria-labelledby="bands-heading" className="stack-tight">
        <h2 id="bands-heading" className="visually-hidden">
          Severity bands
        </h2>
        <BandStrip counts={run.site_bands} label="Severity band counts for this run" />
        <BandSentence counts={run.site_bands} />
      </section>

      {isCrawl ? (
        <PagesTable pages={pages} skipped={skipped} notVisited={notVisited} />
      ) : (
        <section aria-labelledby="page-heading" className="stack-tight">
          <h2 id="page-heading">Page</h2>
          <div className="sheet">
            <p className="sheet__body small">
              <span className="mono">{pages[0]?.url}</span>
              <br />
              <span className="muted">
                {pages[0]?.pass_count ?? 0}{' '}
                {pluralise(pages[0]?.pass_count ?? 0, 'check passed', 'checks passed')} on this
                page. A passing check means one rule found nothing wrong, not that the page is
                accessible.
              </span>
            </p>
          </div>
        </section>
      )}

      <FindingsSection findings={findings} filters={filters} action="/preview" hiddenFields={{ report: key }} />
    </div>
  );
}
