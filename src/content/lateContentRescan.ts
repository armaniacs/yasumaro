/**
 * lateContentRescan.ts
 *
 * SPA late-content re-scan (PBI 2026-10-22-06, slice 2: first capture slice).
 * Infinite-scroll pages and late-hydrating SPAs keep growing after the first
 * VALID_VISIT closed the gate, so the recorded excerpt misses the half the
 * reader actually spent time on. This module owns the pure re-arm verdict:
 * once the visible text has grown past a threshold, the gate opens once more
 * (bounded) so the normal pipeline re-extracts, re-cleanses, and re-sends.
 *
 * The re-send rides the single extraction seam
 * (`ContentKernel.extractAndCommit` → `preparePageContent`), so cleansing and
 * PII masking apply to late content exactly as they do to first content —
 * there is no second scrape path to drift. The background's own admission
 * (rate limit, same-day dedup) stays the backstop: a bounded re-arm can at
 * most produce bounded extra sends, never a loop.
 */

import { readVisibleChars } from './lateContentDomReader.js';

/**
 * A page must grow by at least this many visible characters before a
 * re-scan is offered. Small enough to catch a real "load more" batch, large
 * enough that font/whitespace churn never qualifies.
 */
export const LATE_RESCAN_MIN_GROWTH_CHARS = 2000;

/**
 * Upper bound on re-arms per page view. Two extra sends worst-case per
 * visit: the flood guard and the same-day dedup behind it never see more.
 */
export const LATE_RESCAN_MAX_REARMS = 2;

/**
 * Pure re-arm verdict. Unknown or degenerate inputs fail closed to false —
 * the detector's blind spots can only ever keep today's one-shot behavior.
 */
export function shouldRearmForLateContent(
  recordedChars: number,
  currentChars: number,
  rescanCount: number,
): boolean {
  if (!Number.isFinite(recordedChars) || !Number.isFinite(currentChars)) return false;
  if (recordedChars <= 0) return false;
  if (currentChars <= recordedChars) return false;
  if (!Number.isInteger(rescanCount) || rescanCount < 0) return false;
  if (rescanCount >= LATE_RESCAN_MAX_REARMS) return false;
  const growth = currentChars - recordedChars;
  // Short pages must at least double (one appended paragraph on a stub must
  // not re-open the gate); long pages re-arm on one full page of growth.
  const threshold = Math.max(LATE_RESCAN_MIN_GROWTH_CHARS, recordedChars);
  return growth >= threshold;
}

export { readVisibleChars };
