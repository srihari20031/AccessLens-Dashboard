import { describe, expect, it } from 'vitest';

import {
  BANDS,
  bandOf,
  compareBands,
  compareCriteria,
  countBands,
  emptyBandCounts,
  failureTotal,
  sumBandCounts,
} from '@/lib/report/bands';

describe('bandOf', () => {
  it('bands a failure by its severity', () => {
    expect(bandOf('fail', 'critical')).toBe('critical');
    expect(bandOf('fail', 'serious')).toBe('serious');
    expect(bandOf('fail', 'moderate')).toBe('moderate');
  });

  it('bands a review as review however severe it is', () => {
    // This is the rule the honesty requirement rests on: a needs-manual-review finding
    // carries a severity, but it is not a confirmed failure, so it never counts as one.
    expect(bandOf('needs-manual-review', 'moderate')).toBe('needs-manual-review');
    expect(bandOf('needs-manual-review', 'critical')).toBe('needs-manual-review');
  });

  it('puts a pass in no band', () => {
    expect(bandOf('pass', null)).toBeNull();
  });

  it('refuses a failure with no severity', () => {
    expect(() => bandOf('fail', null)).toThrow(/must carry a severity/);
  });
});

describe('countBands', () => {
  it('starts every band at zero so a missing band is reported as 0, not absent', () => {
    expect(countBands([])).toEqual(emptyBandCounts());
    expect(Object.keys(emptyBandCounts()).sort()).toEqual([...BANDS].sort());
  });

  it('ignores nulls', () => {
    expect(countBands(['serious', null, 'serious', 'needs-manual-review'])).toEqual({
      critical: 0,
      serious: 2,
      moderate: 0,
      'needs-manual-review': 1,
    });
  });
});

describe('failureTotal', () => {
  it('counts the three failure bands', () => {
    expect(failureTotal({ critical: 1, serious: 2, moderate: 3, 'needs-manual-review': 0 })).toBe(6);
  });

  it('never counts needs-manual-review as a failure', () => {
    const counts = { critical: 0, serious: 0, moderate: 0, 'needs-manual-review': 9 };
    expect(failureTotal(counts)).toBe(0);
  });
});

describe('sumBandCounts', () => {
  it('adds band by band', () => {
    expect(
      sumBandCounts([
        { critical: 1, serious: 0, moderate: 2, 'needs-manual-review': 0 },
        { critical: 0, serious: 3, moderate: 0, 'needs-manual-review': 4 },
      ]),
    ).toEqual({ critical: 1, serious: 3, moderate: 2, 'needs-manual-review': 4 });
  });
});

describe('compareCriteria', () => {
  it('orders numerically, not as strings', () => {
    // String order puts 1.4.11 before 1.4.3, which is the bug this exists to prevent.
    expect(compareCriteria('1.4.3', '1.4.11')).toBeLessThan(0);
    expect(compareCriteria('1.4.11', '1.4.3')).toBeGreaterThan(0);
    expect(compareCriteria('1.1.1', '1.4.3')).toBeLessThan(0);
    expect(compareCriteria('2.4.2', '1.4.11')).toBeGreaterThan(0);
  });

  it('is zero for equal criteria', () => {
    expect(compareCriteria('1.4.3', '1.4.3')).toBe(0);
  });

  it('sorts a list the way the reports do', () => {
    const sorted = ['1.4.11', '2.4.2', '1.1.1', '1.4.3'].sort(compareCriteria);
    expect(sorted).toEqual(['1.1.1', '1.4.3', '1.4.11', '2.4.2']);
  });
});

describe('compareBands', () => {
  it('puts the worst first and review last', () => {
    const sorted = [...BANDS].reverse().sort(compareBands);
    expect(sorted).toEqual(['critical', 'serious', 'moderate', 'needs-manual-review']);
  });
});
