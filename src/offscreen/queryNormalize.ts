/**
 * queryNormalize.ts
 * Single normalizer for storage-query wire payloads.
 *
 * The dashboard and the gateway spell the same filters differently
 * (starred|isStarred, dateFrom|since, dateTo|until, tag|tagFilter), so both
 * SQLITE_QUERY and SQLITE_SEARCH funnel through this pure function instead
 * of each handler re-implementing the alias ternaries.
 */

import { pickDefined } from '../utils/objectUtils.js';
import type { StorageQuery } from '../utils/sqlite-types.js';
import { MAX_QUERY_IDS } from '../messaging/limits.js';

/**
 * Normalize a query-shaped wire payload into a StorageQuery.
 * Unknown keys are dropped; every alias family collapses to one field.
 */
export function normalizeStorageQuery(payload: Record<string, unknown>): StorageQuery {
  return pickDefined({
    limit: payload?.limit != null ? Number(payload.limit) : undefined,
    offset: payload?.offset != null ? Number(payload.offset) : undefined,
    orderBy: payload?.orderBy as 'created_at' | 'rank' | undefined,
    orderDir: payload?.orderDir as 'ASC' | 'DESC' | undefined,
    domain: payload?.domain != null ? String(payload.domain) : undefined,
    // PBI 2026-09-12-13: the snake_case `is_starred` numeric alias used to
    // live only in FallbackStorage's local re-derivation, so the same wire
    // payload filtered differently per backend. It collapses here now.
    starred: payload?.starred != null ? Boolean(payload.starred) : payload?.isStarred != null ? Boolean(payload.isStarred) : payload?.is_starred != null ? Boolean(Number(payload.is_starred)) : undefined,
    excludeDeleted: payload?.excludeDeleted != null ? Boolean(payload.excludeDeleted) : undefined,
    dateFrom: payload?.dateFrom != null ? Number(payload.dateFrom) : payload?.since != null ? Number(payload.since) : undefined,
    dateTo: payload?.dateTo != null ? Number(payload.dateTo) : payload?.until != null ? Number(payload.until) : undefined,
    // PBI 2026-09-11-01 (round 5): ids crosses the wire — a string or scalar
    // used to pass through the cast and crash buildExtraWhereSql's .map.
    // Normalize to a finite-number array; anything else (or an all-invalid
    // array) drops the filter.
    // PBI 2026-09-11-02 (round 6): bound the array (a giant wire payload must
    // not become a giant SQL IN clause) and keep integers only.
    ids: (() => {
      if (!Array.isArray(payload?.ids)) return undefined;
      const ids = (payload.ids as unknown[])
        .slice(0, MAX_QUERY_IDS)
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 0);
      return ids.length > 0 ? ids : undefined;
    })(),
    tag: payload?.tag != null ? String(payload.tag) : payload?.tagFilter != null ? String(payload.tagFilter) : undefined,
    gistSynced: payload?.gistSynced != null ? Number(payload.gistSynced) : undefined,
  });
}
