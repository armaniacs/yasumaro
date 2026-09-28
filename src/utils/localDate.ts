/**
 * localDate.ts
 * Single source of truth for local-calendar date handling (PBI
 * 2026-09-28-11): formatting a timestamp into a `YYYY-MM-DD` local date
 * string, parsing such a string back into local midnight, and building an
 * inclusive one-local-day range.
 *
 * Layer 0: pure functions, no `chrome` / DOM / storage / Intl dependency.
 *
 * WHY one module: 16 hand-rolled copies of these three operations had drifted
 * apart, and the drift was not cosmetic — see the two policies below.
 *
 * Policy (lenient, matching the majority of the call sites): a well-formed
 * but non-existent date such as `2026-02-30` is accepted and normalized by
 * the `Date` constructor to 2026-03-02. Callers that must reject it use
 * `archiveGuards.cutoffMsFromLocalDate`, which is a deliberately different
 * contract: archive cutoff dates come from an operator-facing input where
 * silently archiving the wrong month is unacceptable, so it validates the
 * round trip and throws. That is an intentional duplication across a policy
 * boundary, NOT a candidate for folding into this module.
 *
 * NOT here on purpose (YAGNI): relative labels, week/month buckets, fiscal
 * months, locale-aware rendering, and other "date-shaped" work. Only the three
 * responsibilities above belong to the SSOT.
 *
 * `<input type="date">` round trip: {@link formatLocalDateString} produces the
 * input's `value` and {@link parseLocalDateStart} reads it back, so both halves
 * of that contract live side by side here. `datetime-local`, `week` and `month`
 * inputs keep their own handling until one of them needs migrating.
 */

/** Milliseconds in one wall-clock day as the `Date` API reports it. */
export const DAY_MS = 86_400_000;

/**
 * Local `YYYY-MM-DD` for an epoch-ms timestamp, in the user's timezone.
 * Month and day are zero-padded; the year is not (a padded year would change
 * generated vault paths for historical dates — see dailyNotePathBuilder).
 */
export function formatLocalDateString(timestamp: number): string {
  const d = new Date(timestamp);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Thin `Date` wrapper over {@link formatLocalDateString} for call sites that
 * already hold a `Date` (calendar navigation, daily-note paths).
 */
export function formatLocalDate(date: Date): string {
  return formatLocalDateString(date.getTime());
}

/**
 * Local midnight of a `YYYY-MM-DD` date string, as epoch ms. NaN for an empty
 * or unparseable value, which callers read as "no bound selected".
 *
 * WHY append `T00:00:00`: a bare `new Date('2026-03-31')` is specified as
 * UTC midnight, which in any negative-offset zone lands on the previous local
 * day. The explicit local time component pins it to the local zone.
 */
export function parseLocalDateStart(value: string): number {
  if (!value) return NaN;
  return new Date(value + 'T00:00:00').getTime();
}

/** Local midnight (00:00:00.000) of the day containing `ts`. */
export function startOfLocalDayMs(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Inclusive local end of the day containing `ts` (23:59:59.999).
 *
 * WHY setHours instead of `start + 86_400_000 - 1`: a calendar day is not
 * always 86_400_000 ms. On a DST transition the day is 23h (spring forward)
 * or 25h (fall back), so the fixed-offset form either over-runs into the next
 * day or truncates the last hour of it.
 */
export function endOfLocalDayMs(ts: number): number {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/**
 * Inclusive one-local-day range for a `YYYY-MM-DD` date string — the exact
 * bounds a history query for that calendar day must use.
 */
export function localDayRangeFromDateString(value: string): { since: number; until: number } {
  const start = parseLocalDateStart(value);
  return { since: start, until: endOfLocalDayMs(start) };
}
