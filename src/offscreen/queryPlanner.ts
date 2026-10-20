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
import { clampLimit, clampOffset, selectReadCap, DEFAULT_QUERY_LIMIT, type AlreadyCappedQuery } from './queryPlan.js';
import { MAX_QUERY_LIMIT, AUDIT_CAP_IDB } from '../utils/limits.js';
import { sanitizeTextForFts5, shouldUseFts5 } from './sqliteQueryBuilder.js';
import { FTS_QUERY_MAX_LENGTH } from './schema.js';
import { pickDefined } from '../utils/objectUtils.js';
import type { StorageQuery } from '../utils/sqlite-types.js';

/**
 * Retention defaults for the purge seam — the SSOT (PBI 04). dbMaintenance's
 * executor defaults (purgeOldRecords) import these, the same executor ->
 * planner direction recordsRepo (applyReadPolicy) and IdbVfsBackend
 * (planAuditLog) already use, so the wire defaults and the executor defaults
 * cannot drift apart. Pinned by purgeDefaultsParity.test.ts.
 */
export const DEFAULT_RETENTION_DAYS = 90;
export const DEFAULT_MAX_RECORDS = 1000;
/**
 * Dashboard search page-size default. Owned by this planner seam since
 * PBI 2026-09-21-20 (the background pre-clamp that used to supply it was
 * removed as a policy copy + LAYERS violation). The listing default stays
 * DEFAULT_QUERY_LIMIT (100).
 */
export const DEFAULT_SEARCH_LIMIT = 50;

/**
 * Apply the read policy to an already-normalized query: clamp the limit and
 * truncate tag/text so extremely long input cannot become an expensive FTS5
 * query. Pure — safe to unit-test without a backend.
 */
export function applyReadPolicy(q: StorageQuery, defaultLimit: number = DEFAULT_QUERY_LIMIT): AlreadyCappedQuery {
  const cappedLimit = clampLimit(q.limit, MAX_QUERY_LIMIT, defaultLimit);
  const tag = q.tag ? q.tag.slice(0, FTS_QUERY_MAX_LENGTH) : q.tag;
  const text = q.text ? q.text.slice(0, FTS_QUERY_MAX_LENGTH) : q.text;
  return { ...q, limit: cappedLimit, ...pickDefined({ tag, text }) } as AlreadyCappedQuery;
}

/**
 * Plan a filtered listing from a wire payload: collapse aliases, then apply
 * the read policy. Replaces the handler-side `normalizeStorageQuery` +
 * repo-side clamp/truncate split.
 */
export function planQuery(payload: Record<string, unknown>): AlreadyCappedQuery {
  return applyReadPolicy(normalizeStorageQuery(payload));
}

/**
 * Plan a text search from a wire payload: gateway spelling carries `text`
 * (kind:'search'), the direct SQLITE_SEARCH spelling carries `query`.
 * One precedence rule (PBI 2026-10-16-11): a non-empty `text` wins,
 * otherwise `query` is the term (both absent is the plain-listing '').
 * Previously the explicit `query` read and the normalize-spread overwrite
 * each owned one spelling implicitly via object spread order; the rule is
 * now stated once. The search route owns the smaller page-size default
 * (50) — only this planner passes it, so a search sent without a limit
 * lands here rather than inheriting the listing default.
 */
export function planSearch(payload: Record<string, unknown>): AlreadyCappedQuery {
  const normalized = normalizeStorageQuery(payload);
  const query = (payload as { query?: unknown }).query;
  const text = normalized.text ?? (query != null ? String(query) : '');
  return applyReadPolicy({ ...normalized, text }, DEFAULT_SEARCH_LIMIT);
}

/**
 * Dispatch entry for the wire `query` runner. The gateway folds the search op
 * into SQLITE_QUERY with a `kind: 'search'` payload marker (search row's
 * encodePayload), so this single entry owns the route decision: marker →
 * planSearch (search default 50), otherwise planQuery (listing default 100).
 * Pure — safe to unit-test without a handler.
 */
export function planQueryOrSearch(payload: Record<string, unknown>): AlreadyCappedQuery {
  if ((payload as { kind?: unknown }).kind === 'search') {
    return planSearch(payload);
  }
  return planQuery(payload);
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

/**
 * Shared purge-dimension check (PBI 2026-10-16-11): one integer rule for
 * both the wire path (planPurge) and the settings path (planSettingsPurge).
 * Returns the number, or the fail-closed error message. `0` passes here —
 * callers map it to "skip this dimension" (undefined), the same reading
 * every backend applies via its `!= null && > 0` guard.
 */
function checkPurgeInt(raw: unknown, name: string): number | string {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0) {
    return `${name} must be a non-negative integer, got ${String(raw)}`;
  }
  return raw;
}

/** Map a checked dimension to the backend contract (`0` = skip). */
function toPurgeDim(checked: number): number | undefined {
  return checked === 0 ? undefined : checked;
}

export function planPurge(
  retentionDays: unknown,
  maxRecords: unknown,
  includeStarred: unknown = undefined,
): PlanPurgeResult {
  const normalize = (raw: unknown, fallback: number, name: string): number | undefined | string => {
    if (raw === undefined) return fallback;
    const checked = checkPurgeInt(raw, name);
    if (typeof checked === 'string') return checked;
    return toPurgeDim(checked);
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

/**
 * Settings-driven purge plan (PBI 2026-10-16-11): the canonical planner
 * for the background retention-keys path (`purge_now` / `content_purge_now`).
 *
 * The background handler cannot statically import this seam
 * (background→offscreen import ban, PBI 2026-09-21-20), so it carries a
 * layer-local mirror pinned by parity tests — but the contract lives here:
 * absent (`undefined` or `null`, the shapes chrome.storage yields) on BOTH
 * sides means "no retention configured" → skip; a present side is checked
 * by the same `checkPurgeInt` rule as the wire path and `0` normalizes to
 * "skip this dimension". Unlike planPurge, an absent side stays undefined —
 * no per-side default is applied (a days-only setting must not gain a cap).
 * Pure — safe to unit-test without a backend.
 */
export type PlanSettingsPurgeResult =
  | { skip: true }
  | { ok: true; retentionDays?: number | undefined; maxRecords?: number | undefined; includeStarred?: boolean | undefined }
  | { ok: false; error: string };

const isPurgeAbsent = (raw: unknown): boolean => raw === undefined || raw === null;

export function planSettingsPurge(
  settings: Record<string, unknown>,
  daysKey: string,
  maxKey: string,
  includeStarredKey?: string,
): PlanSettingsPurgeResult {
  const daysRaw = settings[daysKey];
  const maxRaw = settings[maxKey];
  if (isPurgeAbsent(daysRaw) && isPurgeAbsent(maxRaw)) {
    return { skip: true };
  }
  const planDim = (raw: unknown, name: string): number | undefined | string => {
    if (isPurgeAbsent(raw)) return undefined;
    const checked = checkPurgeInt(raw, name);
    return typeof checked === 'string' ? checked : toPurgeDim(checked);
  };
  const days = planDim(daysRaw, 'retentionDays');
  if (typeof days === 'string') return { ok: false, error: days };
  const max = planDim(maxRaw, 'maxRecords');
  if (typeof max === 'string') return { ok: false, error: max };
  const starredRaw = includeStarredKey !== undefined ? settings[includeStarredKey] : undefined;
  return {
    ok: true,
    retentionDays: days,
    maxRecords: max,
    ...(typeof starredRaw === 'boolean' ? { includeStarred: starredRaw } : {}),
  };
}
