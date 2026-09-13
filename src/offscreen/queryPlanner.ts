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
import { clampLimit, clampOffset } from './queryPlan.js';
import { MAX_QUERY_LIMIT, QUERY_CAPS, AUDIT_CAP_IDB } from '../messaging/limits.js';
import { sanitizeTextForFts5, shouldUseFts5 } from './sqliteQueryBuilder.js';
import { FTS_QUERY_MAX_LENGTH } from './schema.js';
import { pickDefined } from '../utils/objectUtils.js';
import type { StorageQuery } from '../utils/sqlite-types.js';

/** Default page size when the caller supplies no limit. */
export const DEFAULT_QUERY_LIMIT = 100;

/** Retention defaults for the purge seam (mirror dbMaintenance's values). */
export const DEFAULT_RETENTION_DAYS = 90;
export const DEFAULT_MAX_RECORDS = 1000;

/**
 * Cap selection, owned by the planner seam (PBI 2026-09-12-16).
 *
 * The fts/plain choice used to be re-derived inline at every call site
 * (buildQuerySpec, OPFS handleSearch), so a cap change needed N synchronized
 * edits. Callers ask here; `buildQuerySpec` keeps only a defensive re-clamp
 * at the worker boundary.
 */
export function selectReadCap(useFts: boolean): number {
  return useFts ? QUERY_CAPS.fts : QUERY_CAPS.plain;
}

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

/**
 * Clamp a search limit through the planner-owned cap (PBI 2026-09-12-16).
 *
 * OPFS `handleSearch` used to pick the fts/plain cap inline; it now asks
 * here so the choice lives in one place. Pure — safe to unit-test without
 * a backend.
 */
export function applySearchPolicy(q: StorageQuery, fts5Available: boolean): StorageQuery & { limit: number } {
  const bare = q.text ? sanitizeTextForFts5(q.text) : null;
  const useFts = bare ? shouldUseFts5(fts5Available, bare) : false;
  return { ...q, limit: clampLimit(q.limit, selectReadCap(useFts), DEFAULT_QUERY_LIMIT) };
}

/**
 * Audit-read paging seam (PBI 2026-09-12-17).
 *
 * Cap/offset policy used to be re-derived per layer (dashboard pre-clamp,
 * IDB 100k, worker 1000) with **no offset policy at all** — a garbage offset
 * reached `OFFSET ?` as NaN and surfaced as a backend error. Both backends
 * now ask here; each keeps its documented cap divergence via the `cap`
 * argument (`AUDIT_CAP_IDB` / `AUDIT_CAP_OPFS` from limits.ts).
 * Pure — safe to unit-test without a backend.
 */
export function planAuditLog(
  options: { limit?: number; offset?: number } | undefined,
  cap: number = AUDIT_CAP_IDB,
): { limit: number; offset: number } {
  return {
    limit: clampLimit(options?.limit, cap, DEFAULT_QUERY_LIMIT),
    offset: clampOffset(options?.offset),
  };
}

/**
 * Destructive-purge trust boundary (PBI 2026-09-12-19).
 *
 * Purge used to flow raw wire numbers to three backends: defaults applied
 * only to `undefined`, so `NaN`/negative/`Infinity` reached the cutoff
 * arithmetic — `purgeCutoffMs(NaN) = NaN` silently purged nothing while
 * reporting `success:true, purged:0` (indistinguishable from "nothing old
 * enough"). The wire payload now must pass this seam; garbage fails closed
 * instead of quietly doing nothing.
 */
export type PlanPurgeResult =
  | { ok: true; retentionDays?: number | undefined; maxRecords?: number | undefined; includeStarred?: boolean | undefined }
  | { ok: false; error: string };

export function planPurge(
  retentionDays: unknown,
  maxRecords: unknown,
  includeStarred: unknown = undefined,
): PlanPurgeResult {
  const normalize = (raw: unknown, fallback: number, name: string): number | string => {
    if (raw === undefined) return fallback;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0) {
      return `${name} must be a non-negative integer, got ${String(raw)}`;
    }
    return raw;
  };

  const days = normalize(retentionDays, DEFAULT_RETENTION_DAYS, 'retentionDays');
  if (typeof days === 'string') return { ok: false, error: days };
  const max = normalize(maxRecords, DEFAULT_MAX_RECORDS, 'maxRecords');
  if (typeof max === 'string') return { ok: false, error: max };

  // PBI 2026-09-12-26: `0` means "skip this dimension" — the same reading
  // every backend applies via its `!= null && > 0` guard. Before this
  // normalization, `purgeOldRecords(0, 0)` deleted everything while
  // `purgeContent(0, 0)` was a no-op: one planner output, opposite
  // destructive meanings.
  return {
    ok: true,
    retentionDays: days === 0 ? undefined : days,
    maxRecords: max === 0 ? undefined : max,
    ...(typeof includeStarred === 'boolean' ? { includeStarred } : {}),
  };
}
