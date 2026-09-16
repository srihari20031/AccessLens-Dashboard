/**
 * Audit history: runs of the same site, in order, and what changed between them.
 *
 * A "site" is a kind and a target URL together. A scan of one page and a crawl starting at the
 * same URL are different measurements — a crawl counts every page it reached — so putting
 * them on one timeline would show a change that is only the method changing.
 *
 * Run numbers are derived, not stored: run #3 is the third upload of that site still in the
 * account. Deleting a run renumbers the later ones. That is the honest reading of a number
 * computed from what exists, and it needs no database change.
 */

import { BANDS, emptyBandCounts, type Band, type BandCounts } from './bands';
import type { RunKind } from './schema';

export type HistoryRun = {
  id: string;
  kind: RunKind;
  target_url: string;
  created_at: string;
  site_bands: BandCounts;
  rule_versions: Record<string, string>;
};

export type FindingIdentity = { finding_hash: string; band: Band };

export function siteKey(run: { kind: RunKind; target_url: string }): string {
  return `${run.kind} ${run.target_url}`;
}

/** Oldest first; a timestamp tie is broken by id so the order never depends on the query. */
function compareUploads(a: HistoryRun, b: HistoryRun): number {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

function runsOfSite<T extends HistoryRun>(runs: readonly T[], key: string): T[] {
  return runs.filter((run) => siteKey(run) === key).sort(compareUploads);
}

/** run id -> its 1-based position among the uploads of its site. */
export function numberRuns(runs: readonly HistoryRun[]): Map<string, number> {
  const numbers = new Map<string, number>();
  const counters = new Map<string, number>();
  for (const run of [...runs].sort(compareUploads)) {
    const key = siteKey(run);
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    numbers.set(run.id, next);
  }
  return numbers;
}

/** The latest run of the same site uploaded before this one, or null. */
export function previousRun<T extends HistoryRun>(runs: readonly T[], id: string): T | null {
  const current = runs.find((run) => run.id === id);
  if (current === undefined) return null;
  const site = runsOfSite(runs, siteKey(current));
  const index = site.findIndex((run) => run.id === id);
  return index > 0 ? site[index - 1] : null;
}

/** current - previous, per band. Negative means fewer now. */
export function bandDelta(previous: BandCounts, current: BandCounts): BandCounts {
  const delta = emptyBandCounts();
  for (const band of BANDS) delta[band] = current[band] - previous[band];
  return delta;
}

export type Site<T extends HistoryRun> = {
  key: string;
  kind: RunKind;
  target_url: string;
  /** Oldest first. */
  runs: T[];
};

/** Every site with its runs; the site with the most recent upload comes first. */
export function groupSites<T extends HistoryRun>(runs: readonly T[]): Site<T>[] {
  const keys = [...new Set(runs.map(siteKey))];
  const sites = keys.map((key) => {
    const siteRuns = runsOfSite(runs, key);
    return { key, kind: siteRuns[0].kind, target_url: siteRuns[0].target_url, runs: siteRuns };
  });
  return sites.sort((a, b) => {
    const latestA = a.runs[a.runs.length - 1];
    const latestB = b.runs[b.runs.length - 1];
    return compareUploads(latestB, latestA) || a.key.localeCompare(b.key);
  });
}

export type RunChange = {
  previous_number: number;
  /** In this run, not in the previous one. */
  new: number;
  /** In the previous run, not in this one. */
  resolved: number;
  still_present: number;
  /** New findings that some run before the previous one had already reported. */
  regressions: number;
  /**
   * A rule version is inside every finding's identity, so when versions differ part of
   * "new" and "resolved" is the tool changing rather than the site.
   */
  rule_versions_changed: boolean;
};

export type TimelineEntry<T extends HistoryRun> = {
  run: T;
  number: number;
  change: RunChange | null;
};

function sameRuleVersions(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => a[key] === b[key]);
}

/**
 * One entry per run of a single site, oldest first, each compared with the run before it.
 *
 * Findings are matched by `finding_hash`, exactly as the compare screen does.
 */
export function siteTimeline<T extends HistoryRun>(
  siteRuns: readonly T[],
  findingsByRun: ReadonlyMap<string, readonly FindingIdentity[]>,
): TimelineEntry<T>[] {
  const ordered = [...siteRuns].sort(compareUploads);
  const seenBefore = new Set<string>();
  let previous: Set<string> | null = null;

  return ordered.map((run, index) => {
    const hashes = new Set((findingsByRun.get(run.id) ?? []).map((f) => f.finding_hash));
    let change: RunChange | null = null;

    if (previous !== null) {
      const prior = previous;
      const added = [...hashes].filter((hash) => !prior.has(hash));
      change = {
        previous_number: index,
        new: added.length,
        resolved: [...prior].filter((hash) => !hashes.has(hash)).length,
        still_present: [...hashes].filter((hash) => prior.has(hash)).length,
        regressions: added.filter((hash) => seenBefore.has(hash)).length,
        rule_versions_changed: !sameRuleVersions(
          ordered[index - 1].rule_versions,
          run.rule_versions,
        ),
      };
      for (const hash of prior) seenBefore.add(hash);
    }

    previous = hashes;
    return { run, number: index + 1, change };
  });
}
