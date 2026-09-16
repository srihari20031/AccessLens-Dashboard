/**
 * Validation for an uploaded AccessLens report.
 *
 * Everything in an uploaded file is untrusted. Nothing reaches the database, and nothing is
 * rendered, before it has been through here. The shapes mirror the writers in
 * `src/accesslens/report/` — schema 1 is `accesslens scan`, schema 2 is `accesslens crawl`.
 *
 * Two invariants from the Python model are re-checked rather than assumed, because a file
 * can be hand-edited between the CLI and the upload:
 *   - a finding is a pass if and only if it carries no severity;
 *   - a schema-2 finding's `band` is the band its outcome and severity imply.
 *
 * Unknown keys inside `run`, `settle`, `limits` and `evidence` are kept, not stripped: a
 * newer CLI may record more there and we would rather store it verbatim than silently lose it.
 */

import { z } from 'zod';
import { OUTCOMES, SEVERITIES, BANDS, bandOf, type Band } from './bands';

/** An arbitrary JSON object, kept key-for-key. */
const jsonObject = z.record(z.string(), z.unknown());

const ruleVersions = z.record(z.string(), z.string());

const outcomeSchema = z.enum(OUTCOMES);
const severitySchema = z.enum(SEVERITIES).nullable();
const bandSchema = z.enum(BANDS);

const sourceLocationSchema = z
  .object({ path: z.string(), line: z.number().int(), column: z.number().int() })
  .nullable();

const findingCore = {
  criterion: z.string().regex(/^\d+(\.\d+)*$/, 'criterion must look like "1.4.3"'),
  criterion_name: z.string(),
  rule_id: z.string(),
  rule_version: z.string(),
  outcome: outcomeSchema,
  severity: severitySchema,
  source_location: sourceLocationSchema,
  evidence: jsonObject,
  message: z.string(),
  finding_hash: z.string().regex(/^[0-9a-f]+$/, 'finding_hash must be lowercase hex'),
};

type SeverityShape = {
  outcome: (typeof OUTCOMES)[number];
  severity: (typeof SEVERITIES)[number] | null;
};

/** PASS <=> no severity. Enforced in `Finding.__post_init__`; re-checked here. */
function checkSeverityInvariant(finding: SeverityShape, ctx: z.RefinementCtx): void {
  if (finding.outcome === 'pass' && finding.severity !== null) {
    ctx.addIssue({
      code: 'custom',
      message: 'a pass finding must not carry a severity',
      path: ['severity'],
    });
  }
  if (finding.outcome !== 'pass' && finding.severity === null) {
    ctx.addIssue({
      code: 'custom',
      message: `a ${finding.outcome} finding must carry a severity`,
      path: ['severity'],
    });
  }
}

// ---------------------------------------------------------------- schema 1: scan

const scanElementSchema = z.object({
  tag: z.string(),
  selector: z.string(),
  snippet: z.string(),
  document_order: z.number().int().nonnegative(),
});

export const scanFindingSchema = z
  .object({ ...findingCore, element: scanElementSchema })
  .superRefine(checkSeverityInvariant);

/** The typed part of a scan run block. The whole block is stored as given. */
export const scanRunSchema = z.object({
  tool_version: z.string(),
  url: z.string(),
  settle: jsonObject,
  rule_versions: ruleVersions,
});

export const scanReportSchema = z.object({
  schema_version: z.literal(1),
  run: jsonObject,
  findings: z.array(scanFindingSchema),
});

// ---------------------------------------------------------------- schema 2: crawl

const siteElementSchema = z.object({
  tag: z.string(),
  selector: z.string(),
  snippet: z.string(),
});

export const pageOccurrenceSchema = z.object({
  url: z.string(),
  document_order: z.number().int().nonnegative(),
});

export const siteFindingSchema = z
  .object({
    ...findingCore,
    element: siteElementSchema,
    band: bandSchema,
    pages: z.array(pageOccurrenceSchema),
  })
  .superRefine((finding, ctx) => {
    checkSeverityInvariant(finding, ctx);
    if (finding.outcome === 'pass') {
      ctx.addIssue({
        code: 'custom',
        message: 'a site report lists non-passing findings only',
        path: ['outcome'],
      });
      return;
    }
    const expected = bandOf(finding.outcome, finding.severity);
    if (expected !== finding.band) {
      ctx.addIssue({
        code: 'custom',
        message: `band "${finding.band}" does not match outcome "${finding.outcome}"`,
        path: ['band'],
      });
    }
  });

export const bandCountsSchema = z.object({
  critical: z.number().int().nonnegative(),
  serious: z.number().int().nonnegative(),
  moderate: z.number().int().nonnegative(),
  'needs-manual-review': z.number().int().nonnegative(),
});

export const PAGE_STATUSES = [
  'evaluated',
  'load-error',
  'http-error',
  'redirected-off-host',
  'redirected-disallowed',
] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];

export const pageEntrySchema = z.object({
  url: z.string(),
  depth: z.number().int().nonnegative(),
  status: z.enum(PAGE_STATUSES),
  http_status: z.number().int().nullable(),
  error_kind: z.string().nullable(),
  bands: bandCountsSchema,
  pass_count: z.number().int().nonnegative(),
});

export const skippedSchema = z.object({ url: z.string(), reason: z.string() });

/** The typed part of a crawl run block. `permission_confirmed` is a bool or a reason. */
export const siteRunSchema = z.object({
  tool_version: z.string(),
  start_url: z.string(),
  crawl_host: z.string(),
  limits: jsonObject,
  robots: jsonObject,
  permission_confirmed: z.union([z.boolean(), z.string()]),
  settle: jsonObject,
  rule_versions: ruleVersions,
});

export const siteReportSchema = z.object({
  schema_version: z.literal(2),
  run: jsonObject,
  pages: z.array(pageEntrySchema),
  skipped: z.array(skippedSchema),
  not_visited: z.object({
    page_limit: z.number().int().nonnegative(),
    depth_limit: z.number().int().nonnegative(),
  }),
  findings: z.array(siteFindingSchema),
  site_bands: bandCountsSchema,
});

// ---------------------------------------------------------------- the union

export type ScanReport = z.infer<typeof scanReportSchema>;
export type SiteReport = z.infer<typeof siteReportSchema>;
export type ScanFinding = z.infer<typeof scanFindingSchema>;
export type SiteFinding = z.infer<typeof siteFindingSchema>;
export type PageEntry = z.infer<typeof pageEntrySchema>;
export type ScanRun = z.infer<typeof scanRunSchema>;
export type SiteRun = z.infer<typeof siteRunSchema>;

export type RunKind = 'scan' | 'crawl';

export type ParsedReport =
  | { kind: 'scan'; report: ScanReport; run: ScanRun }
  | { kind: 'crawl'; report: SiteReport; run: SiteRun };

export type ParseResult =
  | { ok: true; value: ParsedReport }
  | { ok: false; message: string; issues: string[] };

export const SUPPORTED_SCHEMA_VERSIONS = [1, 2] as const;

function describe(error: z.ZodError): string[] {
  return error.issues.slice(0, 20).map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

function failed(message: string, issues: string[] = []): ParseResult {
  return { ok: false, message, issues };
}

/**
 * Validate an already-parsed JSON value as an AccessLens report.
 *
 * The schema version is read first so that a wrong-file upload gets "this is not an
 * AccessLens report" rather than a wall of field errors.
 */
export function parseReport(input: unknown): ParseResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return failed('That file is not an AccessLens report: the top level is not a JSON object.');
  }
  const version = (input as Record<string, unknown>).schema_version;
  if (typeof version !== 'number') {
    return failed(
      'That file is not an AccessLens report: it has no "schema_version". Upload the JSON that ' +
        '"accesslens scan" or "accesslens crawl" writes to standard output.',
    );
  }
  if (version === 1) {
    const parsed = scanReportSchema.safeParse(input);
    if (!parsed.success) {
      return failed(
        'This looks like a scan report, but some fields are wrong.',
        describe(parsed.error),
      );
    }
    const run = scanRunSchema.safeParse(parsed.data.run);
    if (!run.success) {
      return failed('The "run" block of this scan report is incomplete.', describe(run.error));
    }
    return { ok: true, value: { kind: 'scan', report: parsed.data, run: run.data } };
  }
  if (version === 2) {
    const parsed = siteReportSchema.safeParse(input);
    if (!parsed.success) {
      return failed(
        'This looks like a crawl report, but some fields are wrong.',
        describe(parsed.error),
      );
    }
    const run = siteRunSchema.safeParse(parsed.data.run);
    if (!run.success) {
      return failed('The "run" block of this crawl report is incomplete.', describe(run.error));
    }
    return { ok: true, value: { kind: 'crawl', report: parsed.data, run: run.data } };
  }
  return failed(
    `Unsupported schema_version ${version}. This dashboard reads versions ` +
      `${SUPPORTED_SCHEMA_VERSIONS.join(' and ')}. Upgrade the dashboard, or produce the report ` +
      'with a matching version of AccessLens.',
  );
}

/** Text straight off an upload: JSON errors are reported the same way as schema errors. */
export function parseReportText(text: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failed(
      'That file is not valid JSON. The report must be exactly what the CLI writes to standard ' +
        'output — the human summary it writes to standard error is not part of it.',
      [detail],
    );
  }
  return parseReport(value);
}

export type { Band };
