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
    starred: payload?.starred != null ? Boolean(payload.starred) : payload?.isStarred != null ? Boolean(payload.isStarred) : undefined,
    excludeDeleted: payload?.excludeDeleted != null ? Boolean(payload.excludeDeleted) : undefined,
    dateFrom: payload?.dateFrom != null ? Number(payload.dateFrom) : payload?.since != null ? Number(payload.since) : undefined,
    dateTo: payload?.dateTo != null ? Number(payload.dateTo) : payload?.until != null ? Number(payload.until) : undefined,
    ids: payload?.ids != null ? (payload.ids as number[]) : undefined,
    tag: payload?.tag != null ? String(payload.tag) : payload?.tagFilter != null ? String(payload.tagFilter) : undefined,
    gistSynced: payload?.gistSynced != null ? Number(payload.gistSynced) : undefined,
  });
}
