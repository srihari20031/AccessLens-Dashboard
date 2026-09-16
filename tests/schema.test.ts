import { describe, expect, it } from 'vitest';

import { parseReport, parseReportText } from '@/lib/report/schema';

import { FIXTURES, mutate, readFixture, type FixtureName } from './helpers';

function expectRejected(input: unknown): { message: string; issues: string[] } {
  const result = parseReport(input);
  if (result.ok) throw new Error('expected the report to be rejected, but it validated');
  return { message: result.message, issues: result.issues };
}

describe('the committed sample reports', () => {
  const scans: FixtureName[] = ['scanIndex', 'scanContrast', 'scanNonTextContrast'];

  it.each(scans)('validates %s as a scan', (name) => {
    const result = parseReport(readFixture(name));
    expect(result.ok, result.ok ? '' : result.issues.join('; ')).toBe(true);
    if (result.ok) expect(result.value.kind).toBe('scan');
  });

  it('validates the crawl report', () => {
    const result = parseReport(readFixture('crawlSmallSite'));
    expect(result.ok, result.ok ? '' : result.issues.join('; ')).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('crawl');
    if (result.value.kind !== 'crawl') return;
    // The CLI records a reason here for a loopback crawl, not a boolean. A schema that
    // only allowed `true` would reject every locally produced report.
    expect(result.value.run.permission_confirmed).toBe('loopback');
  });

  it('keeps every key of the run block, not just the ones it knows', () => {
    const result = parseReport(readFixture('crawlSmallSite'));
    if (!result.ok) throw new Error(result.message);
    if (result.value.kind !== 'crawl') throw new Error('expected a crawl report');
    expect(Object.keys(result.value.report.run).sort()).toEqual([
      'crawl_host',
      'limits',
      'permission_confirmed',
      'robots',
      'rule_versions',
      'settle',
      'start_url',
      'tool_version',
    ]);
    // Nested unknown keys survive too, so a newer CLI can add to `limits` without loss.
    expect(result.value.run.limits).toMatchObject({ max_depth: 3, max_pages: 50 });
  });
});

describe('rejecting what is not a report', () => {
  it('rejects a non-object', () => {
    expect(expectRejected('hello').message).toMatch(/not a JSON object/);
    expect(expectRejected([1, 2, 3]).message).toMatch(/not a JSON object/);
  });

  it('names the missing schema_version rather than listing field errors', () => {
    const { message } = expectRejected({ findings: [] });
    expect(message).toMatch(/schema_version/);
    expect(message).toMatch(/standard output/);
  });

  it('says which versions it reads when the version is unknown', () => {
    const { message } = expectRejected({ schema_version: 99 });
    expect(message).toMatch(/Unsupported schema_version 99/);
    expect(message).toMatch(/1 and 2/);
  });

  it('reports a JSON syntax error as such', () => {
    const result = parseReportText('{not json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/not valid JSON/);
      // The commonest mistake is capturing the stderr summary along with the report.
      expect(result.message).toMatch(/standard error/);
    }
  });

  it('accepts the fixture text through parseReportText', () => {
    const text = JSON.stringify(readFixture('scanIndex'));
    expect(parseReportText(text).ok).toBe(true);
  });
});

describe('the severity invariant', () => {
  it('rejects a pass that carries a severity', () => {
    const report = mutate(readFixture('scanIndex') as Record<string, unknown>, (draft) => {
      const findings = draft.findings as Array<Record<string, unknown>>;
      const pass = findings.find((f) => f.outcome === 'pass');
      if (pass === undefined) throw new Error('fixture has no pass finding');
      pass.severity = 'critical';
    });
    expect(expectRejected(report).issues.join(' ')).toMatch(/must not carry a severity/);
  });

  it('rejects a failure that carries none', () => {
    const report = mutate(readFixture('scanIndex') as Record<string, unknown>, (draft) => {
      const findings = draft.findings as Array<Record<string, unknown>>;
      const fail = findings.find((f) => f.outcome === 'fail');
      if (fail === undefined) throw new Error('fixture has no failing finding');
      fail.severity = null;
    });
    expect(expectRejected(report).issues.join(' ')).toMatch(/must carry a severity/);
  });
});

describe('the band invariant on a crawl report', () => {
  it('rejects a band that does not match the outcome', () => {
    const report = mutate(readFixture('crawlSmallSite') as Record<string, unknown>, (draft) => {
      const findings = draft.findings as Array<Record<string, unknown>>;
      findings[0].band = 'critical';
    });
    expect(expectRejected(report).issues.join(' ')).toMatch(/does not match outcome/);
  });

  it('rejects a passing finding in a site report', () => {
    const report = mutate(readFixture('crawlSmallSite') as Record<string, unknown>, (draft) => {
      const findings = draft.findings as Array<Record<string, unknown>>;
      findings[0].outcome = 'pass';
      findings[0].severity = null;
    });
    expect(expectRejected(report).issues.join(' ')).toMatch(/non-passing findings only/);
  });
});

describe('field-level checks', () => {
  it('rejects a criterion that is not dotted digits', () => {
    const report = mutate(readFixture('scanIndex') as Record<string, unknown>, (draft) => {
      (draft.findings as Array<Record<string, unknown>>)[0].criterion = '1.4.3; drop table';
    });
    expect(expectRejected(report).issues.join(' ')).toMatch(/criterion must look like/);
  });

  it('rejects a finding_hash that is not hex', () => {
    const report = mutate(readFixture('scanIndex') as Record<string, unknown>, (draft) => {
      (draft.findings as Array<Record<string, unknown>>)[0].finding_hash = 'NOT-HEX';
    });
    expect(expectRejected(report).issues.join(' ')).toMatch(/lowercase hex/);
  });

  it('requires document_order on a scan finding and forbids nothing on a site one', () => {
    const scan = mutate(readFixture('scanIndex') as Record<string, unknown>, (draft) => {
      const element = (draft.findings as Array<Record<string, unknown>>)[0].element as Record<
        string,
        unknown
      >;
      delete element.document_order;
    });
    expect(expectRejected(scan).issues.join(' ')).toMatch(/document_order/);
  });

  it('rejects a page status the crawler cannot produce', () => {
    const report = mutate(readFixture('crawlSmallSite') as Record<string, unknown>, (draft) => {
      (draft.pages as Array<Record<string, unknown>>)[0].status = 'made-up';
    });
    expect(expectRejected(report).issues.length).toBeGreaterThan(0);
  });

  it('names the file it rejected in terms the uploader can act on', () => {
    // A scan report uploaded with its version changed to 2 is a realistic mistake; the
    // message should talk about the crawl shape it was measured against.
    const report = mutate(readFixture('scanIndex') as Record<string, unknown>, (draft) => {
      draft.schema_version = 2;
    });
    expect(expectRejected(report).message).toMatch(/crawl report/);
  });
});

describe('the fixture set itself', () => {
  it('covers both schema versions', () => {
    const versions = new Set(
      (Object.keys(FIXTURES) as FixtureName[]).map(
        (name) => (readFixture(name) as { schema_version: number }).schema_version,
      ),
    );
    expect([...versions].sort()).toEqual([1, 2]);
  });
});
