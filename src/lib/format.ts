/** Presentation helpers. Nothing here decides anything; it only shapes text for display. */

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Rendered on the server only, so the server's timezone is the one shown, consistently. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE_FORMAT.format(date);
}

export function formatDate(iso: string): string {
  return formatDateTime(iso).split(',')[0] ?? iso;
}

/** A URL shortened for a narrow column, without ever hiding the host. */
export function shortenUrl(url: string, max = 60): string {
  if (url.length <= max) return url;
  try {
    const parsed = new URL(url);
    const tail = `${parsed.pathname}${parsed.search}`;
    const room = max - parsed.host.length - 3;
    if (room > 4) return `${parsed.host}…${tail.slice(tail.length - room)}`;
    return `${url.slice(0, max - 1)}…`;
  } catch {
    return `${url.slice(0, max - 1)}…`;
  }
}

export function pluralise(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * An evidence value as text.
 *
 * Evidence is rule-specific and arbitrary. Everything here ends up in a text node, never in
 * markup, and `null` is written out as the word so that "no alt attribute" is not confused
 * with an empty one — a distinction rule 1.1.1 turns on.
 */
export function formatEvidenceValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '—';
  if (typeof value === 'string') return value === '' ? '"" (present but empty)' : value;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

/** `alt_text` and `is_sole_link_content` read better as words in a definition list. */
export function formatEvidenceKey(key: string): string {
  const spaced = key.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function formatPageStatus(status: string): string {
  const words: Record<string, string> = {
    evaluated: 'Evaluated',
    'load-error': 'Load error',
    'http-error': 'HTTP error',
    'redirected-off-host': 'Redirected off host',
    'redirected-disallowed': 'Redirected to a disallowed path',
  };
  return words[status] ?? status;
}

export function formatSkipReason(reason: string): string {
  const words: Record<string, string> = {
    'robots-disallowed': 'Disallowed by robots.txt',
    'non-html': 'Not an HTML page',
  };
  return words[reason] ?? reason;
}
