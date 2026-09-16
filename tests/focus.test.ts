import { describe, expect, it } from 'vitest';

import { toImportPayload } from '@/lib/report/map';
import { describeTarget, loopStartIndex, readFocusReplay } from '@/lib/report/focus';

import { loadFixture } from './helpers';

const stop = (selector: string, tag = 'button', snippet = `<${tag}>${selector}</${tag}>`) => ({
  selector,
  tag,
  snippet,
});

describe('readFocusReplay', () => {
  it('reads the stops, loop and unreached elements of a trapped walk', () => {
    const data = readFocusReplay({
      rule_id: 'no-keyboard-trap',
      evidence: {
        reason: 'keyboard-trap',
        stop_count: 3,
        cycle: ['a', 'b'],
        stops: [stop('before'), stop('a'), stop('b')],
        unreached: [stop('after')],
        unreached_truncated: false,
      },
    });
    expect(data).toEqual({
      reason: 'keyboard-trap',
      stops: [stop('before'), stop('a'), stop('b')],
      cycle: ['a', 'b'],
      unreached: [stop('after')],
      unreachedTruncated: false,
    });
    expect(loopStartIndex(data!)).toBe(1);
  });

  it('is null for another rule, and for a 1.0.0 report that has no stops', () => {
    const evidence = { reason: 'keyboard-trap', stops: [stop('a')], cycle: [] };
    expect(readFocusReplay({ rule_id: 'focus-visible', evidence })).toBeNull();
    expect(
      readFocusReplay({ rule_id: 'no-keyboard-trap', evidence: { reason: 'keyboard-trap', cycle: ['a'] } }),
    ).toBeNull();
  });

  it('drops malformed entries rather than trusting a hand-edited file', () => {
    const data = readFocusReplay({
      rule_id: 'no-keyboard-trap',
      evidence: {
        reason: 42,
        stops: [stop('a'), { selector: 1 }, 'nonsense', null],
        cycle: ['a', 7],
        unreached: 'not a list',
        unreached_truncated: 'yes',
      },
    });
    expect(data).toEqual({
      reason: '',
      stops: [stop('a')],
      cycle: ['a'],
      unreached: [],
      unreachedTruncated: false,
    });
    expect(loopStartIndex(data!)).toBe(0);
  });

  it('has no loop when the cycle is empty', () => {
    const data = readFocusReplay({
      rule_id: 'no-keyboard-trap',
      evidence: { reason: 'walk-incomplete', stops: [stop('a')], cycle: [] },
    });
    expect(loopStartIndex(data!)).toBe(-1);
  });

  it('reads the real 2.1.2 finding produced by the CLI', () => {
    const payload = toImportPayload(loadFixture('scanKeyboardTrap'), null);
    const finding = payload.findings.find((f) => f.rule_id === 'no-keyboard-trap');
    expect(finding?.outcome).toBe('fail');
    const data = readFocusReplay(finding!);
    expect(data?.stops).toHaveLength(3);
    expect(data?.cycle).toHaveLength(2);
    expect(loopStartIndex(data!)).toBe(1);
    expect(data?.unreached).toHaveLength(1);
    expect(data?.unreached[0].snippet).toContain('id="after"');
  });
});

describe('describeTarget', () => {
  it('names an element by its tag and visible text', () => {
    expect(describeTarget(stop('x', 'button', '<button id="login" type="button">Log in</button>'))).toBe(
      'button “Log in”',
    );
  });

  it('copes with a snippet cut off mid-tag, and with no text at all', () => {
    expect(describeTarget(stop('x', 'a', '<a href="/fees">Fee structure 2026 <span class="ic'))).toBe(
      'a “Fee structure 2026”',
    );
    expect(describeTarget(stop('x', 'input', '<input id="q" name="q">'))).toBe('input');
  });

  it('shortens long text', () => {
    const label = 'word '.repeat(30).trim();
    const name = describeTarget(stop('x', 'a', `<a href="/">${label}</a>`));
    expect(name.length).toBeLessThanOrEqual(2 + 1 + 60 + 2);
    expect(name.endsWith('…”')).toBe(true);
  });
});
