import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseReport, type ParsedReport } from '@/lib/report/schema';

/**
 * The committed sample reports.
 *
 * They are real CLI output, produced by serving the repository's own fixture pages on
 * loopback and scanning/crawling them — see web/README.md. Regenerating them is a deliberate
 * act: several tests below assert the counts these particular files contain, which is what
 * makes them a regression test of the mapping rather than a restatement of it.
 */
/** Saved scan and crawl reports: every one of these must validate as a report. */
export const REPORT_FIXTURES = {
  scanIndex: 'scan-index.json',
  scanContrast: 'scan-contrast.json',
  scanNonTextContrast: 'scan-non-text-contrast.json',
  crawlSmallSite: 'crawl-small-site.json',
  scanKeyboardTrap: 'scan-keyboard-trap.json',
} as const;

/*
 * The CLI's other outputs, which are not reports and carry no `schema_version`:
 * `accesslens explain --out` and `accesslens fix --json`. They live here so the
 * importers are tested against what the tool really writes rather than against a
 * hand-built guess — reading an explanations file the wrong way was a real bug.
 */
export const DATA_FIXTURES = {
  demoExplanations: 'demo-explanations.json',
  demoPatches: 'demo-patches.json',
} as const;

export const FIXTURES = { ...REPORT_FIXTURES, ...DATA_FIXTURES } as const;

export type ReportFixtureName = keyof typeof REPORT_FIXTURES;
export type FixtureName = keyof typeof FIXTURES;

const fixturesDir = fileURLToPath(new URL('../fixtures/', import.meta.url));

export function readFixture(name: FixtureName): unknown {
  return JSON.parse(readFileSync(path.join(fixturesDir, FIXTURES[name]), 'utf8'));
}

/** A fixture as a validated report. Throws loudly if a sample file ever stops validating. */
export function loadFixture(name: FixtureName): ParsedReport {
  const result = parseReport(readFixture(name));
  if (!result.ok) {
    throw new Error(`fixture ${FIXTURES[name]} failed validation: ${result.issues.join('; ')}`);
  }
  return result.value;
}

/** A deep clone, so a test can corrupt one field without disturbing the others. */
export function mutate<T>(value: T, change: (draft: T) => void): T {
  const clone = structuredClone(value);
  change(clone);
  return clone;
}
