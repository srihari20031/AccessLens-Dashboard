import { describe, expect, it } from 'vitest';

import { countBands, failureTotal } from '@/lib/report/bands';
import { compareFindingRows, summarisePages, toImportPayload } from '@/lib/report/map';
import { parseReport } from '@/lib/report/schema';

import { loadFixture, mutate, readFixture } from './helpers';

describe('a scan becomes a one-page run', () => {
  const payload = toImportPayload(loadFixture('scanIndex'), 'index page');

  it('records the scanned URL as the target', () => {
    expect(payload.run.kind).toBe('scan');
    expect(payload.run.schema_version).toBe(1);
    expect(payload.run.target_url).toBe('http://127.0.0.1:8000/index.html');
    expect(payload.run.label).toBe('index page');
  });

  it('has exactly one evaluated page', () => {
    expect(payload.pages).toHaveLength(1);
    expect(payload.pages[0]).toMatchObject({
      url: 'http://127.0.0.1:8000/index.html',
      status: 'evaluated',
      depth: null,
      http_status: null,
      error_kind: null,
    });
  });

  it('counts the passes onto the page and stores none of them as findings', () => {
    // The fixture holds 14 findings: 13 passes and 1 serious failure.
    expect(payload.pages[0].pass_count).toBe(13);
    expect(payload.findings).toHaveLength(1);
    expect(payload.findings.every((f) => f.outcome !== 'pass')).toBe(true);
  });

  it('gives each finding the page it was found on', () => {
    expect(payload.findings[0].pages).toEqual([
      { url: 'http://127.0.0.1:8000/index.html', document_order: expect.any(Number) },
    ]);
  });

  it('stores the run block verbatim', () => {
    const raw = readFixture('scanIndex') as { run: Record<string, unknown> };
    expect(payload.run.run_meta).toEqual(raw.run);
    expect(payload.run.tool_version).toBe(raw.run.tool_version);
  });
});

describe('a review is never counted as a failure', () => {
  // This fixture is the one that makes the rule visible: its 7 needs-manual-review findings
  // each carry severity "moderate". Banding them by severity would report 10 failures.
  const payload = toImportPayload(loadFixture('scanContrast'), null);

  it('bands every review as needs-manual-review, whatever its severity', () => {
    const reviews = payload.findings.filter((f) => f.outcome === 'needs-manual-review');
    expect(reviews).toHaveLength(7);
    expect(reviews.every((f) => f.severity === 'moderate')).toBe(true);
    expect(reviews.every((f) => f.band === 'needs-manual-review')).toBe(true);
  });

  it('reports 3 failures and 7 to review, not 10 failures', () => {
    expect(payload.run.site_bands).toEqual({
      critical: 0,
      serious: 3,
      moderate: 0,
      'needs-manual-review': 7,
    });
    expect(failureTotal(payload.run.site_bands)).toBe(3);
  });

  it('leaves the label null when it is blank', () => {
    expect(toImportPayload(loadFixture('scanContrast'), '   ').run.label).toBeNull();
    expect(toImportPayload(loadFixture('scanContrast'), ' named ').run.label).toBe('named');
  });
});

describe('a crawl keeps the shape the crawler reported', () => {
  const payload = toImportPayload(loadFixture('crawlSmallSite'), null);
  const raw = readFixture('crawlSmallSite') as {
    pages: Array<Record<string, unknown>>;
    site_bands: Record<string, number>;
    skipped: unknown;
    not_visited: unknown;
    run: Record<string, unknown>;
  };

  it('uses the start URL as the target', () => {
    expect(payload.run.kind).toBe('crawl');
    expect(payload.run.target_url).toBe('http://127.0.0.1:8000/');
  });

  it('keeps every page, evaluated or not', () => {
    expect(payload.pages).toHaveLength(raw.pages.length);
    expect(payload.pages.filter((p) => p.status === 'evaluated')).toHaveLength(10);
    expect(payload.pages.filter((p) => p.status === 'http-error')).toHaveLength(1);
  });

  it('keeps one row per distinct finding, with every page it appears on', () => {
    expect(payload.findings).toHaveLength(2);
    const onManyPages = payload.findings.find((f) => f.pages.length > 1);
    expect(onManyPages?.pages).toHaveLength(9);
  });

  it('recomputes site bands to exactly what the crawler reported', () => {
    // The two agree by construction. Recomputing is what guarantees the totals on screen
    // cannot disagree with the findings listed beneath them.
    expect(payload.run.site_bands).toEqual(raw.site_bands);
    expect(payload.run.site_bands).toEqual(countBands(payload.findings.map((f) => f.band)));
  });

  it('carries skipped and not-visited into the run metadata', () => {
    expect(payload.run.run_meta).toMatchObject({
      ...raw.run,
      skipped: raw.skipped,
      not_visited: raw.not_visited,
    });
  });
});

describe('duplicate finding hashes', () => {
  it('merge into one row instead of becoming two, which the unique index would reject', () => {
    const doubled = mutate(readFixture('crawlSmallSite') as Record<string, unknown>, (draft) => {
      const findings = draft.findings as Array<Record<string, unknown>>;
      const copy = structuredClone(findings[0]);
      copy.pages = [{ url: 'http://127.0.0.1:8000/elsewhere.html', document_order: 3 }];
      findings.push(copy);
    });
    const parsed = parseReport(doubled);
    if (!parsed.ok) throw new Error(parsed.message);

    const payload = toImportPayload(parsed.value, null);
    const hashes = payload.findings.map((f) => f.finding_hash);
    expect(new Set(hashes).size).toBe(hashes.length);

    const merged = payload.findings.find((f) => f.finding_hash === hashes[0]);
    expect(merged?.pages.map((p) => p.url)).toContain('http://127.0.0.1:8000/elsewhere.html');
  });
});

describe('finding order', () => {
  it('is worst band first, then criterion numerically, then selector', () => {
    const payload = toImportPayload(loadFixture('scanNonTextContrast'), null);
    const sorted = [...payload.findings].sort(compareFindingRows);
    expect(payload.findings).toEqual(sorted);

    const bands = payload.findings.map((f) => f.band);
    const firstReview = bands.indexOf('needs-manual-review');
    // Every failure comes before every review.
    expect(bands.slice(0, firstReview).every((b) => b !== 'needs-manual-review')).toBe(true);
  });

  it('does not depend on the order findings arrived in', () => {
    const shuffled = mutate(readFixture('scanContrast') as Record<string, unknown>, (draft) => {
      (draft.findings as unknown[]).reverse();
    });
    const parsed = parseReport(shuffled);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(toImportPayload(parsed.value, null).findings).toEqual(
      toImportPayload(loadFixture('scanContrast'), null).findings,
    );
  });
});

describe('summarisePages', () => {
  it('totals attempted, evaluated and passes across a crawl', () => {
    const payload = toImportPayload(loadFixture('crawlSmallSite'), null);
    const summary = summarisePages(payload.pages);
    expect(summary).toMatchObject({ attempted: 11, evaluated: 10, notEvaluated: 1 });
    expect(summary.passCount).toBe(50);
  });

  it('counts per-page band occurrences, which can exceed the distinct-finding total', () => {
    // One finding on nine pages is one distinct finding but nine page-level occurrences.
    const payload = toImportPayload(loadFixture('crawlSmallSite'), null);
    expect(summarisePages(payload.pages).bands.serious).toBe(10);
    expect(payload.run.site_bands.serious).toBe(2);
  });
});

describe('source location', () => {
  it('is null for every finding of a live-URL report, as the CLI writes it', () => {
    for (const name of ['scanContrast', 'crawlSmallSite'] as const) {
      const payload = toImportPayload(loadFixture(name), null);
      expect(payload.findings.every((f) => f.source_location === null)).toBe(true);
    }
  });

  it('is kept when a report maps a finding to source, never dropped', () => {
    const raw = mutate(readFixture('scanIndex') as { findings: Record<string, unknown>[] }, (draft) => {
      for (const finding of draft.findings) {
        finding.source_location = { path: 'site/index.html', line: 12, column: 5 };
      }
    });
    const parsed = parseReport(raw);
    if (!parsed.ok) throw new Error(parsed.issues.join('; '));
    expect(toImportPayload(parsed.value, null).findings[0].source_location).toEqual({
      path: 'site/index.html',
      line: 12,
      column: 5,
    });
  });
});
