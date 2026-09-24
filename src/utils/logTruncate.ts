/**
 * logTruncate.ts
 * Cap server-controlled response bodies before they reach the diagnostic log.
 *
 * The logger pipeline already neutralizes line breaks/control chars at the
 * sink, but a 1MB error body would still bloat log storage (unlimitedStorage)
 * and TSV exports. Truncate to a few hundred chars first; the thrown Error
 * shown to the user stays generic so no body content leaks there.
 */

/** Max chars of a response body ever written to the log. */
export const MAX_LOG_BODY_CHARS = 500;

/** Visible marker appended when truncation happened. */
export const LOG_TRUNCATION_MARKER = '…(truncated)';

export function truncateForLog(body: string, maxChars: number = MAX_LOG_BODY_CHARS): string {
  const oneLine = body.replace(/\r\n|\r|\n/g, ' ');
  if (oneLine.length <= maxChars) return oneLine;
  return `${oneLine.slice(0, maxChars)}${LOG_TRUNCATION_MARKER}`;
}
