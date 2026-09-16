import { emptyBandCounts, type BandCounts } from '@/lib/report/bands';
import {
  sortFindingRows,
  type FindingRow,
  type ImportPayload,
  type PageRow,
  type SourceLocation,
} from '@/lib/report/map';
import type { RunKind } from '@/lib/report/schema';
import { createClient } from '@/lib/supabase/server';

export type RunSummary = {
  id: string;
  kind: RunKind;
  schema_version: number;
  target_url: string;
  tool_version: string;
  label: string | null;
  created_at: string;
  site_bands: BandCounts;
  rule_versions: Record<string, string>;
};

export type RunDetail = RunSummary & {
  run_meta: Record<string, unknown>;
};

export type LoadedRun = {
  run: RunDetail;
  pages: PageRow[];
  findings: FindingRow[];
};

const RUN_COLUMNS =
  'id, kind, schema_version, target_url, tool_version, label, created_at, site_bands, rule_versions';
const RUN_DETAIL_COLUMNS = `${RUN_COLUMNS}, run_meta`;

/*
 * Findings are read with `*` rather than a column list so that a project which has not yet
 * run migration 0003 (which adds `source_location`) keeps working: the column is simply
 * absent and every finding reads back as not mapped to source.
 */
const FINDING_COLUMNS = '*';

/*
 * PostgREST returns at most `max-rows` rows per request (1000 on Supabase by default) and
 * says nothing when it stops. A crawl of a real site can exceed that, so every findings read
 * pages through with a stable order until a short page comes back.
 */
const PAGE_SIZE = 1000;

async function selectAllFindings(
  columns: string,
  filter: { column: 'run_id'; ids: readonly string[] },
): Promise<Record<string, unknown>[]> {
  const supabase = await createClient();
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('run_findings')
      .select(columns)
      .in(filter.column, [...filter.ids])
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

/**
 * Band counts read back from jsonb.
 *
 * The column holds what we wrote, but a missing key would render as "undefined" rather than
 * a number, so every band is filled in explicitly.
 */
function asBandCounts(value: unknown): BandCounts {
  const counts = emptyBandCounts();
  if (typeof value !== 'object' || value === null) return counts;
  for (const band of Object.keys(counts) as (keyof BandCounts)[]) {
    const found = (value as Record<string, unknown>)[band];
    if (typeof found === 'number' && Number.isFinite(found)) counts[band] = found;
  }
  return counts;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(asRecord(value))) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}

function toSummary(row: Record<string, unknown>): RunSummary {
  return {
    id: String(row.id),
    kind: row.kind === 'crawl' ? 'crawl' : 'scan',
    schema_version: Number(row.schema_version),
    target_url: String(row.target_url),
    tool_version: String(row.tool_version),
    label: typeof row.label === 'string' ? row.label : null,
    created_at: String(row.created_at),
    site_bands: asBandCounts(row.site_bands),
    rule_versions: asStringMap(row.rule_versions),
  };
}

function asSourceLocation(value: unknown): SourceLocation | null {
  const record = asRecord(value);
  if (
    typeof record.path === 'string' &&
    typeof record.line === 'number' &&
    typeof record.column === 'number'
  ) {
    return { path: record.path, line: record.line, column: record.column };
  }
  return null;
}

function toFindingRows(data: unknown[] | null): FindingRow[] {
  return sortFindingRows(
    (data ?? []).map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        finding_hash: String(row.finding_hash),
        criterion: String(row.criterion),
        criterion_name: String(row.criterion_name),
        rule_id: String(row.rule_id),
        rule_version: String(row.rule_version),
        outcome: row.outcome,
        severity: row.severity,
        band: row.band,
        tag: String(row.tag),
        selector: String(row.selector),
        snippet: String(row.snippet),
        evidence: asRecord(row.evidence),
        message: String(row.message),
        pages: Array.isArray(row.pages) ? row.pages : [],
        source_location: asSourceLocation(row.source_location),
      } as FindingRow;
    }),
  );
}

export async function listRuns(): Promise<RunSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('runs')
    .select(RUN_COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => toSummary(row as Record<string, unknown>));
}

/** One run with everything needed to render it, or null when it is not the user's. */
export async function loadRun(id: string): Promise<LoadedRun | null> {
  const supabase = await createClient();

  const { data: runRow, error: runError } = await supabase
    .from('runs')
    .select(RUN_DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (runError) throw new Error(runError.message);
  if (runRow === null) return null;

  const [pagesResult, findingsResult] = await Promise.all([
    supabase
      .from('run_pages')
      .select('url, depth, status, http_status, error_kind, bands, pass_count')
      .eq('run_id', id)
      .order('url', { ascending: true }),
    selectAllFindings(FINDING_COLUMNS, { column: 'run_id', ids: [id] }),
  ]);
  if (pagesResult.error) throw new Error(pagesResult.error.message);

  const row = runRow as Record<string, unknown>;
  return {
    run: { ...toSummary(row), run_meta: asRecord(row.run_meta) },
    pages: (pagesResult.data ?? []).map((page) => {
      const p = page as Record<string, unknown>;
      return {
        url: String(p.url),
        depth: typeof p.depth === 'number' ? p.depth : null,
        status: String(p.status),
        http_status: typeof p.http_status === 'number' ? p.http_status : null,
        error_kind: typeof p.error_kind === 'string' ? p.error_kind : null,
        bands: asBandCounts(p.bands),
        pass_count: typeof p.pass_count === 'number' ? p.pass_count : 0,
      } satisfies PageRow;
    }),
    // Sorted here rather than in SQL: the order is band, then criterion numerically, and
    // Postgres would sort "1.4.11" before "1.4.3" as text.
    findings: toFindingRows(findingsResult),
  };
}

/** Just the findings of a run, for the compare screen. */
export async function loadFindings(id: string): Promise<FindingRow[]> {
  return toFindingRows(await selectAllFindings(FINDING_COLUMNS, { column: 'run_id', ids: [id] }));
}

export type FindingIdentity = { finding_hash: string; band: FindingRow['band'] };

/**
 * The identity and band of every finding in several runs, for the history screen.
 *
 * Only the two columns the timeline needs are read, so a site with many runs does not pull
 * every snippet and evidence object over the wire.
 */
export async function loadFindingIdentities(
  runIds: readonly string[],
): Promise<Map<string, FindingIdentity[]>> {
  const byRun = new Map<string, FindingIdentity[]>(runIds.map((id) => [id, []]));
  if (runIds.length === 0) return byRun;
  const rows = await selectAllFindings('run_id, finding_hash, band', {
    column: 'run_id',
    ids: runIds,
  });
  for (const row of rows) {
    byRun.get(String(row.run_id))?.push({
      finding_hash: String(row.finding_hash),
      band: row.band as FindingRow['band'],
    });
  }
  return byRun;
}

export async function loadRunSummary(id: string): Promise<RunDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('runs')
    .select(RUN_DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data === null) return null;
  const row = data as Record<string, unknown>;
  return { ...toSummary(row), run_meta: asRecord(row.run_meta) };
}

/**
 * Insert a whole report, or none of it.
 *
 * `import_run` is a plpgsql function, so its body is one transaction: a run row can never be
 * left behind without its pages and findings. It is `security invoker`, so the same RLS
 * policies apply as to a direct insert.
 */
export async function importRun(payload: ImportPayload): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('import_run', {
    p_run: payload.run,
    p_pages: payload.pages,
    p_findings: payload.findings,
  });
  if (error) throw new Error(error.message);
  if (typeof data !== 'string') throw new Error('import_run did not return a run id');
  return data;
}

export async function deleteRun(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('runs').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function renameRun(id: string, label: string | null): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from('runs').update({ label }).eq('id', id);
  if (error) throw new Error(error.message);
}
