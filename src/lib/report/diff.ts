/**
 * Comparing two runs.
 *
 * A finding's identity is its `finding_hash`, which the CLI computes with blake2b over the
 * criterion, rule id, rule version, outcome, severity, tag, selector, snippet and evidence.
 * Two consequences the UI has to be honest about:
 *
 *   - `rule_version` is inside the hash, so upgrading a rule changes every hash it produces.
 *     A run pair with differing rule versions will show findings as "fixed" and "new" that
 *     are the same problem seen by two versions of the tool. `ruleVersionDrift` finds that,
 *     and the compare screen warns before showing any numbers.
 *   - the selector is inside the hash too, so moving an element on the page changes its
 *     hash. That errs towards reporting a change that is not one, never towards hiding one.
 */

import { countBands, type Band, type BandCounts } from './bands';
import { compareFindingRows, type FindingRow } from './map';

export const DIFF_STATUSES = ['new', 'fixed', 'still-present'] as const;
export type DiffStatus = (typeof DIFF_STATUSES)[number];

export const DIFF_LABELS: Record<DiffStatus, string> = {
  new: 'New',
  fixed: 'Fixed',
  'still-present': 'Still present',
};

/** What each status means, spelled out where it is shown — these words are easy to overread. */
export const DIFF_DESCRIPTIONS: Record<DiffStatus, string> = {
  new: 'In the later run only.',
  fixed: 'In the earlier run only — the automated checks no longer report it.',
  'still-present': 'In both runs.',
};

export type DiffGroup = {
  status: DiffStatus;
  findings: FindingRow[];
  bands: BandCounts;
};

export type RunDiff = {
  new: DiffGroup;
  fixed: DiffGroup;
  stillPresent: DiffGroup;
};

function group(status: DiffStatus, findings: FindingRow[]): DiffGroup {
  const sorted = [...findings].sort(compareFindingRows);
  return { status, findings: sorted, bands: countBands(sorted.map((f) => f.band)) };
}

/**
 * Diff two runs' findings by hash.
 *
 * A "still present" finding is represented by its row from the later run, so the message and
 * evidence on screen are the later tool's words.
 */
export function diffRuns(base: readonly FindingRow[], head: readonly FindingRow[]): RunDiff {
  const baseByHash = new Map(base.map((row) => [row.finding_hash, row]));
  const headByHash = new Map(head.map((row) => [row.finding_hash, row]));

  const added: FindingRow[] = [];
  const still: FindingRow[] = [];
  for (const row of headByHash.values()) {
    if (baseByHash.has(row.finding_hash)) still.push(row);
    else added.push(row);
  }
  const fixed = [...baseByHash.values()].filter((row) => !headByHash.has(row.finding_hash));

  return {
    new: group('new', added),
    fixed: group('fixed', fixed),
    stillPresent: group('still-present', still),
  };
}

export function diffGroups(diff: RunDiff): DiffGroup[] {
  return [diff.new, diff.fixed, diff.stillPresent];
}

export type RuleVersionChange = {
  rule_id: string;
  base: string | null;
  head: string | null;
};

/**
 * Rules whose version differs between the two runs, or that only one run ran at all.
 *
 * A non-empty result means part of any difference below it is the tool changing, not the
 * site. The compare screen says so in words rather than leaving the reader to infer it.
 */
export function ruleVersionDrift(
  base: Record<string, string>,
  head: Record<string, string>,
): RuleVersionChange[] {
  const ruleIds = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();
  const changes: RuleVersionChange[] = [];
  for (const rule_id of ruleIds) {
    const from = base[rule_id] ?? null;
    const to = head[rule_id] ?? null;
    if (from !== to) changes.push({ rule_id, base: from, head: to });
  }
  return changes;
}

/** Findings that moved band between the two runs share no hash, so severity never "changes". */
export function bandTotals(diff: RunDiff): Record<DiffStatus, BandCounts> {
  return {
    new: diff.new.bands,
    fixed: diff.fixed.bands,
    'still-present': diff.stillPresent.bands,
  };
}

export type { Band, BandCounts };
