/**
 * queryPlan.ts
 * SSOT for query planning — unified for Idb/OPFS/Fallback.
 *
 * PBI-12: Phase 2 — QueryPlanner as pure function.
 * Grilling decision: Fallback を含めつつ QuerySpec 構造体で統一。
 * LIMIT は fts:100000 / plain:10000 の2種を cap として明示。定義本体は
 * utils/limits.ts にあり、queryPlanner が cap 選択を所有する。ここの clamp は worker 境界での防御的再適用。
 *
 * PBI 2026-11-07-07: policy-vs-statement split. This module is the POLICY
 * layer — mode dispatch, cap selection, the AlreadyCappedQuery brand, the
 * extra-WHERE filter projection, clamps, and the QuerySpec plan seam
 * (buildQuerySpec stays here as thin delegation over the builder, the
 * calling shape callers rely on). All statement assembly (filter
 * vocabulary, search/plain/CRUD/audit/purge builders, the in-memory parity
 * predicate, the purge runner) lives in sqliteQueryBuilder.ts; this module
 * holds NO withTransaction / rowMatchesTagLike runtime refs and no
 * runPurgeSequence. The `export ... from` block at the bottom is a compat
 * facade: every pre-split import path keeps working unchanged.
 */

import { buildWhereClause, buildOrderByClause, buildFts5OrderClause, buildLikeOrderClause, buildTagFilterCondition, sanitizeTextForFts5, shouldUseFts5, buildFilterConditions, qualifyCondition, DELETED_CONDITION_SQL } from './sqliteQueryBuilder.js';
import type { StorageQuery } from '../utils/sqlite-types.js';
import type { SqliteValue } from './sqliteEngine.js';
import { QUERY_CAPS } from '../utils/limits.js';

// ============================================================================
// Mode + cap policy (moved from queryPlanner, PBI 2026-09-15-03) — breaking
// the queryPlanner ⇄ queryPlan cycle: the planner (policy application:
// normalize → clamp → truncate) imports from here, and this module never
// imports the planner. Direction: planner → plan.
// ============================================================================

/** Default page size when the caller supplies no limit. */
export const DEFAULT_QUERY_LIMIT = 100;

/** Query dispatch mode: whether a StorageQuery is a text search or a plain listing. */
export type QueryMode = 'search' | 'listing';

/**
 * Single decision point for search-vs-listing dispatch (root cause of
 * 4a1f6093 and 43385d95): each backend used to re-test `if (q.text)`
 * independently — OpfsWorkerBackend picking the worker message type,
 * IdbVfsBackend picking its FTS/LIKE/plain SQL path, storageFallback
 * picking its filter path. Preserves the exact prior truthiness check
 * (empty string was already "listing" on every backend) — backends now
 * read this instead of re-deriving the check themselves.
 */
export function planQueryMode(q: Pick<StorageQuery, 'text'>): QueryMode {
  return q.text ? 'search' : 'listing';
}

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

/** Brand proving a query has passed the planner's read policy (cap + truncate).
 *  Produced only by applyReadPolicy (planQuery / planSearch / planQueryOrSearch
 *  delegate to it); buildQuerySpec accepts nothing else, so an uncapped query
 *  cannot reach SQL assembly without an explicit (documented)
 *  worker-boundary cast. NOTE (holistic-1107 concern 1, decided keep-as-is):
 *  applySearchPolicy clamps through the planner-owned cap but does NOT confer
 *  this brand — it returns plain StorageQuery, pinned by
 *  alreadyCapped-brand.test.ts. Conferring the brand there would widen the
 *  sanctioned creation point beyond applyReadPolicy. */
declare const __capped: unique symbol;
export type AlreadyCappedQuery = StorageQuery & { readonly [__capped]: true };

/**
 * Unified extra WHERE fragment for FTS/LIKE search paths.
 *
 * IdbVfsBackend, OpfsWorker/searchHandlers and any future SQL backend
 * previously re-implemented the same date/domain/starred/gist/ids filter.
 * This is the single source of truth — see `StorageBackend` Queryable split.
 */
export interface ExtraWhere {
  extraWhereSql: string;
  extraParams: SqliteValue[];
  /** Whether the search builders must emit their (per-path qualified) is_deleted predicate. The predicate itself lives in the builders, never in extraWhereSql (PBI 2026-10-16-04 single-source). */
  includeDeletedFilter: boolean;
}

/** The filter fields `buildExtraWhereSql` reads; everything else on a query is paging or text. */
export type ExtraWhereQuery = Pick<
  StorageQuery,
  'dateFrom' | 'dateTo' | 'domain' | 'starred' | 'gistSynced' | 'ids' | 'excludeDeleted'
>;

export function buildExtraWhereSql(query: ExtraWhereQuery, options: { qualified?: boolean } = {}): ExtraWhere {
  // PBI 2026-10-16-04: the shared is_deleted condition is EXCLUDED from the
  // search fragment — buildFtsSearchStatements/buildLikeSearchStatements own
  // the deleted predicate (deletedCond/baseConds, qualified per path) and
  // switch it on includeDeletedFilter. Emitting it here too produced
  // `... AND b.is_deleted = 0 AND b.is_deleted = 0 AND ...`. It carries no
  // bind params, so extraParams is unaffected; the plain-listing path
  // (buildWhereClause over buildFilterConditions) still carries it.
  const conditions = buildFilterConditions(query).filter((c) => c.sql !== DELETED_CONDITION_SQL);
  const qualified = options.qualified === true;
  const projected = conditions
    .map((c) => (qualified ? qualifyCondition(c, 'b.') : c));
  const extraConds = projected.map((c) => c.sql);
  // PBI 2026-09-12-35: flatMap over the vector — the round-12 version kept
  // the ids array as ONE bind value, so text+ids searches bound a nested
  // array against `id IN (?,?)` on both SQL search paths.
  const extraParams = projected.flatMap((c) => c.params);
  // PBI 2026-09-12-38: the vestigial extraWhereSqlFts duplicate field is
  // gone — the round-13 filter unification made both fields always identical,
  // and "one ExtraWhere serves both paths" was false for SQL text (the LIKE
  // path is unaliased). Callers now build one projection per search path.
  const extraWhereSql = extraConds.length > 0 ? ` AND ${extraConds.join(' AND ')}` : '';
  // The is_deleted condition rode on this WHERE only when excludeDeleted was
  // not explicitly false — search builders read this flag instead of their
  // hardcoded base condition (PBI 2026-09-12-27).
  const includeDeletedFilter = query.excludeDeleted !== false;
  return { extraWhereSql, extraParams, includeDeletedFilter };
}

/** @deprecated alias — use buildExtraWhereSql */
export const extraWhereSql = buildExtraWhereSql;

/**
 * Path-aware tag-filter seam (PBI 2026-09-12-39).
 *
 * Five call sites used to hand-pick `(fts5Available, idColumn)` pairs:
 * - plain listing:  (engine's fts5Available, 'id')      — rides on spec
 * - FTS search:     (true, 'b.id')                       — JOIN needs qualification
 * - LIKE search:    (false, 'id')                        — no FTS, no alias
 * The rebuilds are load-bearing in the cross cases (FTS path with a long tag
 * needs `b.id` qualification the spec lacks; LIKE path on an FTS-capable
 * engine with a long tag needs `tags LIKE ?` while the spec derived MATCH),
 * so this 3-way selector owns the mapping instead.
 *
 * `fts5Available` is the ENGINE capability — the selector overrides it to
 * `false` for the LIKE path and to the true-engine value for the FTS path,
 * so a future non-FTS OPFS engine (or a direct handleSearchFts call on a
 * non-FTS engine) gets `tags LIKE ?` instead of a MATCH against a missing
 * table.
 */
export type SearchPath = 'plain' | 'fts' | 'like';

export function selectTagFilter(
  tag: string | undefined,
  path: SearchPath,
  engineFts5Available: boolean,
): { condition: string; params: SqliteValue[] } | null {
  if (!tag) return null;
  if (path === 'like') {
    return buildTagFilterCondition(tag, { fts5Available: false });
  }
  if (path === 'fts') {
    return buildTagFilterCondition(tag, { fts5Available: engineFts5Available, idColumn: 'b.id' });
  }
  return buildTagFilterCondition(tag, { fts5Available: engineFts5Available });
}

/**
 * Back-compat alias: comma-split partial match on the raw tag text.
 * PBI 2026-09-12-40: the fallback read path uses `rowMatchesTagLike`
 * (SQL-parity; now imported from sqliteQueryBuilder's re-export). This function
 * remains for direct callers that explicitly want the legacy comma-split
 * semantics.
 */
export function tagMatchesFilter(tags: string | null | undefined, tagFilter: string): boolean {
  const tagsString = tags || '';
  if (typeof tagsString !== 'string') return false;
  return tagsString.split(',').some(tag => tag.trim().includes(tagFilter));
}

/**
 * Both-sided LIMIT clamp for the trust boundary.
 *
 * SQLite treats `LIMIT -1` as "unlimited", so an upper-bound-only `Math.min`
 * lets a negative or non-finite value materialize an entire table. Non-finite,
 * non-integer, or non-positive input falls back to the caller's documented
 * default rather than being coerced to 1, so `0.5` does not silently become a
 * 1-row query.
 */
export function clampLimit(raw: unknown, cap: number, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw) || raw <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(cap, Math.floor(raw)));
}

/**
 * Offset clamp next to clampLimit so the read policy owns both paging values.
 *
 * SQLite errors on a negative OFFSET while FallbackStorage's `slice(-n, …)`
 * counts from the end of the array — an unvalidated offset made the same
 * query return different rows per backend (PBI 2026-09-12-06). Non-integer,
 * non-finite, or negative input normalizes to 0; 0 is a legitimate value.
 */
export function clampOffset(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw) || raw < 0) {
    return 0;
  }
  return raw;
}

export interface QuerySpec {
  where: string;
  order: string;
  limit: number;
  offset: number;
  cap: typeof QUERY_CAPS;
  /**
   * Tag-filter condition for the plain listing path (PBI 2026-09-11 tag SQL
   * migration): unified partial-match semantics on every backend — trigram
   * MATCH (>= 3 chars, FTS5 available) or `tags LIKE '%term%'`. Null when the
   * query carries no tag (or the tag sanitizes to nothing usable).
   */
  tagFilter: { condition: string; params: SqliteValue[] } | null;
  bareText: string | null;
  params: SqliteValue[];
  useFts: boolean;
  /**
   * Search-vs-listing dispatch decision (PBI 2026-09-14-01), decided once by
   * `planQueryMode` and read by all three backends. Root cause of 4a1f6093 /
   * 43385d95 was each backend re-deriving `if (q.text)` independently.
   */
  mode: QueryMode;
  error?: string;
}

/**
 * Build a QuerySpec from a StorageQuery.
 * Pure function — fts5Available and caps are injected by the caller (Idb/OPFS/Fallback).
 */
export function buildQuerySpec(
  query: AlreadyCappedQuery,
  opts: { caps?: typeof QUERY_CAPS; fts5Available?: boolean } = {}
): QuerySpec {
  const caps = opts.caps ?? QUERY_CAPS;
  const fts5Available = opts.fts5Available ?? false;

  const { where, params: whereParams } = buildWhereClause(query);
  const mode = planQueryMode(query);
  const bareText = query.text ? sanitizeTextForFts5(query.text) : null;
  const useFts = bareText ? shouldUseFts5(fts5Available, bareText) : false;

  let orderResult: { orderClause: string; error?: string };
  if (useFts) {
    orderResult = buildFts5OrderClause(query);
  } else if (bareText) {
    orderResult = buildLikeOrderClause(query);
  } else {
    orderResult = buildOrderByClause(query);
  }
  const order = orderResult.orderClause;
  const orderError = orderResult.error;
  if (orderError) {
    return {
      where,
      order: 'ORDER BY created_at DESC',
      limit: 0,
      offset: 0,
      cap: caps,
      tagFilter: null,
      bareText,
      params: whereParams,
      useFts,
      mode,
      error: orderError,
    };
  }

  const cap = useFts ? caps.fts : caps.plain;
  const limit = clampLimit(query.limit, cap, DEFAULT_QUERY_LIMIT);
  const offset = clampOffset(query.offset ?? 0);

  // Tag filter condition (PBI 2026-09-11): partial-match semantics, built once
  // here so every backend reads the same condition set.
  const tagFilter = query.tag
    ? selectTagFilter(query.tag, 'plain', fts5Available)
    : null;

  return {
    where,
    order,
    limit,
    offset,
    cap: caps,
    tagFilter,
    bareText,
    params: whereParams,
    useFts,
    mode,
  };
}

// ---------------------------------------------------------------------------
// Compat facade (PBI 2026-11-07-07): statement assembly moved to
// sqliteQueryBuilder.ts. Every pre-split `queryPlan.js` import path keeps
// working through these re-exports — no caller changes. New code should
// import statement builders from sqliteQueryBuilder.js directly.
// Intentionally NOT re-exported: `rowMatchesTagLike` (use utils/tagLike.js)
// and the policy-owned `DELETED_CONDITION_SQL` spelling detail.
// ---------------------------------------------------------------------------

export {
  buildFilterConditions,
  qualifyCondition,
  matchesExtraWhere,
  buildFtsMatchQuery,
  buildLikePattern,
  buildSearchOrderClause,
  assembleSearchStatements,
  appendTag,
  withTagParams,
  buildFtsSearchStatements,
  buildLikeSearchStatements,
  buildPlainListStatements,
  buildUpdateSet,
  buildUpdateByIdStatements,
  buildPurgeOldRecordsStatements,
  buildAuditLogPurgeStatements,
  buildContentPurgeStatements,
  buildAuditLogStatements,
  buildAuditInsertParams,
  runPurgeSequence,
  purgeCutoffMs,
  contentPurgeStarredClause,
  FTS_SEARCH_SELECT_COLUMNS,
  LIKE_SEARCH_SELECT_COLUMNS,
  FTS_SEARCH_FROM,
  LIKE_SEARCH_FROM,
  PLAIN_LIST_COLUMNS,
  DELETE_BY_ID_SQL,
  TOGGLE_STAR_SQL,
  LIVE_COUNT_SQL,
  AUDIT_INSERT_SQL,
  AUDIT_INSERT_RETURNING_SQL,
} from './sqliteQueryBuilder.js';
export type {
  FilterCondition,
  InvalidOrderPolicy,
  SearchStatements,
  TagFilterCondition,
  UpdateUndefinedPolicy,
  UpdateSetParts,
  PurgeSequenceStatements,
  PurgeExecutor,
  PurgeCountPolicy,
  PurgeSequencePolicy,
} from './sqliteQueryBuilder.js';
