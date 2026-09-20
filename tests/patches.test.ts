import { describe, expect, it } from 'vitest';

import {
  MAX_DESCRIPTION_CHARS,
  MAX_PATCHES,
  MAX_PATCH_TEXT_CHARS,
  MAX_QUESTION_CHARS,
  parsePatches,
  parsePatchesText,
  PATCH_SOURCE_LABELS,
  PATCH_SOURCES,
  PATCH_STATUS_LABELS,
  PATCH_STATUS_NOTES,
  PATCH_STATUSES,
  patchesForRun,
  type PatchEntry,
} from '@/lib/review/patches';

import { loadFixture } from './helpers';

/*
 * The patch file is written by `accesslens fix`, which this repository does not hold a sample
 * of — the CLI lives in the AccessLens repository and no committed fixture here was produced
 * by it. So these tests build files by hand, and the hashes they use are read out of the
 * committed scan report, which is real CLI output: `patchesForRun` is therefore tested against
 * hashes a scanner actually produced, not against invented ones.
 */

function hashesOfScanIndex(): string[] {
  const parsed = loadFixture('scanIndex');
  if (parsed.kind !== 'scan') throw new Error('expected a scan report');
  return parsed.report.findings
    .filter((finding) => finding.outcome !== 'pass')
    .map((finding) => finding.finding_hash);
}

const READY = {
  criterion: '3.1.1',
  description: 'add lang="en" to <html>',
  finding_hash: 'a1b2c3d4e5f6',
  new_text: '<html lang="en">',
  old_text: '<html>',
  path: 'examples/demo-site/index.html',
  question: null,
  rule_id: 'language-of-page',
  source: 'rule',
  start_column: 1,
  start_line: 2,
  status: 'ready',
};

const QUESTION = {
  ...READY,
  criterion: '1.1.1',
  description: 'the image needs a text alternative',
  finding_hash: 'bbbb1111',
  new_text: '',
  old_text: '',
  question: 'What does this image convey to someone who cannot see it?',
  rule_id: 'non-text-content',
  start_line: 9,
  status: 'needs-input',
};

function file(patches: unknown[], extra: Record<string, unknown> = {}) {
  return {
    patch_schema_version: 1,
    counts: { ready: 1, 'needs-input': 1 },
    report: { kind: 'scan', target_url: 'file:///c:/site/index.html' },
    patches,
    ...extra,
  };
}

function parsed(input: unknown) {
  const result = parsePatches(input);
  if (!result.ok) throw new Error(`expected success: ${result.message}`);
  return result.value;
}

function rejected(input: unknown) {
  const result = parsePatches(input);
  if (result.ok) throw new Error('expected the file to be rejected');
  return result;
}

describe('the vocabulary a patch is described in', () => {
  it('writes every status and every source out in words', () => {
    for (const status of PATCH_STATUSES) {
      expect(PATCH_STATUS_LABELS[status]).toBeTruthy();
      expect(PATCH_STATUS_NOTES[status]).toBeTruthy();
    }
    for (const source of PATCH_SOURCES) expect(PATCH_SOURCE_LABELS[source]).toBeTruthy();
  });

  it('shows the edits first and the questions next', () => {
    expect(PATCH_STATUSES[0]).toBe('ready');
    expect(PATCH_STATUSES[1]).toBe('needs-input');
  });

  it('labels an AI-drafted patch as one to review before use', () => {
    expect(PATCH_SOURCE_LABELS.ai).toMatch(/review before use/i);
  });
});

describe('the shape of a patch file', () => {
  it('reads the format the CLI writes', () => {
    const value = parsed(file([READY, QUESTION]));
    expect(value.entries).toHaveLength(2);
    expect(value.skipped).toBe(0);
    expect(value.target_url).toBe('file:///c:/site/index.html');
    expect(value.report_kind).toBe('scan');
  });

  it.each([null, 42, 'a string', [READY], { patches: [READY] }])(
    'refuses %s as a patch file',
    (input) => {
      expect(rejected(input).message).toMatch(/not an AccessLens patch file/i);
    },
  );

  it('refuses a schema version it does not read, and says which it does', () => {
    const message = rejected(file([READY], { patch_schema_version: 2 })).message;
    expect(message).toMatch(/version 2/);
    expect(message).toMatch(/version 1/);
  });

  it('refuses a file with no patches at all', () => {
    expect(rejected(file([])).message).toMatch(/empty/i);
  });

  it('refuses a file over the entry cap', () => {
    const many = Array.from({ length: MAX_PATCHES + 1 }, (_, index) => ({
      ...READY,
      finding_hash: `abc${index.toString(16)}`,
    }));
    expect(rejected(file(many)).message).toMatch(new RegExp(String(MAX_PATCHES)));
  });

  it('survives a file that is not JSON at all', () => {
    const result = parsePatchesText('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/not valid JSON/i);
  });

  it('reads the same file from text', () => {
    const result = parsePatchesText(JSON.stringify(file([READY])));
    expect(result.ok).toBe(true);
  });

  it('says nothing about a report block it cannot read', () => {
    const value = parsed(file([READY], { report: { kind: 7, target_url: null } }));
    expect(value.target_url).toBeNull();
    expect(value.report_kind).toBeNull();
  });
});

describe('every value of a patch is checked', () => {
  it.each([
    ['a hash that is not lowercase hex', { finding_hash: 'NOTHEX' }],
    ['no hash at all', { finding_hash: undefined }],
    ['a status outside the five', { status: 'maybe' }],
    ['a source outside the two', { source: 'guesswork' }],
    ['a line of zero', { start_line: 0 }],
    ['a fractional column', { start_column: 2.5 }],
    ['a line that is a string', { start_line: '2' }],
    ['a criterion that is not a criterion', { criterion: 'lang' }],
    ['old text that is not text', { old_text: 12 }],
    ['new text that is not text', { new_text: null }],
  ])('drops a patch with %s', (_name, override) => {
    const value = parsed(file([READY, { ...QUESTION, ...override }]));
    expect(value.entries).toHaveLength(1);
    expect(value.skipped).toBe(1);
  });

  it('drops a second patch for the same finding rather than letting it overwrite the first', () => {
    const value = parsed(file([READY, { ...READY, description: 'a different edit' }]));
    expect(value.entries).toHaveLength(1);
    expect(value.entries[0]?.description).toBe(READY.description);
    expect(value.skipped).toBe(1);
  });

  it('reports a file whose patches are all unusable rather than storing none silently', () => {
    const result = rejected(file([{ ...READY, status: 'maybe' }]));
    expect(result.message).toMatch(/No usable patch/i);
    expect(result.issues[0]).toMatch(/1 patch was unusable/);
  });
});

describe('the edit texts are kept exactly as they came', () => {
  it('does not trim the whitespace of an edit', () => {
    const value = parsed(
      file([{ ...READY, old_text: '  <html>\n', new_text: '  <html lang="en">\n' }]),
    );
    expect(value.entries[0]?.old_text).toBe('  <html>\n');
    expect(value.entries[0]?.new_text).toBe('  <html lang="en">\n');
  });

  it('keeps an empty old text, which is what an insertion is', () => {
    const value = parsed(file([{ ...READY, old_text: '', new_text: '<a href="#main">Skip</a>' }]));
    expect(value.entries[0]?.old_text).toBe('');
  });

  it('drops a patch whose edit is over the cap rather than storing half of it', () => {
    const value = parsed(
      file([READY, { ...QUESTION, new_text: 'x'.repeat(MAX_PATCH_TEXT_CHARS + 1) }]),
    );
    expect(value.entries).toHaveLength(1);
    expect(value.skipped).toBe(1);
  });

  it('keeps an edit exactly at the cap', () => {
    const value = parsed(file([{ ...READY, new_text: 'x'.repeat(MAX_PATCH_TEXT_CHARS) }]));
    expect(value.entries[0]?.new_text).toHaveLength(MAX_PATCH_TEXT_CHARS);
  });

  it('never returns markup that has been unescaped or altered', () => {
    const hostile = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    const value = parsed(file([{ ...READY, new_text: hostile }]));
    expect(value.entries[0]?.new_text).toBe(hostile);
  });
});

describe('prose fields are truncated, not dropped', () => {
  it('cuts a description at the cap', () => {
    const value = parsed(file([{ ...READY, description: 'd'.repeat(MAX_DESCRIPTION_CHARS + 50) }]));
    expect(value.entries[0]?.description).toHaveLength(MAX_DESCRIPTION_CHARS);
  });

  it('cuts a question at the cap', () => {
    const value = parsed(file([{ ...QUESTION, question: 'q'.repeat(MAX_QUESTION_CHARS + 50) }]));
    expect(value.entries[0]?.question).toHaveLength(MAX_QUESTION_CHARS);
  });

  it('reads a blank question as none rather than as an empty one', () => {
    const value = parsed(file([{ ...QUESTION, question: '   ' }]));
    expect(value.entries[0]?.question).toBeNull();
  });

  it('keeps a needs-input patch that carries no question, because it is still a work item', () => {
    const value = parsed(file([{ ...QUESTION, question: undefined }]));
    expect(value.entries).toHaveLength(1);
    expect(value.entries[0]?.status).toBe('needs-input');
  });
});

describe('a patch file belongs to the run it was made from', () => {
  it('keeps only the patches whose finding is in this run', () => {
    const hashes = hashesOfScanIndex();
    expect(hashes.length).toBeGreaterThan(0);
    const entries: PatchEntry[] = [
      { ...(READY as PatchEntry), finding_hash: hashes[0]! },
      { ...(READY as PatchEntry), finding_hash: 'deadbeef' },
    ];
    const { kept, unknown } = patchesForRun(entries, hashes);
    expect(kept.map((entry) => entry.finding_hash)).toEqual([hashes[0]]);
    expect(unknown).toBe(1);
  });

  it('keeps nothing from a file made for another report', () => {
    const { kept, unknown } = patchesForRun([READY as PatchEntry], hashesOfScanIndex());
    expect(kept).toEqual([]);
    expect(unknown).toBe(1);
  });
});
