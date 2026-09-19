import { describe, expect, it } from 'vitest';

import { friendlyInsertError, parseAuditInput } from '@/lib/audit/input';

function raw(overrides: Partial<Record<'url' | 'kind' | 'max_pages' | 'permission', unknown>> = {}) {
  return { url: 'https://example.com/', kind: 'scan', max_pages: '5', permission: null, ...overrides };
}

function errorsOf(input: ReturnType<typeof raw>) {
  const result = parseAuditInput(input);
  if (result.ok) throw new Error('expected the input to be rejected');
  return result.errors;
}

describe('the audit URL', () => {
  it.each(['https://example.com/', 'http://example.com/a?b=c', 'HTTPS://EXAMPLE.COM'])(
    'accepts %s',
    (url) => {
      const result = parseAuditInput(raw({ url }));
      expect(result.ok).toBe(true);
    },
  );

  it('trims surrounding whitespace', () => {
    const result = parseAuditInput(raw({ url: '  https://example.com/  ' }));
    if (!result.ok) throw new Error('expected success');
    expect(result.value.url).toBe('https://example.com/');
  });

  it.each([
    ['ftp', 'ftp://example.com/'],
    ['javascript', 'javascript:alert(1)'],
    ['relative', '/about'],
    ['host only', 'example.com'],
    ['empty', ''],
    ['scheme with no host', 'https://'],
    ['data', 'data:text/html,hi'],
  ])('rejects a %s URL', (_name, url) => {
    expect(errorsOf(raw({ url })).url).toBeTruthy();
  });

  it('rejects a missing URL', () => {
    expect(errorsOf(raw({ url: null })).url).toBeTruthy();
  });

  it('accepts exactly 2048 characters and rejects 2049', () => {
    const base = 'https://example.com/';
    const at = base + 'a'.repeat(2048 - base.length);
    expect(at.length).toBe(2048);
    expect(parseAuditInput(raw({ url: at })).ok).toBe(true);
    expect(errorsOf(raw({ url: `${at}a` })).url).toMatch(/2048/);
  });
});

describe('the kind of audit', () => {
  it('rejects anything but scan or crawl', () => {
    expect(errorsOf(raw({ kind: 'spider' })).kind).toBeTruthy();
    expect(errorsOf(raw({ kind: null })).kind).toBeTruthy();
  });
});

describe('a scan', () => {
  it('is always one page, whatever the max pages field says', () => {
    const result = parseAuditInput(raw({ kind: 'scan', max_pages: '17' }));
    if (!result.ok) throw new Error('expected success');
    expect(result.value).toEqual({
      url: 'https://example.com/',
      kind: 'scan',
      maxPages: 1,
      permissionConfirmed: false,
    });
  });

  it('ignores a nonsense max pages value', () => {
    expect(parseAuditInput(raw({ kind: 'scan', max_pages: 'lots' })).ok).toBe(true);
  });

  it('does not need the permission tick-box', () => {
    expect(parseAuditInput(raw({ kind: 'scan', permission: null })).ok).toBe(true);
  });
});

describe('a crawl', () => {
  it('requires the permission tick-box', () => {
    expect(errorsOf(raw({ kind: 'crawl', permission: null })).permission).toBeTruthy();
  });

  it('is accepted with the tick-box and a page limit', () => {
    const result = parseAuditInput(raw({ kind: 'crawl', max_pages: '20', permission: 'on' }));
    if (!result.ok) throw new Error('expected success');
    expect(result.value).toEqual({
      url: 'https://example.com/',
      kind: 'crawl',
      maxPages: 20,
      permissionConfirmed: true,
    });
  });

  it.each(['0', '21', '2.5', 'ten', '', '-1'])('rejects %j as a page limit', (max_pages) => {
    expect(errorsOf(raw({ kind: 'crawl', max_pages, permission: 'on' })).max_pages).toBeTruthy();
  });

  it('reports every problem at once', () => {
    const errors = errorsOf(raw({ url: 'ftp://x', kind: 'crawl', max_pages: '99' }));
    expect(Object.keys(errors).sort()).toEqual(['max_pages', 'permission', 'url']);
  });
});

describe('errors raised by the database when a job is inserted', () => {
  it('passes the one-at-a-time message through', () => {
    expect(
      friendlyInsertError('One audit at a time: wait for the current one to finish.'),
    ).toBe('One audit at a time: wait for the current one to finish.');
  });

  it('passes the daily limit message through', () => {
    expect(friendlyInsertError('Daily limit reached: 10 audits per 24 hours.')).toBe(
      'Daily limit reached: 10 audits per 24 hours.',
    );
  });

  it('explains a missing table as a missing migration', () => {
    expect(
      friendlyInsertError('Could not find the table \'public.scan_jobs\' in the schema cache'),
    ).toMatch(/0004_scan_jobs\.sql/);
    expect(friendlyInsertError('relation "public.scan_jobs" does not exist')).toMatch(/0004/);
  });

  it('never shows any other database text', () => {
    const message = friendlyInsertError('new row violates check constraint "secret_detail"');
    expect(message).not.toMatch(/secret_detail/);
    expect(message).toMatch(/could not be started/);
  });
});
