import { describe, expect, it } from 'vitest';

import { MIN_TOKEN_LIFETIME_S, tokenForWorker } from '@/lib/audit/session';

const NOW = 1_800_000_000;

describe('the access token sent to the worker', () => {
  it('is the session token when it has enough life left for the whole job', () => {
    const session = { access_token: 'fresh', expires_at: NOW + 3600 };
    expect(tokenForWorker(session, NOW)).toBe('fresh');
  });

  it('is refused when it would expire before a job could finish', () => {
    const session = { access_token: 'old', expires_at: NOW + MIN_TOKEN_LIFETIME_S - 1 };
    expect(tokenForWorker(session, NOW)).toBeNull();
  });

  it('is accepted exactly at the minimum', () => {
    const session = { access_token: 'edge', expires_at: NOW + MIN_TOKEN_LIFETIME_S };
    expect(tokenForWorker(session, NOW)).toBe('edge');
  });

  it('is refused with no session, no token or no expiry', () => {
    expect(tokenForWorker(null, NOW)).toBeNull();
    expect(tokenForWorker({ access_token: '', expires_at: NOW + 3600 }, NOW)).toBeNull();
    expect(tokenForWorker({ access_token: 't' }, NOW)).toBeNull();
  });

  it('asks for the worker\'s own minimum: the default 15 minute job timeout plus 30 minutes', () => {
    expect(MIN_TOKEN_LIFETIME_S).toBe(900 + 1800);
  });
});
