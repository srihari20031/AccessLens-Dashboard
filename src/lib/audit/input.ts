/**
 * The Run audit form's input, validated.
 *
 * Pure: no Next.js, no Supabase. The same limits are enforced again by the `scan_jobs` table
 * (migration 0004), so this is for good error messages, not the security boundary.
 */
import { z } from 'zod';

export const MAX_URL_LENGTH = 2048;
export const MAX_CRAWL_PAGES = 20;

export type AuditKind = 'scan' | 'crawl';

export type AuditInput = {
  url: string;
  kind: AuditKind;
  maxPages: number;
  permissionConfirmed: boolean;
};

export type AuditField = 'url' | 'kind' | 'max_pages' | 'permission';

export type AuditFieldErrors = Partial<Record<AuditField, string>>;

export type RawAuditInput = Partial<Record<AuditField, unknown>>;

export type AuditInputResult =
  | { ok: true; value: AuditInput }
  | { ok: false; errors: AuditFieldErrors };

function isHttpUrl(value: string): boolean {
  // The database checks `url ~* '^https?://'`; `new URL` additionally rejects "https://".
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
  } catch {
    return false;
  }
}

const urlSchema = z
  .string({ error: 'Enter the address of the page to audit.' })
  .trim()
  .min(1, { error: 'Enter the address of the page to audit.' })
  .max(MAX_URL_LENGTH, { error: `That address is over ${MAX_URL_LENGTH} characters.` })
  .refine(isHttpUrl, {
    error: 'Enter a full web address starting with http:// or https://, such as https://example.com/.',
  });

const kindSchema = z.enum(['scan', 'crawl'], { error: 'Choose a scan or a crawl.' });

const maxPagesSchema = z.coerce
  .number({ error: `Enter a whole number of pages from 1 to ${MAX_CRAWL_PAGES}.` })
  .int({ error: `Enter a whole number of pages from 1 to ${MAX_CRAWL_PAGES}.` })
  .min(1, { error: `Enter a whole number of pages from 1 to ${MAX_CRAWL_PAGES}.` })
  .max(MAX_CRAWL_PAGES, { error: `A crawl covers at most ${MAX_CRAWL_PAGES} pages.` });

const PERMISSION_REQUIRED =
  'Tick the box to confirm you own this site or have permission to crawl it.';

/** Validate every field and report every problem at once, keyed by form field name. */
export function parseAuditInput(raw: RawAuditInput): AuditInputResult {
  const errors: AuditFieldErrors = {};

  const url = urlSchema.safeParse(raw.url ?? undefined);
  if (!url.success) errors.url = url.error.issues[0]?.message;

  const kind = kindSchema.safeParse(raw.kind ?? undefined);
  if (!kind.success) errors.kind = kind.error.issues[0]?.message;

  const isCrawl = kind.success && kind.data === 'crawl';
  let maxPages = 1;
  const permissionConfirmed = raw.permission === 'on' || raw.permission === true;

  if (isCrawl) {
    // An empty field would coerce to 0, which the minimum already rejects.
    const pages = maxPagesSchema.safeParse(
      typeof raw.max_pages === 'string' ? raw.max_pages.trim() : raw.max_pages,
    );
    if (pages.success) maxPages = pages.data;
    else errors.max_pages = pages.error.issues[0]?.message;
    if (!permissionConfirmed) errors.permission = PERMISSION_REQUIRED;
  }

  if (!url.success || !kind.success || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      url: url.data,
      kind: kind.data,
      maxPages,
      // A scan does not need the tick-box, so it is not recorded for one.
      permissionConfirmed: isCrawl && permissionConfirmed,
    },
  };
}

export const ONE_AT_A_TIME_MESSAGE = 'One audit at a time: wait for the current one to finish.';
export const DAILY_LIMIT_MESSAGE = 'Daily limit reached: 10 audits per 24 hours.';

/**
 * A database error from inserting a job, as something to show the user.
 *
 * The two quota messages come from the trigger in migration 0004 and are written for people,
 * so they pass through. Anything else is replaced by a fixed sentence: raw database text is
 * not an error message.
 */
export function friendlyInsertError(message: string): string {
  if (message.includes(ONE_AT_A_TIME_MESSAGE)) return ONE_AT_A_TIME_MESSAGE;
  if (message.includes(DAILY_LIMIT_MESSAGE)) return DAILY_LIMIT_MESSAGE;
  if (/scan_jobs/.test(message) && /(does not exist|could not find|schema cache)/i.test(message)) {
    return (
      'Audits are not set up in this database yet: run supabase/migrations/0004_scan_jobs.sql ' +
      'in the Supabase SQL editor.'
    );
  }
  return 'The audit could not be started. Try again in a moment.';
}
