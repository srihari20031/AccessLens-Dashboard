import { describe, expect, it } from 'vitest';

import { diffRuns, ruleVersionDrift } from '@/lib/report/diff';
import { toImportPayload, type FindingRow } from '@/lib/report/map';

import { loadFixture } from './helpers';

const contrast = toImportPayload(loadFixture('scanContrast'), null).findings;
const nonTextContrast = toImportPayload(loadFixture('scanNonTextContrast'), null).findings;

function hashes(rows: readonly FindingRow[]): string[] {
  return rows.map((row) => row.finding_hash).sort();
}

describe('diffing a run against itself', () => {
  const diff = diffRuns(contrast, contrast);

  it('reports everything as still present', () => {
    expect(diff.stillPresent.findings).toHaveLength(contrast.length);
    expect(diff.new.findings).toHaveLength(0);
    expect(diff.fixed.findings).toHaveLength(0);
  });

  it('bands the still-present group exactly as the run itself is banded', () => {
    expect(diff.stillPresent.bands).toEqual({
      critical: 0,
      serious: 3,
      moderate: 0,
      'needs-manual-review': 7,
    });
  });
});

describe('diffing two unrelated runs', () => {
  const diff = diffRuns(contrast, nonTextContrast);

  it('reports the base-only findings as fixed and the head-only ones as new', () => {
    // The two fixture pages share no findings, so every hash moves one way or the other.
    expect(hashes(diff.fixed.findings)).toEqual(hashes(contrast));
    expect(hashes(diff.new.findings)).toEqual(hashes(nonTextContrast));
    expect(diff.stillPresent.findings).toHaveLength(0);
  });

  it('counts each group by band', () => {
    expect(diff.fixed.bands.serious).toBe(3);
    expect(diff.new.bands.serious).toBe(6);
    expect(diff.new.bands['needs-manual-review']).toBe(11);
  });
});

describe('a partial change', () => {
  const base = contrast;
  const head = [...contrast.slice(2), ...nonTextContrast.slice(0, 3)];
  const diff = diffRuns(base, head);

  it('splits into fixed, still present and new without losing or duplicating anything', () => {
    expect(diff.fixed.findings).toHaveLength(2);
    expect(diff.stillPresent.findings).toHaveLength(contrast.length - 2);
    expect(diff.new.findings).toHaveLength(3);

    const seen = [
      ...hashes(diff.fixed.findings),
      ...hashes(diff.stillPresent.findings),
      ...hashes(diff.new.findings),
    ];
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(base.length + 3);
  });

  it('takes a still-present finding from the later run, so its wording is the later one', () => {
    const fromHead = new Map(head.map((row) => [row.finding_hash, row]));
    for (const row of diff.stillPresent.findings) {
      expect(row).toBe(fromHead.get(row.finding_hash));
    }
  });

  it('sorts each group worst band first', () => {
    for (const group of [diff.new, diff.fixed, diff.stillPresent]) {
      const bands = group.findings.map((f) => f.band);
      const reviewAt = bands.indexOf('needs-manual-review');
      if (reviewAt !== -1) {
        expect(bands.slice(reviewAt).every((b) => b === 'needs-manual-review')).toBe(true);
      }
    }
  });
});

describe('ruleVersionDrift', () => {
  it('is empty when both runs ran the same rules at the same versions', () => {
    expect(ruleVersionDrift({ 'non-text-content': '1.2.0' }, { 'non-text-content': '1.2.0' })).toEqual(
      [],
    );
  });

  it('names a rule whose version changed', () => {
    expect(
      ruleVersionDrift(
        { 'non-text-content': '1.2.0', 'contrast-minimum': '1.0.0' },
        { 'non-text-content': '1.3.0', 'contrast-minimum': '1.0.0' },
      ),
    ).toEqual([{ rule_id: 'non-text-content', base: '1.2.0', head: '1.3.0' }]);
  });

  it('names a rule that only one of the runs ran at all', () => {
    expect(ruleVersionDrift({}, { 'page-title': '1.0.0' })).toEqual([
      { rule_id: 'page-title', base: null, head: '1.0.0' },
    ]);
    expect(ruleVersionDrift({ 'page-title': '1.0.0' }, {})).toEqual([
      { rule_id: 'page-title', base: '1.0.0', head: null },
    ]);
  });

  it('finds nothing between two runs of the same tool version', () => {
    // Both fixtures came from one CLI version, so a compare between them carries no warning
    // — which is what makes their differences attributable to the pages, not the tool.
    const a = toImportPayload(loadFixture('scanContrast'), null).run.rule_versions;
    const b = toImportPayload(loadFixture('scanNonTextContrast'), null).run.rule_versions;
    expect(ruleVersionDrift(a, b)).toEqual([]);
  });
});
