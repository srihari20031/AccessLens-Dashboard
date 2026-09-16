/**
 * Turning a validated report into the rows the database stores.
 *
 * The point of this module is that a scan and a crawl come out the same shape. A scan
 * becomes a run with exactly one `evaluated` page; its passes are counted into that page's
 * `pass_count` and then dropped, because `run_findings` stores non-passing findings only.
 * Everything downstream — run detail, compare — then has one shape to deal with.
 */

import {
  bandOf,
  countBands,
  compareBands,
  compareCriteria,
  emptyBandCounts,
  type Band,
  type BandCounts,
  type Outcome,
  type Severity,
} from './bands';
import type { ParsedReport, RunKind, ScanFinding, SiteFinding } from './schema';

export type PageOccurrence = { url: string; document_order: number };

/** Where in source the element was written, when the CLI could map it. Null for a live URL. */
export type SourceLocation = { path: string; line: number; column: number };

export type FindingRow = {
  finding_hash: string;
  criterion: string;
  criterion_name: string;
  rule_id: string;
  rule_version: string;
  outcome: Outcome;
  severity: Severity | null;
  band: Band;
  tag: string;
  selector: string;
  snippet: string;
  evidence: Record<string, unknown>;
  message: string;
  pages: PageOccurrence[];
  source_location: SourceLocation | null;
};

export type PageRow = {
  url: string;
  depth: number | null;
  status: string;
  http_status: number | null;
  error_kind: string | null;
  bands: BandCounts;
  pass_count: number;
};

export type RunRow = {
  kind: RunKind;
  schema_version: number;
  target_url: string;
  tool_version: string;
  rule_versions: Record<string, string>;
  /** The whole `run` block as written, plus `skipped` and `not_visited` for a crawl. */
  run_meta: Record<string, unknown>;
  site_bands: BandCounts;
  label: string | null;
};

export type ImportPayload = {
  run: RunRow;
  pages: PageRow[];
  findings: FindingRow[];
};

/**
 * Stable order for display: band first (critical before serious ... before review), then
 * criterion numerically, then the selector, then the hash. The same order the CLI uses for
 * groups, with the band added because the dashboard shows the worst first.
 */
export function compareFindingRows(a: FindingRow, b: FindingRow): number {
  return (
    compareBands(a.band, b.band) ||
    compareCriteria(a.criterion, b.criterion) ||
    a.selector.localeCompare(b.selector) ||
    a.finding_hash.localeCompare(b.finding_hash)
  );
}

export function sortFindingRows(rows: readonly FindingRow[]): FindingRow[] {
  return [...rows].sort(compareFindingRows);
}

function scanFindingRow(finding: ScanFinding, band: Band, pageUrl: string): FindingRow {
  return {
    finding_hash: finding.finding_hash,
    criterion: finding.criterion,
    criterion_name: finding.criterion_name,
    rule_id: finding.rule_id,
    rule_version: finding.rule_version,
    outcome: finding.outcome,
    severity: finding.severity,
    band,
    tag: finding.element.tag,
    selector: finding.element.selector,
    snippet: finding.element.snippet,
    evidence: finding.evidence,
    message: finding.message,
    source_location: finding.source_location,
    pages: [{ url: pageUrl, document_order: finding.element.document_order }],
  };
}

function siteFindingRow(finding: SiteFinding): FindingRow {
  return {
    finding_hash: finding.finding_hash,
    criterion: finding.criterion,
    criterion_name: finding.criterion_name,
    rule_id: finding.rule_id,
    rule_version: finding.rule_version,
    outcome: finding.outcome,
    severity: finding.severity,
    band: finding.band,
    tag: finding.element.tag,
    selector: finding.element.selector,
    snippet: finding.element.snippet,
    evidence: finding.evidence,
    message: finding.message,
    source_location: finding.source_location,
    pages: [...finding.pages].sort(
      (a, b) => a.url.localeCompare(b.url) || a.document_order - b.document_order,
    ),
  };
}

/**
 * One row per distinct `finding_hash`.
 *
 * `run_findings` is unique on `(run_id, finding_hash)`, so a file that repeats a hash — the
 * CLI does not produce one, but an uploaded file is not the CLI — must not become two rows.
 * Repeats merge their page lists rather than being dropped, so nothing is hidden.
 */
function dedupeByHash(rows: readonly FindingRow[]): FindingRow[] {
  const byHash = new Map<string, FindingRow>();
  for (const row of rows) {
    const seen = byHash.get(row.finding_hash);
    if (seen === undefined) {
      byHash.set(row.finding_hash, row);
      continue;
    }
    const pages = new Map<string, PageOccurrence>();
    for (const page of [...seen.pages, ...row.pages]) {
      pages.set(`${page.url}#${page.document_order}`, page);
    }
    seen.pages = [...pages.values()].sort(
      (a, b) => a.url.localeCompare(b.url) || a.document_order - b.document_order,
    );
  }
  return [...byHash.values()];
}

/**
 * Site bands are recomputed from the stored findings rather than copied from the file.
 *
 * For a crawl the two agree by construction (`site_bands` in the writer is exactly the band
 * of each group counted once); recomputing means the totals on screen can never disagree
 * with the list of findings underneath them, whatever an uploaded file claims.
 */
function bandsOfRows(rows: readonly FindingRow[]): BandCounts {
  return countBands(rows.map((row) => row.band));
}

export function toImportPayload(parsed: ParsedReport, label: string | null): ImportPayload {
  const trimmed = label === null ? null : label.trim();
  const runLabel = trimmed ? trimmed : null;

  if (parsed.kind === 'scan') {
    const { report, run } = parsed;
    const pageUrl = run.url;
    const rows: FindingRow[] = [];
    let passCount = 0;
    for (const finding of report.findings) {
      const band = bandOf(finding.outcome, finding.severity);
      if (band === null) {
        passCount += 1;
        continue;
      }
      rows.push(scanFindingRow(finding, band, pageUrl));
    }
    const findings = sortFindingRows(dedupeByHash(rows));
    const bands = bandsOfRows(findings);
    return {
      run: {
        kind: 'scan',
        schema_version: report.schema_version,
        target_url: pageUrl,
        tool_version: run.tool_version,
        rule_versions: run.rule_versions,
        run_meta: { ...report.run },
        site_bands: bands,
        label: runLabel,
      },
      // A scan is one page, so its per-page bands are the run's bands.
      pages: [
        {
          url: pageUrl,
          depth: null,
          status: 'evaluated',
          http_status: null,
          error_kind: null,
          bands,
          pass_count: passCount,
        },
      ],
      findings,
    };
  }

  const { report, run } = parsed;
  const findings = sortFindingRows(dedupeByHash(report.findings.map(siteFindingRow)));
  return {
    run: {
      kind: 'crawl',
      schema_version: report.schema_version,
      target_url: run.start_url,
      tool_version: run.tool_version,
      rule_versions: run.rule_versions,
      run_meta: {
        ...report.run,
        skipped: report.skipped,
        not_visited: report.not_visited,
      },
      site_bands: bandsOfRows(findings),
      label: runLabel,
    },
    pages: report.pages.map((page) => ({
      url: page.url,
      depth: page.depth,
      status: page.status,
      http_status: page.http_status,
      error_kind: page.error_kind,
      bands: page.bands,
      pass_count: page.pass_count,
    })),
    findings,
  };
}

/** Totals across every evaluated page. Used for the "pages evaluated / passes" line. */
export function summarisePages(pages: readonly PageRow[]): {
  attempted: number;
  evaluated: number;
  notEvaluated: number;
  passCount: number;
  bands: BandCounts;
} {
  let evaluated = 0;
  let passCount = 0;
  let bands = emptyBandCounts();
  for (const page of pages) {
    if (page.status === 'evaluated') evaluated += 1;
    passCount += page.pass_count;
    bands = {
      critical: bands.critical + page.bands.critical,
      serious: bands.serious + page.bands.serious,
      moderate: bands.moderate + page.bands.moderate,
      'needs-manual-review': bands['needs-manual-review'] + page.bands['needs-manual-review'],
    };
  }
  return {
    attempted: pages.length,
    evaluated,
    notEvaluated: pages.length - evaluated,
    passCount,
    bands,
  };
}
