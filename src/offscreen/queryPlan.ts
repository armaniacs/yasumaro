/**
 * queryPlan.ts
 * SSOT for query planning — unified for Idb/OPFS/Fallback.
 *
 * PBI-12: Phase 2 — QueryPlanner as pure function.
 * Grilling decision: Fallback を含めつつ QuerySpec 構造体で統一。
 * LIMIT は fts:100000 / plain:10000 の2種を cap として明示。定義本体は
 * utils/limits.ts にあり、queryPlanner が cap 選択を所有する。ここの clamp は worker 境界での防御的再適用。
 */

import { buildWhereClause, buildOrderByClause, buildFts5OrderClause, buildLikeOrderClause, buildTagFilterCondition, sanitizeTextForFts5, shouldUseFts5 } from './sqliteQueryBuilder.js';
import type { TagFilterCondition } from './sqliteQueryBuilder.js';
import { BROWSING_LOG_COLUMNS_SQL } from './rowCodec.js';
import type { StorageQuery } from '../utils/sqlite-types.js';
import type { SqliteValue } from './sqliteEngine.js';
import { QUERY_CAPS } from '../utils/limits.js';
import { UPDATABLE_FIELDS } from './schema.js';
import { withTransaction } from './sqliteTransaction.js';

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
 *  Produced only by applyReadPolicy / planQuery / planSearch / applySearchPolicy;
 *  buildQuerySpec accepts nothing else, so an uncapped query cannot reach SQL
 *  assembly without an explicit (documented) worker-boundary cast. */
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
  /** Whether the is_deleted filter rode on this WHERE (search builders drop their hardcoded base condition when false). */
  includeDeletedFilter: boolean;
}

/**
 * PBI 2026-09-12-27/35: single structured condition set — the ONE spelling of
 * the shared filter vocabulary (dateFrom/dateTo/domain/starred/gistSynced/
 * ids/excludeDeleted). `buildWhereClause` (plain SQL, sqliteQueryBuilder
 * adapter), `buildExtraWhereSql` (search SQL) and `matchesExtraWhere`
 * (non-SQL parity) all derive from this list, so a new filter is one row here
 * instead of three synchronized edits.
 *
 * `params` is ALWAYS a flat `SqliteValue[]` vector — the round-12 version
 * stored the whole `ids` array as one bind value, so search+ids bound a
 * nested array against `id IN (?,?)` on both SQL search paths.
 *
 * `qualifier` prefixes column names for the FTS JOIN path (`b.`), replacing
 * the former regex string-rewrite of the assembled SQL (the most fragile
 * point: a new column that is a substring of an existing one silently
 * produced wrong SQL).
 */
export interface FilterCondition {
  sql: string;
  params: SqliteValue[];
}

export function buildFilterConditions(
  query: Pick<StorageQuery, 'dateFrom' | 'dateTo' | 'domain' | 'starred' | 'gistSynced' | 'ids' | 'excludeDeleted'>,
): FilterCondition[] {
  const conditions: FilterCondition[] = [];
  if (query.excludeDeleted !== false) {
    conditions.push({ sql: 'is_deleted = 0', params: [] });
  }
  if (query.dateFrom != null) conditions.push({ sql: 'created_at >= ?', params: [query.dateFrom] });
  if (query.dateTo != null) conditions.push({ sql: 'created_at <= ?', params: [query.dateTo] });
  if (query.domain) conditions.push({ sql: 'domain = ?', params: [query.domain] });
  if (query.starred != null) conditions.push({ sql: 'is_starred = ?', params: [query.starred ? 1 : 0] });
  if (query.gistSynced != null) conditions.push({ sql: 'gist_synced = ?', params: [query.gistSynced] });
  if (query.ids != null && query.ids.length > 0) {
    conditions.push({ sql: `id IN (${query.ids.map(() => '?').join(',')})`, params: query.ids as unknown as SqliteValue[] });
  }
  return conditions;
}

/** Qualify column names in a condition for the FTS JOIN path (`b.` prefix). */
export function qualifyCondition(condition: FilterCondition, qualifier: string): FilterCondition {
  const qualified = condition.sql
    .replace(/\b(created_at|domain|is_starred|gist_synced|is_deleted)\b/g, `${qualifier}$&`)
    .replace(/\bid IN \(/g, `${qualifier}id IN (`);
  return { ...condition, sql: qualified };
}

/** The filter fields `buildExtraWhereSql` reads; everything else on a query is paging or text. */
export type ExtraWhereQuery = Pick<
  StorageQuery,
  'dateFrom' | 'dateTo' | 'domain' | 'starred' | 'gistSynced' | 'ids' | 'excludeDeleted'
>;

export function buildExtraWhereSql(query: ExtraWhereQuery, options: { qualified?: boolean } = {}): ExtraWhere {
  const conditions = buildFilterConditions(query);
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
 * Tag predicate shared by the non-SQL paths (matchesExtraWhere consumers and
 * FallbackStorage) — mirrors the SQL semantics of buildTagFilterCondition:
 * comma-split partial match on the raw tag text, exactly the former
 * client-side filterRowsByTag rule. Rows with unset/non-string tags never
 * match (existing rule).
 */
/**
 * Row-level tag predicate shared by the non-SQL paths (PBI 2026-09-12-40).
 *
 * Policy (decided once, here — was prose-only "mirrors the SQL" while the
 * JS matched case-sensitively and treated commas as separators, diverging
 * from SQL `tags LIKE ?` on six concrete inputs):
 * - CASE: case-insensitive substring match (SQL `LIKE` folds ASCII case).
 * - COMMA: the raw tag text (including commas) is matched against the raw
 *   tags column — commas are NOT treated as separators. The SQL side
 *   `tags LIKE '%a,b%'` matches the identical row.
 * - WILDCARD: `%` and `_` are treated as wildcards (SQL `LIKE` semantics),
 *   not literals.
 * Rows with unset/non-string tags never match (existing rule).
 */
export function rowMatchesTagLike(tags: string | null | undefined, tagFilter: string): boolean {
  const tagsString = tags || '';
  if (typeof tagsString !== 'string' || !tagFilter) return false;
  // SQL LIKE wildcards → regex, escaping the rest of the pattern.
  const escaped = tagFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = escaped.replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(pattern, 'i').test(tagsString);
}

/**
 * Back-compat alias: comma-split partial match on the raw tag text.
 * PBI 2026-09-12-40: the fallback read path now uses `rowMatchesTagLike`
 * (SQL-parity). This function remains for direct callers that explicitly
 * want the legacy comma-split semantics.
 */
export function tagMatchesFilter(tags: string | null | undefined, tagFilter: string): boolean {
  const tagsString = tags || '';
  if (typeof tagsString !== 'string') return false;
  return tagsString.split(',').some(tag => tag.trim().includes(tagFilter));
}

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

  let order: string;
  let orderError: string | undefined;
  if (useFts) {
    const r = buildFts5OrderClause(query);
    order = r.orderClause;
    orderError = r.error;
  } else if (bareText) {
    const r = buildLikeOrderClause(query);
    order = r.orderClause;
    orderError = r.error;
  } else {
    const r = buildOrderByClause(query);
    order = r.orderClause;
    orderError = r.error;
  }
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
  const limit = clampLimit(query.limit, cap, 100);
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
// PBI-34: shared SQL assembly — WHERE/ORDER/LIMIT built in ONE place.
//
// IdbVfsBackend (direct exec) and opfsWorker search/crud handlers previously
// assembled the same COUNT/rows statements independently; drift between the
// two copies changed search results per backend. These builders are the
// single source of truth for statement text and parameter order. Backends
// supply only policy (limit caps/defaults, invalid-order handling) and keep
// their intentionally different behaviour, documented below.
//
// Out of scope (preserved, NOT unified by PBI-34):
// - InMemoryTransport is test-only and soft-deletes (is_deleted = 1) while
//   every product backend hard-deletes. Unifying DELETE semantics would
//   corrupt test fixtures — do not touch.
// - FallbackStorage has no FTS5: rank is always 0 and search keeps insertion
//   order unless created_at is requested explicitly.
// ---------------------------------------------------------------------------

/**
 * Quote a sanitized bare term as an FTS5 phrase query.
 * Single place for the `"bare"` wrapping used by every FTS MATCH statement.
 */
export function buildFtsMatchQuery(bare: string): string {
  return `"${bare}"`;
}

/**
 * Build the LIKE pattern for fallback text search.
 *
 * INTENTIONAL: the raw query is interpolated without escaping, preserving
 * the long-standing SQLite LIKE semantics shared by the idb and opfs SQL
 * backends (`%`/`_` in user input act as wildcards there). The non-SQL
 * paths (FallbackStorage, InMemoryTransport) have no FTS/LIKE engine and use
 * case-insensitive substring/token matching instead — a documented
 * divergence covered by the parametric query-backends test, not something
 * this builder can or should hide.
 */
export function buildLikePattern(raw: string): string {
  return `%${raw}%`;
}

/**
 * Policy for out-of-whitelist orderDir on the search path.
 *
 * - 'error': fail closed (IdbVfsBackend.query returns success:false so
 *   untrusted input crossing chrome.runtime.sendMessage never reaches
 *   string interpolation).
 * - 'coerce': normalize to DESC (legacy opfsWorker search behaviour).
 *
 * INTENTIONAL divergence preserved by PBI-34: the idb query path uses
 * 'error', the opfs search path uses 'coerce'. See the parametric
 * query-backends test ('INTENTIONAL: invalid orderDir ...').
 */
export type InvalidOrderPolicy = 'error' | 'coerce';

/**
 * Unified ORDER BY mapping for text search (FTS and LIKE-fallback).
 * Delegates to the sqliteQueryBuilder clause functions so the column mapping
 * (`rank` default for FTS, `created_at` for LIKE) lives in exactly one place;
 * only the invalid-input policy differs per caller.
 */
export function buildSearchOrderClause(
  q: { orderBy?: string | undefined; orderDir?: string | undefined },
  opts: { fts: boolean; onInvalid?: InvalidOrderPolicy } = { fts: false }
): { orderClause: string; error?: string } {
  const build = opts.fts ? buildFts5OrderClause : buildLikeOrderClause;
  const first = build(q as StorageQuery);
  if (!first.error || (opts.onInvalid ?? 'error') === 'error') return first;
  return build({ ...q, orderDir: 'DESC' } as StorageQuery);
}

/** COUNT + rows statements with parameter arrays, in execution order. */
export interface SearchStatements {
  countSql: string;
  rowsSql: string;
  countParams: SqliteValue[];
  rowsParams: SqliteValue[];
}

/**
 * Single append point for the tag condition suffix.
 * Was copy-pasted ` AND ${condition}` in all 3 builders; param spreads were
 * hand-synced next to it (same shape as the round-12 nested `ids` bind bug).
 */
export function appendTag(baseSql: string, tagFilter: TagFilterCondition | null | undefined): string {
  return tagFilter ? `${baseSql} AND ${tagFilter.condition}` : baseSql;
}

/** Single append point for tag bind params — always trails `extraParams`. */
export function withTagParams(baseParams: SqliteValue[], tagFilter: TagFilterCondition | null | undefined): SqliteValue[] {
  return tagFilter ? [...baseParams, ...tagFilter.params] : baseParams;
}

/**
 * FTS5 search statements (browsing_logs_fts JOIN browsing_logs AS b).
 * `extra` comes from buildExtraWhereSql; `orderClause` from
 * buildSearchOrderClause({ fts: true }) or QuerySpec.order.
 * `tagFilter` (PBI 2026-09-11-06, round 5): the shared tag condition built
 * with buildTagFilterCondition({ idColumn: 'b.id' }) — text+tag applies BOTH
 * conditions on every SQL backend instead of silently dropping the tag.
 */
export function buildFtsSearchStatements(
  extra: ExtraWhere,
  opts: { ftsQuery: string; orderClause: string; limit: number; offset: number; tagFilter?: TagFilterCondition | null }
): SearchStatements {
  // `AS c` alias: required by the opfs named-row reader (row.c), ignored by
  // the idb positional reader (row[0]) — one text serves both (PBI-34).
  // rowCodec.test.ts pins this: every COUNT emits `AS c`, every FTS rows
  // query emits `rank AS rank`, so the codec mappers never read bare names.
  // PBI 2026-09-12-27: the deleted-row filter rides on `extra` (built from
  // the shared condition set) instead of a hardcoded `b.is_deleted = 0` —
  // `excludeDeleted: false` now reaches the FTS path like fallback/InMemory.
  const deletedCond = extra.includeDeletedFilter ? ' AND b.is_deleted = 0' : '';
  const suffix = appendTag(`${deletedCond}${extra.extraWhereSql}`, opts.tagFilter);
  const baseParams = withTagParams([opts.ftsQuery, ...extra.extraParams], opts.tagFilter);
  const countSql =
    'SELECT COUNT(*) AS c FROM browsing_logs_fts JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id ' +
    `WHERE browsing_logs_fts MATCH ?${suffix}`;
  const rowsSql =
    'SELECT b.id, b.url, b.title, b.summary, b.tags, b.created_at, b.domain, b.visit_duration, b.scroll_ratio, b.is_starred, b.fallback_reason, rank AS rank ' +
    'FROM browsing_logs_fts ' +
    'JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id ' +
    `WHERE browsing_logs_fts MATCH ?${suffix} ` +
    `ORDER BY ${opts.orderClause} LIMIT ? OFFSET ?`;
  return {
    countSql,
    rowsSql,
    countParams: baseParams,
    rowsParams: [...baseParams, opts.limit, opts.offset],
  };
}

/**
 * LIKE-fallback search statements (no FTS available or term too short).
 * `orderClause` comes from buildSearchOrderClause({ fts: false }).
 * `tagFilter` (PBI 2026-09-11-06): built with buildTagFilterCondition
 * ({ fts5Available: false }) so short/absent FTS still honours the tag.
 */
export function buildLikeSearchStatements(
  extra: ExtraWhere,
  opts: { likePattern: string; orderClause: string; limit: number; offset: number; tagFilter?: TagFilterCondition | null }
): SearchStatements {
  // PBI 2026-09-12-27: the deleted-row filter rides on `extra` (shared
  // condition set) instead of a hardcoded base — `excludeDeleted: false`
  // now reaches the LIKE path like fallback/InMemory.
  const baseConds = extra.includeDeletedFilter
    ? 'is_deleted = 0 AND (url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?)'
    : '(url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?)';
  const conditions = appendTag(`${baseConds}${extra.extraWhereSql}`, opts.tagFilter);
  const likeParams: SqliteValue[] = [opts.likePattern, opts.likePattern, opts.likePattern, opts.likePattern];
  const baseParams = withTagParams([...likeParams, ...extra.extraParams], opts.tagFilter);
  return {
    countSql: `SELECT COUNT(*) AS c FROM browsing_logs WHERE ${conditions}`,
    rowsSql:
      'SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, fallback_reason ' +
      `FROM browsing_logs WHERE ${conditions} ORDER BY ${opts.orderClause} LIMIT ? OFFSET ?`,
    countParams: baseParams,
    rowsParams: [...baseParams, opts.limit, opts.offset],
  };
}

/**
 * Plain filtered-listing statements. The tag filter rides on the spec
 * (QuerySpec.tagFilter — built by buildQuerySpec with the backend's
 * fts5Available), so every backend assembles the same condition set
 * (PBI 2026-09-11 tag SQL migration: the former "opfs honours tag, idb/fallback
 * ignore it" divergence is gone — all backends honour the tag).
 */
/** Canonical plain-list projection — owned by rowCodec; kept here so existing importers keep working. */
export const PLAIN_LIST_COLUMNS = BROWSING_LOG_COLUMNS_SQL;

export function buildPlainListStatements(
  spec: Pick<QuerySpec, 'where' | 'order' | 'limit' | 'offset' | 'params' | 'tagFilter'>,
  opts: { columns: string },
): SearchStatements {
  let where = spec.where;
  const params: SqliteValue[] = withTagParams([...spec.params], spec.tagFilter);
  if (spec.tagFilter) {
    where = where ? appendTag(where, spec.tagFilter) : `WHERE ${spec.tagFilter.condition}`;
  }
  return {
    countSql: `SELECT COUNT(*) AS c FROM browsing_logs ${where}`,
    rowsSql: `SELECT ${opts.columns} FROM browsing_logs ${where} ${spec.order} LIMIT ? OFFSET ?`,
    countParams: params,
    rowsParams: [...params, spec.limit, spec.offset],
  };
}

// ---------------------------------------------------------------------------
// CRUD assembly (PBI 2026-10-07-05) — update/delete/star/count/audit
// statements in ONE place. IdbVfsBackend and the opfsWorker crud/audit
// handlers previously hand-copied these, and the two UPDATE field loops
// diverged on undefined values: idb wrote NULL for a key present with an
// undefined value while the worker skipped it — the same op produced
// different rows per backend. The builders here own the UPDATABLE_FIELDS
// loop and the statement text; backends supply only the policy and keep
// their own execution model.
// ---------------------------------------------------------------------------

/** DELETE-by-id statement shared by idb/opfs hard delete. */
export const DELETE_BY_ID_SQL = 'DELETE FROM browsing_logs WHERE id = ?';

/** Star-toggle UPDATE shared by idb/opfs toggleStar. */
export const TOGGLE_STAR_SQL =
  'UPDATE browsing_logs SET is_starred = CASE WHEN is_starred = 0 THEN 1 ELSE 0 END WHERE id = ?';

/**
 * Live-row COUNT with the `AS c` alias: required by the opfs named-row reader
 * (row.c), ignored by the idb positional reader (row[0]) — one text serves
 * both (same rule as the COUNT in buildFtsSearchStatements).
 */
export const LIVE_COUNT_SQL = 'SELECT COUNT(*) AS c FROM browsing_logs WHERE is_deleted = 0';

/**
 * Audit-log INSERT shared by idb/opfs. provider/url/created_at only — the
 * trail is metadata and never carries content or PII.
 */
export const AUDIT_INSERT_SQL =
  'INSERT INTO audit_log (provider, url, created_at) VALUES (?, ?, ?)';

/** Parameter array for AUDIT_INSERT_SQL, in column order (buildArchiveInsertParams convention). */
export function buildAuditInsertParams(record: { provider: string; url: string; created_at: number }): SqliteValue[] {
  return [record.provider, record.url, record.created_at];
}

/**
 * Undefined-value policy for UPDATE SET assembly (PBI 2026-10-07-05).
 *
 * The two backends used to disagree here: idb treated a key present with an
 * undefined value as NULL (the divergence), the worker skipped it.
 * 'skip-undefined' is the unified policy — it matches the wire semantics,
 * where structured clone drops undefined properties, so the SET clause is
 * identical for a dropped key and a present-undefined key. 'write-null' is
 * kept as the named former idb behavior so the divergence fix stays
 * greppable and pinnable in tests.
 */
export type UpdateUndefinedPolicy = 'skip-undefined' | 'write-null';

/** The assembled SET clause (no WHERE) and its bind values, in field order. */
export interface UpdateSetParts {
  setSql: string;
  params: SqliteValue[];
}

/**
 * Single owner of the UPDATABLE_FIELDS loop: fields not in `changes` are
 * ignored (whitelist validation), and `policy` decides what a key present
 * with an undefined value does. Every update path must assemble its SET
 * clause through this builder — a hand-rolled loop reintroduces the
 * per-backend divergence this PBI closed.
 */
export function buildUpdateSet(changes: Record<string, unknown>, policy: UpdateUndefinedPolicy): UpdateSetParts {
  const clauses: string[] = [];
  const params: SqliteValue[] = [];
  for (const field of UPDATABLE_FIELDS) {
    if (!(field in changes)) continue;
    const val = changes[field];
    if (policy === 'skip-undefined' && val === undefined) continue;
    // `?? null` is load-bearing for the 'write-null' policy: an undefined
    // value must bind as NULL there, never as undefined.
    clauses.push(`${field} = ?`);
    params.push((val ?? null) as SqliteValue);
  }
  return { setSql: clauses.join(', '), params };
}

/** Full UPDATE-by-id statement, or null when nothing would be set (no-op). */
export function buildUpdateByIdStatements(
  id: number,
  changes: Record<string, unknown>,
  policy: UpdateUndefinedPolicy,
): { sql: string; params: SqliteValue[] } | null {
  const set = buildUpdateSet(changes, policy);
  if (!set.setSql) return null;
  return {
    sql: `UPDATE browsing_logs SET ${set.setSql} WHERE id = ?`,
    params: [...set.params, id],
  };
}

// ---------------------------------------------------------------------------
// Purge assembly — retention cutoff, DELETE/UPDATE conditions and the purge
// transaction skeleton in ONE place.
//
// Both backends (IdbVfsBackend and opfsWorker/purgeHandlers) run the identical
// sequence: delete-old (gated on retentionDays > 0) → SELECT changes() → COUNT
// → excess delete over maxRecords → SELECT changes(). It used to be four
// near-identical copies whose control flow could drift silently per lang; the
// statements build the SQL, and `runPurgeSequence` owns the gates, the
// changes()-based counting rule and the transaction policy, so a fix lands
// once and both langs move together.
// ---------------------------------------------------------------------------

/** Retention cutoff in epoch ms. `now` is injectable for tests. */
export function purgeCutoffMs(retentionDays: number, now: number = Date.now()): number {
  return now - retentionDays * 24 * 60 * 60 * 1000;
}

/**
 * The statements one purge sequence runs, in execution order. Both backends
 * construct these from the shared builders; the runner binds the values.
 */
export interface PurgeSequenceStatements {
  /** Deletes/clears rows older than the retention cutoff (one cutoff bind). */
  deleteOldSql: string;
  /** Reads the row count the cap gate compares against maxRecords. */
  countSql: string;
  /** Deletes/clears `count - maxRecords` rows, oldest first (one bind). */
  deleteExcessSql: string;
}

/**
 * Executor seam for `runPurgeSequence`: each backend binds its own engine, so
 * the sequence stays engine-agnostic. The two backends genuinely read scalars
 * differently (IDB positional callback vs the worker's named `row.c`), so the
 * seam — not the runner — owns that shape.
 * - `exec` runs a write (DELETE/UPDATE) with its binds.
 * - `count` runs a scalar COUNT and returns its single value.
 * - `changes` runs `SELECT changes()` (spelled per backend) after a write and
 *   returns the number of rows that write actually touched.
 */
export interface PurgeExecutor {
  exec(sql: string, params: SqliteValue[]): Promise<void>;
  count(sql: string, params: SqliteValue[]): Promise<number>;
  changes(): Promise<number>;
}

/**
 * The one documented difference between the two purge ops, made explicit.
 * 'always' (purgeOldRecords): the cap COUNT runs even when maxRecords is
 * absent. 'when-max-records' (content purge): the COUNT is skipped entirely
 * unless maxRecords > 0. Collapsing them would change the emitted sequence.
 */
export type PurgeCountPolicy = 'always' | 'when-max-records';

export interface PurgeSequencePolicy {
  retentionDays?: number | null | undefined;
  maxRecords?: number | null | undefined;
  countPolicy: PurgeCountPolicy;
}

/**
 * Run the shared purge sequence inside ONE `withTransaction` and return the
 * executed-row count. Policy, shared verbatim by both backends:
 *
 * - TRANSACTION: the whole sequence runs in one BEGIN IMMEDIATE … COMMIT.
 *   Every purge here reads between writes — `SELECT changes()` feeds the
 *   reported count, and the cap COUNT decides the next write's LIMIT. A
 *   recording landing between the two would otherwise report a count taken
 *   from one snapshot while deleting rows selected from another.
 * - SKIP GUARDS (PBI 2026-09-12-36): an absent or non-positive
 *   `retentionDays` / `maxRecords` skips that dimension entirely, so "no
 *   window" never degrades into "cutoff = now" (the old (0,0)
 *   deleted-everything divergence). `countPolicy` is the one intentional
 *   cross-op difference, preserved here rather than re-decided per backend.
 * - COUNTING: `purged` is the sum of `SELECT changes()` after each write. The
 *   computed excess is only what the cap statement was asked to touch, not
 *   what it touched, so reporting it would turn a disagreement between the
 *   count and the delete into a wrong number.
 */
export async function runPurgeSequence(
  executor: PurgeExecutor,
  stmts: PurgeSequenceStatements,
  policy: PurgeSequencePolicy,
): Promise<number> {
  const { retentionDays, maxRecords, countPolicy } = policy;
  let purged = 0;

  await withTransaction({ exec: (sql) => executor.exec(sql, []) }, async () => {
    if (retentionDays != null && retentionDays > 0) {
      await executor.exec(stmts.deleteOldSql, [purgeCutoffMs(retentionDays)]);
      purged += await executor.changes();
    }

    if (countPolicy === 'always' || (maxRecords != null && maxRecords > 0)) {
      const count = await executor.count(stmts.countSql, []);
      if (maxRecords != null && maxRecords > 0 && count > maxRecords) {
        await executor.exec(stmts.deleteExcessSql, [count - maxRecords]);
        purged += await executor.changes();
      }
    }
  });

  return purged;
}

/** Age-based + cap-based hard-delete statements shared by idb/opfs purge. */
export function buildPurgeOldRecordsStatements(): PurgeSequenceStatements {
  return {
    deleteOldSql: 'DELETE FROM browsing_logs WHERE created_at < ? AND is_starred = 0 AND is_deleted = 0',
    countSql: LIVE_COUNT_SQL,
    deleteExcessSql:
      'DELETE FROM browsing_logs WHERE id IN (' +
      'SELECT id FROM browsing_logs WHERE is_starred = 0 AND is_deleted = 0 ' +
      'ORDER BY created_at ASC LIMIT ?)',
  };
}

/**
 * Audit-log retention delete shared by the idb/opfs purge paths.
 *
 * Age is the only dimension: audit_log has no starred/deleted columns and no
 * cap, and the trail is metadata whose whole value is bounded by how long it
 * stays readable — so the cutoff rides the existing `created_at` index rather
 * than a per-row expiry column.
 */
export function buildAuditLogPurgeStatements(cutoffMs: number): {
  deleteOldSql: string;
  deleteOldParams: SqliteValue[];
} {
  return {
    deleteOldSql: 'DELETE FROM audit_log WHERE created_at < ?',
    deleteOldParams: [cutoffMs],
  };
}

/**
 * Starred-row guard for content purge (sets content NULL, keeps the row).
 * '' when includeStarred is truthy, otherwise excludes starred rows.
 */
export function contentPurgeStarredClause(includeStarred?: boolean | null): string {
  return includeStarred ? '' : 'AND is_starred = 0';
}

/**
 * Content-purge statements shared by idb/opfs implementations.
 *
 * FallbackStorage additionally differs in cap eviction: it can NULL the
 * content of starred rows when over maxRecords, while this SQL only touches
 * unstarred rows unless includeStarred is set (documented divergence). The
 * per-step counting rule lives in `runPurgeSequence`.
 */
export function buildContentPurgeStatements(starredClause: string): PurgeSequenceStatements {
  return {
    deleteOldSql:
      'UPDATE browsing_logs SET content = NULL ' +
      `WHERE content IS NOT NULL AND created_at < ? ${starredClause}`,
    countSql: `SELECT COUNT(*) AS c FROM browsing_logs WHERE content IS NOT NULL ${starredClause}`,
    deleteExcessSql:
      'UPDATE browsing_logs SET content = NULL WHERE id IN (' +
      'SELECT id FROM browsing_logs ' +
      `WHERE content IS NOT NULL ${starredClause} ORDER BY created_at ASC LIMIT ?)`,
  };
}

/**
 * Audit-log listing statements. Caps/defaults stay per caller (INTENTIONAL):
 * IdbVfsBackend allows up to 100000 rows, the opfs worker caps at 1000.
 */
export function buildAuditLogStatements(opts: { limit: number; offset: number }): {
  rowsSql: string;
  rowsParams: SqliteValue[];
  countSql: string;
} {
  return {
    rowsSql: 'SELECT id, provider, url, created_at FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?',
    rowsParams: [opts.limit, opts.offset],
    countSql: 'SELECT COUNT(*) AS c FROM audit_log',
  };
}
