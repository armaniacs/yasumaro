/**
 * fetchPeriodRows.ts
 * The single fetch seam for the dashboard async-data panels: one retry
 * policy, one cap convention, one key-omission convention.
 *
 * Eight panels load their data through this module and receive
 * `{ rows, total, capped }`: a persistent failure throws (the caller's
 * catch shows a distinct error state, never "no records"), and `capped`
 * is derived from `total > rows.length` — the one cap definition, so
 * panels need no row-count heuristics of their own.
 *
 * `fetchAllPeriodRows` is the paged variant for panels that must see a whole
 * window (not a top-N slice): it drives `fetchPeriodRows` with a keyset
 * cursor so the pages compose into one de-duplicated row set.
 */

import {
  getSqliteStatus,
  isServiceError,
  queryLogs,
  type BrowsingLogEntry,
} from '../dashboardSqliteService.js';
import { pickDefined } from '../../utils/objectUtils.js';
import { retryWithExponentialBackoff } from '../utils/retry.js';

export interface FetchPeriodRowsOptions {
  since?: number | undefined;
  until?: number | undefined;
  limit: number;
  tagFilter?: string | undefined;
  /** Retry/console label; also names the thrown error. */
  label?: string | undefined;
  /** Maximum attempts including the first. Default 4 (retry.ts default). */
  maxAttempts?: number | undefined;
}

export interface FetchPeriodRowsResult {
  rows: BrowsingLogEntry[];
  total: number;
  capped: boolean;
}

const DEFAULT_LABEL = 'fetchPeriodRows';
const DEFAULT_MAX_ATTEMPTS = 4;

export async function fetchPeriodRows(
  options: FetchPeriodRowsOptions,
): Promise<FetchPeriodRowsResult> {
  const { limit, label = DEFAULT_LABEL, maxAttempts = DEFAULT_MAX_ATTEMPTS } = options;
  const result = await retryWithExponentialBackoff<{ rows: BrowsingLogEntry[]; total: number }>(
    async () => {
      const status = await getSqliteStatus();
      if (!status?.initialized) {
        return null;
      }
      // WHY: pickDefined drops undefined-valued keys, so unset bounds/tag
      // pass no key rather than an undefined-valued one — the all-time query
      // stays a plain { limit } call, and this omission convention lives
      // here instead of being re-derived per panel.
      const qRes = await queryLogs({
        ...pickDefined({ since: options.since, until: options.until, tagFilter: options.tagFilter }),
        limit,
      });
      // Return null (not an empty result) on failure: retryWithExponentialBackoff
      // only retries when the thunk yields null or throws, so coercing an error
      // to a success would surface a silent "no data" render.
      if (isServiceError(qRes)) {
        return null;
      }
      return qRes.data;
    },
    { label, maxAttempts },
  );
  // WHY: a failed query must not render as "no records" — throw so the
  // panel's catch shows a distinct error state (wordClusterPanel convention).
  if (result === null) {
    throw new Error(`${label}: query failed after retries`);
  }
  // WHY: queryLogs caps the fetch, so only a total beyond the fetched row
  // count proves truncation — a period holding exactly the cap is complete
  // and must not claim a partial set.
  return { rows: result.rows, total: result.total, capped: result.total > result.rows.length };
}

export interface FetchAllPeriodRowsOptions {
  since?: number | undefined;
  until?: number | undefined;
  tagFilter?: string | undefined;
  pageSize: number;
  maxRows: number;
  label: string;
}

export interface FetchAllPeriodRowsResult {
  rows: BrowsingLogEntry[];
  capped: boolean;
}

/**
 * Pages a whole window with a keyset cursor and returns the de-duplicated set.
 *
 * WHY: `fetchPeriodRows` caps a single page, so a panel that must rank or
 * count across the full window cannot use one call. Offset pagination over a
 * live table double-counts or skips rows (the recorder keeps inserting while
 * this runs), so the cursor is the previous page's oldest `created_at` —
 * `queryLogs`'s `until` is inclusive, so boundary ties are re-read and merged
 * by unique id. Every row is therefore counted exactly once, and the upper
 * bound is frozen at fetch start so a live DESC window cannot shift mid-run.
 */
export async function fetchAllPeriodRows(
  options: FetchAllPeriodRowsOptions,
): Promise<FetchAllPeriodRowsResult> {
  const { since, until, tagFilter, pageSize, maxRows, label } = options;
  // WHY: freeze the upper bound at fetch start — rows recorded while this
  // aggregation pages have newer created_at values and would otherwise
  // shift a live DESC window between pages (offset-pagination hazard).
  const snapshotUntil = until ?? Date.now();
  // WHY: keyset cursor instead of offset — each page re-reads the previous
  // page's boundary timestamp (queryLogs `until` is inclusive) and the
  // merged set dedupes by unique id, so created_at ties and live inserts
  // can double-read but never double-count or skip a record.
  const byId = new Map<number, BrowsingLogEntry>();
  let cursor = snapshotUntil;
  while (byId.size < maxRows) {
    const page = await fetchPeriodRows({
      ...pickDefined({ since, until: cursor, tagFilter }),
      limit: pageSize,
      label,
    });
    const batch = page.rows;
    if (batch.length === 0) {
      return { rows: Array.from(byId.values()), capped: false };
    }
    const sizeBefore = byId.size;
    for (const row of batch) {
      byId.set(row.id, row);
    }
    if (batch.length < pageSize) {
      return { rows: Array.from(byId.values()), capped: false };
    }
    const oldest = batch[batch.length - 1]!.created_at;
    if (byId.size === sizeBefore) {
      // WHY: the entire page was boundary-tie rows already merged — more
      // than a page shares one created_at. Step back 1ms so the loop cannot
      // stall; rows beyond a full page sharing that exact millisecond are
      // not fetched (pathological: >10k records with identical created_at).
      cursor = oldest - 1;
    } else {
      cursor = oldest;
    }
  }
  // WHY: a full final batch at the cap means more rows likely exist beyond
  // it — report the cap instead of implying completeness.
  return { rows: Array.from(byId.values()), capped: true };
}
