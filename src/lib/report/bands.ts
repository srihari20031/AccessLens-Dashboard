/**
 * The four bands a non-passing finding is reported in.
 *
 * Mirrors `src/accesslens/scoring/bands.py`: a fail lands in its severity's band, a
 * needs-manual-review finding always lands in the review band however severe it is, and
 * a pass lands in no band at all. The dashboard re-derives bands for schema-1 (scan)
 * reports, which do not carry one, so this file is the single place that rule lives.
 */

export const BANDS = ['critical', 'serious', 'moderate', 'needs-manual-review'] as const;
export type Band = (typeof BANDS)[number];

export const SEVERITIES = ['critical', 'serious', 'moderate'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const OUTCOMES = ['pass', 'fail', 'needs-manual-review'] as const;
export type Outcome = (typeof OUTCOMES)[number];

export type BandCounts = Record<Band, number>;

/** Never colour alone: every band is rendered with this text label beside it. */
export const BAND_LABELS: Record<Band, string> = {
  critical: 'Critical',
  serious: 'Serious',
  moderate: 'Moderate',
  'needs-manual-review': 'Needs manual review',
};

export const OUTCOME_LABELS: Record<Outcome, string> = {
  pass: 'Pass',
  fail: 'Fail',
  'needs-manual-review': 'Needs manual review',
};

/** The three bands that are confirmed failures. `needs-manual-review` is not one. */
export const FAILURE_BANDS: readonly Band[] = ['critical', 'serious', 'moderate'];

export function emptyBandCounts(): BandCounts {
  return { critical: 0, serious: 0, moderate: 0, 'needs-manual-review': 0 };
}

export function bandOf(outcome: Outcome, severity: Severity | null): Band | null {
  if (outcome === 'pass') return null;
  if (outcome === 'needs-manual-review') return 'needs-manual-review';
  if (severity === null) {
    // Unreachable for a report the validator accepted: it enforces PASS <=> severity null.
    throw new Error('a failing finding must carry a severity');
  }
  return severity;
}

export function countBands(bands: Iterable<Band | null>): BandCounts {
  const counts = emptyBandCounts();
  for (const band of bands) {
    if (band !== null) counts[band] += 1;
  }
  return counts;
}

export function addBandCounts(a: BandCounts, b: BandCounts): BandCounts {
  const total = emptyBandCounts();
  for (const band of BANDS) total[band] = a[band] + b[band];
  return total;
}

export function sumBandCounts(all: Iterable<BandCounts>): BandCounts {
  let total = emptyBandCounts();
  for (const counts of all) total = addBandCounts(total, counts);
  return total;
}

/**
 * Confirmed failures only.
 *
 * `needs-manual-review` is deliberately excluded: the project brief forbids counting an
 * unreviewed finding as a failure. Report it as its own number, never folded into this one.
 */
export function failureTotal(counts: BandCounts): number {
  return FAILURE_BANDS.reduce((total, band) => total + counts[band], 0);
}

/** Criteria order numerically, so 1.4.3 precedes 1.4.11 (string order gets that backwards). */
export function compareCriteria(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function compareBands(a: Band, b: Band): number {
  return BANDS.indexOf(a) - BANDS.indexOf(b);
}
