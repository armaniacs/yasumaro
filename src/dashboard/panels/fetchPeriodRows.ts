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
