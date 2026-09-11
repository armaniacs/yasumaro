/**
 * queryPlanner.ts
 * Single owner of the offscreen read policy: wire payload -> StorageQuery.
 *
 * Every dashboard read funnels through `planQuery` / `planSearch` before
 * reaching a StorageBackend. The policy used to be split across two files —
 * `sqliteMessageHandlers` normalized aliases while `recordsRepo.query`
 * clamped limits and truncated FTS input — so a policy change had to land
 * in both places consistently. It now lives here, in one pure composition:
 *
 *   normalize (queryNormalize) -> clamp (queryPlan.clampLimit) -> truncate (schema.FTS_QUERY_MAX_LENGTH)
 *
 * Statement building (`queryPlan` / `sqliteQueryBuilder`) and row decoding
 * (`rowCodec`) remain the planner's internals: backends consume the planned
 * StorageQuery and build against those modules directly (the OPFS worker
 * boundary prevents moving them behind an opaque facade — see PBI
 * 2026-09-11-05 implementation memo). `browsingLogCodec` is adjacent, not
 * owned: it encodes write payloads, not reads.
 */

import { normalizeStorageQuery } from './queryNormalize.js';
import { clampLimit } from './queryPlan.js';
import { MAX_QUERY_LIMIT } from '../messaging/limits.js';
import { FTS_QUERY_MAX_LENGTH } from './schema.js';
import { pickDefined } from '../utils/objectUtils.js';
import type { StorageQuery } from '../utils/sqlite-types.js';

/** Default page size when the caller supplies no limit. */
export const DEFAULT_QUERY_LIMIT = 100;

/**
 * Apply the read policy to an already-normalized query: clamp the limit and
 * truncate tag/text so extremely long input cannot become an expensive FTS5
 * query. Pure — safe to unit-test without a backend.
 */
export function applyReadPolicy(q: StorageQuery): StorageQuery {
  const cappedLimit = clampLimit(q.limit, MAX_QUERY_LIMIT, DEFAULT_QUERY_LIMIT);
  const tag = q.tag ? q.tag.slice(0, FTS_QUERY_MAX_LENGTH) : q.tag;
  const text = q.text ? q.text.slice(0, FTS_QUERY_MAX_LENGTH) : q.text;
  return { ...q, limit: cappedLimit, ...pickDefined({ tag, text }) };
}

/**
 * Plan a filtered listing from a wire payload: collapse aliases, then apply
 * the read policy. Replaces the handler-side `normalizeStorageQuery` +
 * repo-side clamp/truncate split.
 */
export function planQuery(payload: Record<string, unknown>): StorageQuery {
  return applyReadPolicy(normalizeStorageQuery(payload));
}

/**
 * Plan a text search from a wire payload: the free-text `query` field rides
 * alongside the normalized filters, then the read policy applies.
 */
export function planSearch(payload: Record<string, unknown>): StorageQuery {
  const text = String((payload as { query?: unknown }).query ?? '');
  return applyReadPolicy({ text, ...normalizeStorageQuery(payload) });
}
