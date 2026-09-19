/**
 * Importing a finished audit's report, the parts that are pure.
 *
 * A report from the worker goes through the same limits as an uploaded file: the same size cap
 * (measured the way a file is, as UTF-8 bytes of its JSON text) and the same fixed message when
 * storing it fails. The database's own error text is logged on the server, never shown.
 */

export const STORE_FAILED_MESSAGE = 'The report validated, but storing it failed. Try again later.';

/** The report's size as a file: UTF-8 bytes of its JSON text. Zero for no report. */
export function reportByteLength(report: unknown): number {
  if (report === null || report === undefined) return 0;
  const text = JSON.stringify(report);
  return text === undefined ? 0 : new TextEncoder().encode(text).byteLength;
}
