// src/offscreen/queryParityPredicate.ts
// In-memory parity predicate for StorageQuery filtering.
//
// Moved verbatim from sqliteQueryBuilder.ts (PBI 2026-11-07-12): the builder
// keeps SQL assembly only. The policy module cannot host this predicate — it
// needs `rowMatchesTagLike`, and the split requires the policy module to hold
// no tagLike runtime import — so the implementation lives here; queryPlan.ts
// keeps a compat re-export through the builder facade.

import type { StorageQuery } from '../utils/sqlite-types.js';
import { rowMatchesTagLike } from '../utils/tagLike.js';

/**
 * Shared in-memory predicate mirroring buildExtraWhereSql's semantics.
 * Lets InMemoryTransport filter without reimplementing the condition set —
 * both the SQL generator and the JS fallback read from the same source.
 */
export function matchesExtraWhere(
  record: { domain?: string | null; is_starred?: number; gist_synced?: number | null; created_at: number; id?: number; tags?: string | null },
  query: Pick<StorageQuery, 'dateFrom' | 'dateTo' | 'domain' | 'starred' | 'gistSynced' | 'ids' | 'tag'>
): boolean {
  if (query.domain != null && query.domain !== '' && record.domain !== query.domain) return false;
  if (query.starred != null && Boolean(record.is_starred) !== query.starred) return false;
  if (query.gistSynced != null && (record.gist_synced ?? 0) !== query.gistSynced) return false;
  if (query.dateFrom != null && record.created_at < (query as StorageQuery).dateFrom!) return false;
  if (query.dateTo != null && record.created_at > (query as StorageQuery).dateTo!) return false;
  if (query.ids != null && query.ids.length > 0) {
    if (record.id == null || !query.ids.includes(record.id)) return false;
  }
  if (query.tag != null && query.tag !== '' && !rowMatchesTagLike(record.tags, query.tag)) return false;
  return true;
}
