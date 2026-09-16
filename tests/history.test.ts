import { describe, expect, it } from 'vitest';

import { emptyBandCounts, type BandCounts } from '@/lib/report/bands';
import {
  bandDelta,
  groupSites,
  numberRuns,
  previousRun,
  siteKey,
  siteTimeline,
  type HistoryRun,
} from '@/lib/report/history';

function bands(partial: Partial<BandCounts>): BandCounts {
  return { ...emptyBandCounts(), ...partial };
}

function run(
  id: string,
  created_at: string,
  overrides: Partial<HistoryRun> = {},
): HistoryRun {
  return {
    id,
    kind: 'crawl',
    target_url: 'https://college.example/',
    created_at,
    site_bands: emptyBandCounts(),
    rule_versions: { 'non-text-content': '1.2.0' },
    ...overrides,
  };
}

describe('siteKey', () => {
  it('separates a scan and a crawl of the same URL', () => {
    const url = 'https://college.example/';
    expect(siteKey({ kind: 'scan', target_url: url })).not.toBe(
      siteKey({ kind: 'crawl', target_url: url }),
    );
  });
});

describe('numberRuns', () => {
  it('numbers runs of one site from 1 in upload order, whatever order they arrive in', () => {
    const runs = [
      run('c', '2026-09-18T10:00:00Z'),
      run('a', '2026-09-01T10:00:00Z'),
      run('b', '2026-09-09T10:00:00Z'),
    ];
    const numbers = numberRuns(runs);
    expect([numbers.get('a'), numbers.get('b'), numbers.get('c')]).toEqual([1, 2, 3]);
  });

  it('keeps a separate count for each site', () => {
    const runs = [
      run('a1', '2026-09-01T10:00:00Z'),
      run('b1', '2026-09-02T10:00:00Z', { target_url: 'https://other.example/' }),
      run('a2', '2026-09-03T10:00:00Z'),
    ];
    const numbers = numberRuns(runs);
    expect(numbers.get('a2')).toBe(2);
    expect(numbers.get('b1')).toBe(1);
  });

  it('breaks a timestamp tie by id, so the numbering never depends on query order', () => {
    const same = '2026-09-01T10:00:00Z';
    expect(numberRuns([run('y', same), run('x', same)]).get('x')).toBe(1);
    expect(numberRuns([run('x', same), run('y', same)]).get('x')).toBe(1);
  });
});

describe('previousRun', () => {
  const runs = [
    run('a', '2026-09-01T10:00:00Z'),
    run('other', '2026-09-05T10:00:00Z', { kind: 'scan' }),
    run('b', '2026-09-09T10:00:00Z'),
  ];

  it('is the latest earlier run of the same site, skipping other sites', () => {
    expect(previousRun(runs, 'b')?.id).toBe('a');
  });

  it('is null for the first run of a site and for an unknown id', () => {
    expect(previousRun(runs, 'a')).toBeNull();
    expect(previousRun(runs, 'missing')).toBeNull();
  });
});

describe('bandDelta', () => {
  it('is current minus previous, per band', () => {
    expect(
      bandDelta(bands({ critical: 9, serious: 4 }), bands({ serious: 6, moderate: 3 })),
    ).toEqual(bands({ critical: -9, serious: 2, moderate: 3 }));
  });
});

describe('groupSites', () => {
  it('lists each site once with its runs oldest first, most recently active site first', () => {
    const runs = [
      run('a1', '2026-09-01T10:00:00Z'),
      run('b1', '2026-09-02T10:00:00Z', { target_url: 'https://other.example/' }),
      run('a2', '2026-09-03T10:00:00Z'),
    ];
    const sites = groupSites(runs);
    expect(sites.map((site) => site.target_url)).toEqual([
      'https://college.example/',
      'https://other.example/',
    ]);
    expect(sites[0].runs.map((r) => r.id)).toEqual(['a1', 'a2']);
  });
});

describe('siteTimeline', () => {
  const f = (hash: string) => ({ finding_hash: hash, band: 'serious' as const });

  it('counts new, resolved and still-present findings against the previous run', () => {
    const runs = [run('r1', '2026-09-01T10:00:00Z'), run('r2', '2026-09-02T10:00:00Z')];
    const findings = new Map([
      ['r1', [f('a'), f('b'), f('c')]],
      ['r2', [f('b'), f('c'), f('d')]],
    ]);
    const [first, second] = siteTimeline(runs, findings);

    expect(first.number).toBe(1);
    expect(first.change).toBeNull();
    expect(second.change).toEqual({
      previous_number: 1,
      new: 1,
      resolved: 1,
      still_present: 2,
      regressions: 0,
      rule_versions_changed: false,
    });
  });

  it('calls a finding a regression when it was resolved earlier and has come back', () => {
    const runs = [
      run('r1', '2026-09-01T10:00:00Z'),
      run('r2', '2026-09-02T10:00:00Z'),
      run('r3', '2026-09-03T10:00:00Z'),
    ];
    const findings = new Map([
      ['r1', [f('a'), f('b')]],
      ['r2', [f('b')]],
      ['r3', [f('a'), f('b'), f('z')]],
    ]);
    const third = siteTimeline(runs, findings)[2];
    expect(third.change?.new).toBe(2);
    expect(third.change?.regressions).toBe(1);
  });

  it('flags a change of rule versions, because that changes finding identities', () => {
    const runs = [
      run('r1', '2026-09-01T10:00:00Z'),
      run('r2', '2026-09-02T10:00:00Z', { rule_versions: { 'non-text-content': '1.3.0' } }),
    ];
    const second = siteTimeline(runs, new Map())[1];
    expect(second.change?.rule_versions_changed).toBe(true);
  });
});
