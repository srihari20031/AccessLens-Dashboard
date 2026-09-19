import { describe, expect, it } from 'vitest';

import { reportByteLength, STORE_FAILED_MESSAGE } from '@/lib/audit/results';

describe('the size of a stored report', () => {
  it('is its JSON text in UTF-8 bytes, as an uploaded file would be measured', () => {
    expect(reportByteLength({ a: 1 })).toBe('{"a":1}'.length);
    // "é" is two bytes in UTF-8, one UTF-16 code unit.
    expect(reportByteLength({ t: 'é' })).toBe('{"t":"é"}'.length + 1);
  });

  it('is zero for no report', () => {
    expect(reportByteLength(null)).toBe(0);
    expect(reportByteLength(undefined)).toBe(0);
  });

  it('can tell a report just over five megabytes', () => {
    const limit = 5 * 1024 * 1024;
    const big = { text: 'x'.repeat(limit) };
    expect(reportByteLength(big)).toBeGreaterThan(limit);
  });
});

describe('a failed store', () => {
  it('is one fixed sentence, never the database error', () => {
    expect(STORE_FAILED_MESSAGE).toBe('The report validated, but storing it failed. Try again later.');
  });
});
