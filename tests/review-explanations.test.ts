import { describe, expect, it } from 'vitest';

import {
  entriesForRun,
  MAX_ENTRIES,
  MAX_EXPLANATION_CHARS,
  MAX_FIX_CHARS,
  parseExplanations,
  parseExplanationsText,
  type SuggestionEntry,
} from '@/lib/review/explanations';

import { loadFixture } from './helpers';

/*
 * The explanations file is written by `accesslens explain`, which this repository does not
 * hold a sample of — the CLI lives in the AccessLens repository and no committed fixture here
 * was produced by it. So these tests build files by hand, and the hashes they use are read
 * out of the committed scan report, which is real CLI output: `entriesForRun` is therefore
 * tested against hashes a scanner actually produced, not against invented ones.
 */

function hashesOfScanContrast(): string[] {
  const parsed = loadFixture('scanContrast');
  if (parsed.kind !== 'scan') throw new Error('expected a scan report');
  return parsed.report.findings
    .filter((finding) => finding.outcome !== 'pass')
    .map((finding) => finding.finding_hash);
}

const ONE: SuggestionEntry = {
  finding_hash: 'a1b2c3d4e5f6',
  explanation: 'The image has no text alternative, so a screen reader announces nothing.',
  fix: '<img src="logo.png" alt="Draft: the company name">',
  confidence: 'medium',
  model: 'claude-sonnet-4-5',
  prompt_version: '3',
  rule_version: '1.3.0',
};

function parsed(input: unknown) {
  const result = parseExplanations(input);
  if (!result.ok) throw new Error(`expected success: ${result.message}`);
  return result.value;
}

function rejected(input: unknown) {
  const result = parseExplanations(input);
  if (result.ok) throw new Error('expected the file to be rejected');
  return result;
}

describe('the shape of an explanations file', () => {
  it('reads a bare array of entries', () => {
    expect(parsed([ONE]).entries).toHaveLength(1);
  });

  it.each(['suggestions', 'explanations', 'entries'])('reads a %s array', (key) => {
    expect(parsed({ [key]: [ONE] }).entries[0]?.finding_hash).toBe(ONE.finding_hash);
  });

  it.each(['suggestions', 'explanations'])('reads a %s object keyed by hash', (key) => {
    const { finding_hash: hash, ...rest } = ONE;
    expect(parsed({ [key]: { [hash]: rest } }).entries[0]?.finding_hash).toBe(hash);
  });

  it('reads a bare object keyed by hash', () => {
    const { finding_hash: hash, ...rest } = ONE;
    expect(parsed({ [hash]: rest }).entries[0]?.explanation).toBe(ONE.explanation);
  });

  it('does not mistake a report for an explanations file', () => {
    const result = rejected({ schema_version: 1, run: {}, findings: [] });
    expect(result.message).toMatch(/not an AccessLens explanations file/);
  });

  it.each([null, 42, 'text', true])('rejects %s at the top level', (input) => {
    expect(rejected(input).message).toMatch(/not an AccessLens explanations file/);
  });

  it('rejects a file with no entries', () => {
    expect(rejected([]).message).toMatch(/empty/);
    expect(rejected({ suggestions: [] }).message).toMatch(/empty/);
  });

  it('rejects a file with more entries than it will read', () => {
    const many = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => ({
      ...ONE,
      finding_hash: i.toString(16).padStart(12, '0'),
    }));
    expect(rejected(many).message).toMatch(new RegExp(String(MAX_ENTRIES)));
  });
});

describe('one entry', () => {
  it('keeps the fields the CLI writes', () => {
    expect(parsed([ONE]).entries[0]).toEqual({
      finding_hash: ONE.finding_hash,
      explanation: ONE.explanation,
      fix: ONE.fix,
      confidence: 'medium',
      model: 'claude-sonnet-4-5',
      prompt_version: '3',
      rule_version: '1.3.0',
    });
  });

  it('accepts "suggested_fix" as the other spelling of "fix"', () => {
    const { fix, ...rest } = ONE;
    expect(parsed([{ ...rest, suggested_fix: fix }]).entries[0]?.fix).toBe(fix);
  });

  it.each([
    ['uppercase hex', 'A1B2C3'],
    ['not hex', 'zzzz'],
    ['empty', ''],
    ['missing', undefined],
  ])('drops an entry whose hash is %s', (_name, finding_hash) => {
    const result = parseExplanations([{ ...ONE, finding_hash }]);
    expect(result.ok).toBe(false);
  });

  it('drops an entry with neither an explanation nor a fix', () => {
    const result = parseExplanations([
      ONE,
      { finding_hash: 'bbbb', explanation: '   ', fix: null },
    ]);
    if (!result.ok) throw new Error('expected success');
    expect(result.value.entries).toHaveLength(1);
    expect(result.value.skipped).toBe(1);
  });

  it('keeps the first of two entries with the same hash', () => {
    const value = parsed([ONE, { ...ONE, explanation: 'second' }]);
    expect(value.entries).toHaveLength(1);
    expect(value.entries[0]?.explanation).toBe(ONE.explanation);
    expect(value.skipped).toBe(1);
  });

  it.each([
    ['LOW', 'low'],
    [' High ', 'high'],
    ['medium', 'medium'],
  ])('reads a confidence of %s as %s', (given, expected) => {
    expect(parsed([{ ...ONE, confidence: given }]).entries[0]?.confidence).toBe(expected);
  });

  it.each([['certain'], [''], [1], [null], [{}]])(
    'reads a confidence of %s as none rather than guessing',
    (given) => {
      expect(parsed([{ ...ONE, confidence: given }]).entries[0]?.confidence).toBeNull();
    },
  );

  it('reads a numeric prompt version as its decimal form', () => {
    expect(parsed([{ ...ONE, prompt_version: 4 }]).entries[0]?.prompt_version).toBe('4');
  });

  it.each([
    ['an object', { a: 1 }],
    ['a number', 12],
    ['null', null],
  ])('treats %s where text belongs as no text', (_name, given) => {
    const value = parsed([{ ...ONE, explanation: given }]);
    expect(value.entries[0]?.explanation).toBe('');
    expect(value.entries[0]?.fix).toBe(ONE.fix);
  });

  it('caps text at what the database will store', () => {
    const value = parsed([
      { ...ONE, explanation: 'e'.repeat(MAX_EXPLANATION_CHARS + 50), fix: 'f'.repeat(MAX_FIX_CHARS + 50) },
    ]);
    expect(value.entries[0]?.explanation).toHaveLength(MAX_EXPLANATION_CHARS);
    expect(value.entries[0]?.fix).toHaveLength(MAX_FIX_CHARS);
  });

  it('falls back to the file-level model and prompt version', () => {
    const bare = { finding_hash: ONE.finding_hash, explanation: ONE.explanation, fix: ONE.fix };
    const value = parsed({
      model: 'claude-opus-4-1',
      prompt_version: 9,
      suggestions: [bare],
    });
    expect(value.entries[0]?.model).toBe('claude-opus-4-1');
    expect(value.entries[0]?.prompt_version).toBe('9');
  });

  it('prefers an entry’s own model over the file’s', () => {
    const value = parsed({ model: 'claude-opus-4-1', suggestions: [ONE] });
    expect(value.entries[0]?.model).toBe(ONE.model);
  });

  it('rejects a file whose every entry is unusable', () => {
    expect(rejected([{ finding_hash: 'nothex', fix: 'x' }]).message).toMatch(/No usable suggestion/);
  });
});

describe('parsing the uploaded text', () => {
  it('reports a JSON error as such', () => {
    const result = parseExplanationsText('{ not json');
    if (result.ok) throw new Error('expected failure');
    expect(result.message).toMatch(/not valid JSON/);
    expect(result.issues).toHaveLength(1);
  });

  it('parses a file the CLI could have written', () => {
    const result = parseExplanationsText(JSON.stringify({ suggestions: [ONE] }));
    if (!result.ok) throw new Error('expected success');
    expect(result.value.entries).toHaveLength(1);
  });
});

describe('matching entries to a run', () => {
  it('keeps only the findings that are in the run', () => {
    const hashes = hashesOfScanContrast();
    expect(hashes.length).toBeGreaterThan(0);
    const entries = [
      { ...ONE, finding_hash: hashes[0]! },
      { ...ONE, finding_hash: 'deadbeef' },
    ];
    const { kept, unknown } = entriesForRun(entries, hashes);
    expect(kept.map((entry) => entry.finding_hash)).toEqual([hashes[0]]);
    expect(unknown).toBe(1);
  });

  it('keeps nothing when the file belongs to another run', () => {
    const { kept, unknown } = entriesForRun([ONE], hashesOfScanContrast());
    expect(kept).toHaveLength(0);
    expect(unknown).toBe(1);
  });
});
