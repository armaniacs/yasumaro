/**
 * archiveGuards.ts
 * Layer-neutral guards and constants shared by the archive feature family
 * (record-archive / restore / temp-open).
 *
 * NOTE on placement: this lives in src/utils/ (not src/offscreen/opfsWorker/)
 * because messaging validators (src/messaging/validators.ts) and dashboard
 * code need the same pure functions; utils is importable from every layer.
 * Only OPFS-touching logic lives in the opfsWorker modules.
 */

/** Hard cap for a single archive/staging .db file (200 MiB). */
export const MAX_ARCHIVE_FILE_BYTES = 200 * 1024 * 1024;

/** Archive container format version written into yasumaro_archive_meta. */
export const ARCHIVE_FORMAT_VERSION = 1;

/**
 * Staging file names are always issued by the offscreen registry. Client
 * supplied names must match exactly — this blocks `yasumaro.db` (opening the
 * main DB as a second engine) and path traversal.
 */
export const ARCHIVE_STAGING_NAME_RE =
  /^archive_(outgoing|incoming)_[A-Za-z0-9-]{36}\.db$/;

export function isValidStagingName(name: unknown): boolean {
  return typeof name === 'string' && ARCHIVE_STAGING_NAME_RE.test(name);
}

/**
 * Branded staging name: a string that has passed the registry-issued name
 * shape (`ARCHIVE_STAGING_NAME_RE`). The brand exists so the "valid staging
 * name" constraint is readable from interfaces instead of living in scattered
 * `length === 0` / regex checks across layers.
 *
 * Generation points (only two): `issueName()` in archiveStaging.ts and the
 * boundary decode in messaging validators (`decodeStagingName` below).
 * Wire payload types stay `string` — the brand is erased at serialization.
 */
export type StagingName = string & { readonly __stagingNameBrand: unique symbol };

/**
 * Boundary decode: throw unless the value is a well-formed staging name.
 * Validators map the throw to their layer message; the brand marks the value
 * as having crossed the boundary.
 */
export function decodeStagingName(name: unknown): StagingName {
  if (!isValidStagingName(name)) {
    throw new Error(`Invalid staging name: ${String(name)}`);
  }
  return name as StagingName;
}

/**
 * URL scheme guard (http/https only). Single source of truth shared by
 * messaging validators, the dashboard render path, and archive restore.
 */
export function isHttpScheme(protocol: unknown): boolean {
  return protocol === 'http:' || protocol === 'https:';
}

export function isHttpUrl(url: unknown): boolean {
  if (typeof url !== 'string' || url.length === 0) return false;
  try {
    return isHttpScheme(new URL(url).protocol);
  } catch {
    return false;
  }
}

const MIN_CUTOFF_MS = new Date(2000, 0, 1).getTime();

/**
 * Convert a "YYYY-MM-DD" local date into the end-of-day cutoff in UTC ms.
 *
 * WHY the numeric Date constructor: `new Date('2026-03-31')` parses as UTC
 * midnight (dropping most of the boundary day), and `Date.parse` on date-time
 * strings has historical browser quirks. The numeric constructor is specified
 * to use the local timezone.
 *
 * Throws when the input is not a well-formed, real, in-range calendar date —
 * "2026-02-30" must not silently normalize to March, and "9999-99-99" must
 * not become a giant cutoff that archives/deletes everything.
 */
export function cutoffMsFromLocalDate(dateStr: string): number {
  if (typeof dateStr !== 'string') {
    throw new Error(`Invalid archive cutoff date: ${String(dateStr)}`);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) {
    throw new Error(`Invalid archive cutoff date format: ${dateStr}`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const ms = new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
  // Round-trip check rejects non-existent dates (e.g. 2026-02-30) that the
  // constructor would otherwise normalize.
  const d = new Date(ms);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    throw new Error(`Invalid archive cutoff date: ${dateStr}`);
  }
  if (Number.isNaN(ms) || ms < MIN_CUTOFF_MS || ms > Date.now() + 2 * 24 * 60 * 60 * 1000) {
    throw new Error(`Archive cutoff date out of range: ${dateStr}`);
  }
  return ms;
}

/**
 * Pair mismatch between a client-supplied `cutoffMs` and its `cutoffDate`.
 * Carries the re-derived expectation so callers can surface it (BDD: the
 * throw message includes `cutoffMsFromLocalDate(cutoffDate)`).
 */
export class CutoffMismatchError extends Error {
  readonly expectedMs: number;
  constructor(cutoffDate: unknown, cutoffMs: unknown, expectedMs: number) {
    super(
      `cutoffMs (${String(cutoffMs)}) does not match cutoffDate (${String(cutoffDate)}) — expected ${expectedMs}`,
    );
    this.name = 'CutoffMismatchError';
    this.expectedMs = expectedMs;
  }
}

/**
 * Single seam for the "cutoffDate + cutoffMs pair is genuine" concept.
 * Re-derives the cutoff via `cutoffMsFromLocalDate` (format, reality, and
 * range — including the +2 day future tolerance — all enforced there),
 * then requires strict equality with the supplied `cutoffMs`.
 *
 * Returns the derived ms on success. Throws the derivation error as-is for
 * bad dates, `Error('cutoffMs must be finite number')` for non-finite input,
 * and `CutoffMismatchError` (message embeds the expectation) for forged pairs.
 */
export function assertCutoffPair(cutoffDate: unknown, cutoffMs: unknown): number {
  if (typeof cutoffMs !== 'number' || !Number.isFinite(cutoffMs)) {
    throw new Error('cutoffMs must be finite number');
  }
  const derived = cutoffMsFromLocalDate(cutoffDate as string);
  if (cutoffMs !== derived) {
    throw new CutoffMismatchError(cutoffDate, cutoffMs, derived);
  }
  return derived;
}
