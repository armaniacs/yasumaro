// src/offscreen/sqliteQueryBuilder.ts
// Shared SQL clause builders for StorageQuery — used by IdbVfsBackend,
// FallbackStorageAdapter, and any future backend that runs SQL locally.
//
// PBI 2026-11-07-07: this module is the statement-building home of the
// queryPlan split. It owns the shared filter vocabulary
// (buildFilterConditions — formerly in queryPlan.ts, the import that
// closed the queryPlan ⇄ queryBuilder cycle), every search/plain/CRUD/
// audit/purge statement builder, and compat re-exports for the two
// responsibilities that moved out (PBI 2026-11-07-12): the in-memory parity
// predicate (matchesExtraWhere → queryParityPredicate.ts) and the purge
// execution runner (runPurgeSequence → purgeRunner.ts).
// The policy layer (queryPlan.ts: mode/cap/brand/clamp/QuerySpec) depends
// on this module one-way; nothing here imports policy at runtime
// (type-only references to ExtraWhere/QuerySpec excepted).

import type { StorageQuery } from '../utils/sqlite-types.js';
import type { SqliteValue } from './sqliteEngine.js';
import type { ExtraWhere, QuerySpec } from './queryPlan.js';
import type { PurgeSequenceStatements } from './purgeRunner.js';
import { sanitizeFtsTerm, ALLOWED_ORDER_COLUMNS, FTS_QUERY_MAX_LENGTH, UPDATABLE_FIELDS } from './schema.js';
import { BROWSING_LOG_COLUMNS_SQL } from './rowCodec.js';

/** WHERE-prefix projection over the shared filter conditions. */
function buildWhereFromConditions(conditions: FilterCondition[]): { where: string; params: SqliteValue[] } {
  const fragments = conditions.map((c) => c.sql);
  const params = conditions.flatMap((c) => c.params);
  return { where: fragments.length > 0 ? `WHERE ${fragments.join(' AND ')}` : '', params };
}

const ALLOWED_ORDER_DIRECTIONS = ['ASC', 'DESC'] as const;

/**
 * Single owner of order-dir normalization: uppercases the requested direction
 * (defaulting to DESC) and validates it against ALLOWED_ORDER_DIRECTIONS, so
 * changing the allowed set never requires touching more than one place.
 */
function resolveOrderDir(q: StorageQuery): { dir: string; error?: undefined } | { dir?: undefined; error: string } {
  const dir = (q.orderDir || 'DESC').toUpperCase();
  if (!ALLOWED_ORDER_DIRECTIONS.includes(dir as typeof ALLOWED_ORDER_DIRECTIONS[number])) {
    return { error: `Invalid orderDir: ${dir}` };
  }
  return { dir };
}

/**
 * Build a WHERE clause + params array from a StorageQuery.
 * When `excludeDeleted` is not explicitly false, filters out soft-deleted rows.
 *
 * PBI 2026-09-12-35: this is a thin projection over the shared
 * `buildFilterConditions` vocabulary below — the vocabulary used to
 * be duplicated here, and the duplicate could not express multi-value params
 * (ids) as a vector, so search+ids bound a nested array as one value.
 * PBI 2026-11-07-07: the vocabulary moved here from queryPlan.ts, closing
 * the queryPlan ⇄ queryBuilder cycle (policy now depends on this module
 * one-way; this module imports no policy at runtime).
 */
export function buildWhereClause(q: StorageQuery): { where: string; params: SqliteValue[] } {
  const { where, params } = buildWhereFromConditions(buildFilterConditions(q));
  return { where, params };
}

/**
 * Build the tag-filter condition for the plain listing path (PBI 2026-09-11
 * PBI-15: unified partial-match semantics across all backends).
 *
 * Semantics match the former client-side filter (comma-split partial match on
 * the raw tag text):
 * - >= 3 chars AND FTS5 available: trigram MATCH on the FTS tags column with
 *   the phrase-quoted sanitized term. NO `#` prefix — trigram MATCH is a
 *   contiguous substring match, so `AI` matches inside `#AImaster` exactly
 *   like the old client-side `includes` did.
 * - otherwise (short tag, or no FTS table on this backend): `tags LIKE ?`
 *   with `%term%` (full scan; no index on tags). Wildcard semantics for
 *   `%`/`_` in the term are shared with the LIKE search path (documented).
 *
 * Returns null when the tag produces no usable condition (empty input).
 */
export function buildTagFilterCondition(
  tag: string,
  opts: { fts5Available: boolean; idColumn?: 'id' | 'b.id' },
): { condition: string; params: SqliteValue[] } | null {
  const limitedTag = tag.slice(0, FTS_QUERY_MAX_LENGTH);
  if (!limitedTag) return null;
  // PBI 2026-09-12-44: route the tag FTS branch through the shared
  // sanitizeFtsTerm (was an inline cleaner that only stripped operator chars
  // — diverging from the text-path sanitizer on `%`, `_`, and other
  // whitelist-external chars).
  const cleanTag = sanitizeFtsTerm(limitedTag);
  const charLen = [...cleanTag].length;
  if (opts.fts5Available && charLen >= 3) {
    // idColumn: the FTS search path reads from a JOIN (browsing_logs AS b),
    // so the outer id reference must be table-qualified there.
    return {
      condition: `${opts.idColumn ?? 'id'} IN (SELECT rowid FROM browsing_logs_fts WHERE tags MATCH ?)`,
      params: [`"${cleanTag}"`],
    };
  }
  return { condition: 'tags LIKE ?', params: [`%${limitedTag}%`] };
}

/** Condition shape shared by the plain-list and search tag filters. */
export type TagFilterCondition = { condition: string; params: SqliteValue[] };

/**
 * Column mapping for the unified ORDER BY builder: given the requested
 * orderBy (undefined when absent) and the already-validated dir, produce the
 * ORDER BY body (without the leading `ORDER BY` keyword, or the full clause
 * for the search paths whose bodies differ in shape).
 */
type OrderBodyMapper = (orderBy: string | undefined, dir: string) => string;

interface UnifiedOrderOptions {
  /**
   * When true, validate orderBy against ALLOWED_ORDER_COLUMNS (plus 'rank')
   * BEFORE resolving the direction, so an invalid column wins over an invalid
   * direction exactly as the former buildOrderByClause did. Search paths pass
   * false: any non-created_at orderBy maps to the relevance/default body and
   * only the direction can error.
   */
  validateOrderBy: boolean;
  mapBody: OrderBodyMapper;
}

/**
 * Single skeleton for the ORDER 3 brothers: column allow-list validation
 * (plain path only) → shared resolveOrderDir → caller-supplied column mapping.
 * The three public builders below differ ONLY in `validateOrderBy`/`mapBody`.
 */
function buildUnifiedOrderClause(
  q: StorageQuery,
  opts: UnifiedOrderOptions,
): { orderClause: string; error?: string } {
  if (opts.validateOrderBy) {
    const orderBy = q.orderBy || 'created_at';
    if (orderBy !== 'rank' && !ALLOWED_ORDER_COLUMNS.includes(orderBy as typeof ALLOWED_ORDER_COLUMNS[number])) {
      return { orderClause: '', error: `Invalid orderBy: ${orderBy}` };
    }
  }
  const resolved = resolveOrderDir(q);
  if (resolved.dir === undefined) return { orderClause: '', error: resolved.error };
  return { orderClause: opts.mapBody(q.orderBy, resolved.dir) };
}

/**
 * Validate and build an ORDER BY clause for plain (non-FTS) queries.
 * Returns an error string on invalid input, or the SQL clause on success.
 */
export function buildOrderByClause(
  q: StorageQuery
): { orderClause: string; error?: string } {
  return buildUnifiedOrderClause(q, {
    validateOrderBy: true,
    // 'rank' for plain queries has no meaning — fall back to created_at
    mapBody: (orderBy, dir) => {
      const requested = orderBy || 'created_at';
      const col = requested === 'rank' ? 'created_at' : requested;
      return `ORDER BY ${col} ${dir}`;
    },
  });
}

/**
 * Build the ORDER BY clause for FTS5 search results.
 */
export function buildFts5OrderClause(q: StorageQuery): { orderClause: string; error?: string } {
  return buildUnifiedOrderClause(q, {
    validateOrderBy: false,
    mapBody: (orderBy, dir) =>
      orderBy === 'created_at' ? `b.created_at ${dir}, b.id ${dir}` : 'rank',
  });
}

/**
 * Build the ORDER BY clause for LIKE fallback search.
 */
export function buildLikeOrderClause(q: StorageQuery): { orderClause: string; error?: string } {
  return buildUnifiedOrderClause(q, {
    validateOrderBy: false,
    // INTENTIONAL: only an explicit created_at honours the direction; every
    // other orderBy (including absent/rank) coerces to created_at DESC.
    mapBody: (orderBy, dir) =>
      orderBy === 'created_at' ? `created_at ${dir}` : 'created_at DESC',
  });
}

/**
 * Sanitize free-text input for use in FTS5 queries.
 * Returns the bare sanitized term; empty string means "no results".
 */
export function sanitizeTextForFts5(text: string): string {
  return sanitizeFtsTerm(text);
}

/**
 * Decide whether to use FTS5 or LIKE for a text search.
 * FTS5 requires the engine to have it enabled and the bare term to be >= 3 chars.
 */
export function shouldUseFts5(fts5Available: boolean, bareTerm: string): boolean {
  const charLen = [...bareTerm].length;
  return fts5Available && charLen >= 3;
}

// ---------------------------------------------------------------------------
// Shared filter vocabulary (moved from queryPlan.ts, PBI 2026-11-07-07).
//
// This was the import that closed the queryPlan ⇄ queryBuilder cycle:
// the builder projected over a vocabulary owned by the policy module while
// the policy module delegated statement assembly back to the builder.
// Owning it here makes the dependency one-way (policy -> builder).
// Behaviour is unchanged — queryPlan.ts re-exports every symbol so existing
// import paths keep working.
// ---------------------------------------------------------------------------

/**
 * PBI 2026-09-12-27/35: single structured condition set — the ONE spelling of
 * the shared filter vocabulary (dateFrom/dateTo/domain/starred/gistSynced/
 * ids/excludeDeleted). `buildWhereClause` (plain SQL, this module's adapter),
 * `buildExtraWhereSql` (search SQL, policy module) and `matchesExtraWhere`
 * (non-SQL parity, queryParityPredicate.ts) all derive from this list, so a
 * new filter is one row here instead of three synchronized edits.
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

/**
 * Single spelling of the soft-delete predicate (PBI 2026-10-16-04).
 * `buildFilterConditions` emits it; `buildExtraWhereSql` excludes it from the
 * search fragment (the FTS/LIKE builders own the per-path qualified copy).
 */
export const DELETED_CONDITION_SQL = 'is_deleted = 0';

export function buildFilterConditions(
  query: Pick<StorageQuery, 'dateFrom' | 'dateTo' | 'domain' | 'starred' | 'gistSynced' | 'ids' | 'excludeDeleted'>,
): FilterCondition[] {
  const conditions: FilterCondition[] = [];
  if (query.excludeDeleted !== false) {
    conditions.push({ sql: DELETED_CONDITION_SQL, params: [] });
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

// ---------------------------------------------------------------------------
// Non-SQL parity predicate — moved to queryParityPredicate.ts
// (PBI 2026-11-07-12). Compat re-export: pre-split import paths keep working.
// The policy module cannot host this: it needs `rowMatchesTagLike`, and the
// split requires the policy module to hold no tagLike runtime import.
// ---------------------------------------------------------------------------

export { matchesExtraWhere } from './queryParityPredicate.js';

// ---------------------------------------------------------------------------
// PBI-34: shared SQL assembly — WHERE/ORDER/LIMIT built in ONE place.
// (Moved from queryPlan.ts, PBI 2026-11-07-07; behaviour unchanged,
// queryPlan.ts keeps compat re-exports.)
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
 * (Moved from queryPlan.ts, PBI 2026-11-07-07 — thin-delegation wrapper
 * over the clause builders above, now next to them.)
 * Delegates to the clause functions above so the column mapping
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
 * Search-statement column lists (PBI 2026-10-14-04): the ONLY per-path
 * difference the FTS/LIKE skeleton parameterizes, kept next to the skeleton
 * so a new column is one edit here instead of two synchronized SELECTs.
 *
 * INTENTIONAL divergence preserved: FTS projects the `b.`-qualified 11
 * browsing_logs columns plus `rank AS rank` (12 items — the FTS5 relevance
 * score has no LIKE counterpart), LIKE projects the 11 unqualified columns.
 */
export const FTS_SEARCH_SELECT_COLUMNS =
  'b.id, b.url, b.title, b.summary, b.tags, b.created_at, b.domain, b.visit_duration, b.scroll_ratio, b.is_starred, b.fallback_reason, rank AS rank';

export const LIKE_SEARCH_SELECT_COLUMNS =
  'id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, fallback_reason';

/** FROM clause shared by the FTS COUNT and rows statements (JOIN path). */
export const FTS_SEARCH_FROM =
  'FROM browsing_logs_fts JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id';

/** FROM clause shared by the LIKE COUNT and rows statements (single table). */
export const LIKE_SEARCH_FROM = 'FROM browsing_logs';

/**
 * Single skeleton for the FTS/LIKE search-statement twins (PBI 2026-10-14-04).
 *
 * The twins shared everything except the SELECT column list, the FROM clause,
 * and the WHERE core (MATCH-? + qualified deleted filter vs LIKE-OR + plain
 * deleted filter): suffix assembly (appendTag), param assembly
 * (withTagParams), COUNT aliasing (`AS c` for the opfs named-row reader),
 * ORDER/LIMIT/OFFSET shape, and limit/offset bind order are identical and
 * now live here. Callers supply ONLY the parameterized parts:
 * `selectColumns` (FTS 12 incl. rank vs LIKE 11), `from`, the tag-unappended
 * `whereCore` + its `whereCoreParams` (lead binds + extraParams), and the
 * already-resolved `orderClause`.
 */
export function assembleSearchStatements(opts: {
  selectColumns: string;
  from: string;
  whereCore: string;
  whereCoreParams: SqliteValue[];
  tagFilter?: TagFilterCondition | null | undefined;
  orderClause: string;
  limit: number;
  offset: number;
}): SearchStatements {
  const conditions = appendTag(opts.whereCore, opts.tagFilter);
  const baseParams = withTagParams([...opts.whereCoreParams], opts.tagFilter);
  return {
    countSql: `SELECT COUNT(*) AS c ${opts.from} WHERE ${conditions}`,
    rowsSql:
      `SELECT ${opts.selectColumns} ${opts.from} ` +
      `WHERE ${conditions} ORDER BY ${opts.orderClause} LIMIT ? OFFSET ?`,
    countParams: baseParams,
    rowsParams: [...baseParams, opts.limit, opts.offset],
  };
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
  // PBI 2026-09-12-27 + PBI 2026-10-16-04: the deleted-row filter lives HERE
  // (deletedCond, not in `extra`) — buildExtraWhereSql excludes the shared
  // is_deleted condition from the search fragment, so this is the single
  // source. `excludeDeleted: false` drops it via includeDeletedFilter, like
  // fallback/InMemory.
  const deletedCond = extra.includeDeletedFilter ? ' AND b.is_deleted = 0' : '';
  return assembleSearchStatements({
    selectColumns: FTS_SEARCH_SELECT_COLUMNS,
    from: FTS_SEARCH_FROM,
    whereCore: `browsing_logs_fts MATCH ?${deletedCond}${extra.extraWhereSql}`,
    whereCoreParams: [opts.ftsQuery, ...extra.extraParams],
    tagFilter: opts.tagFilter,
    orderClause: opts.orderClause,
    limit: opts.limit,
    offset: opts.offset,
  });
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
  // PBI 2026-09-12-27 + PBI 2026-10-16-04: the deleted-row filter lives HERE
  // (baseConds, not in `extra`) — buildExtraWhereSql excludes the shared
  // is_deleted condition from the search fragment, so this is the single
  // source. `excludeDeleted: false` drops it via includeDeletedFilter, like
  // fallback/InMemory.
  const baseConds = extra.includeDeletedFilter
    ? 'is_deleted = 0 AND (url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?)'
    : '(url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?)';
  const likeParams: SqliteValue[] = [opts.likePattern, opts.likePattern, opts.likePattern, opts.likePattern];
  return assembleSearchStatements({
    selectColumns: LIKE_SEARCH_SELECT_COLUMNS,
    from: LIKE_SEARCH_FROM,
    whereCore: `${baseConds}${extra.extraWhereSql}`,
    whereCoreParams: [...likeParams, ...extra.extraParams],
    tagFilter: opts.tagFilter,
    orderClause: opts.orderClause,
    limit: opts.limit,
    offset: opts.offset,
  });
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
// statements in ONE place. (Moved from queryPlan.ts, PBI 2026-11-07-07.)
// IdbVfsBackend and the opfsWorker crud/audit handlers previously
// hand-copied these, and the two UPDATE field loops diverged on undefined
// values: idb wrote NULL for a key present with an undefined value while
// the worker skipped it — the same op produced different rows per backend.
// The builders here own the UPDATABLE_FIELDS loop and the statement text;
// backends supply only the policy and keep their own execution model.
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
 * Audit-log INSERT shared by idb/opfs. Minimal form (PBI 2026-10-23-01):
 * provider/url/created_at/char_count/policy — the trail is metadata and
 * never carries content or PII. char_count/policy are nullable so a caller
 * that cannot size the payload still records the send.
 */
export const AUDIT_INSERT_SQL =
  'INSERT INTO audit_log (provider, url, created_at, char_count, policy) VALUES (?, ?, ?, ?, ?)';

/**
 * Audit-log INSERT ... RETURNING for IdbVfsBackend.insertAuditLog: the id
 * comes back from the very statement that wrote the row, so the former
 * two-step `SELECT last_insert_rowid()` cannot interleave with a concurrent
 * insert and hand back the other row's id (PBI 2026-10-18-23). AUDIT_INSERT_SQL
 * stays RETURNING-free: the OPFS worker's audit handler still emits it, under
 * the worker's request queue.
 */
export const AUDIT_INSERT_RETURNING_SQL = `${AUDIT_INSERT_SQL} RETURNING id`;

/** Parameter array for AUDIT_INSERT_SQL, in column order (buildArchiveInsertParams convention). */
export function buildAuditInsertParams(record: {
  provider: string;
  url: string;
  created_at: number;
  char_count?: number | null;
  policy?: string | null;
}): SqliteValue[] {
  return [
    record.provider,
    record.url,
    record.created_at,
    record.char_count ?? null,
    record.policy ?? null,
  ];
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
// transaction skeleton in ONE place. (Moved from queryPlan.ts,
// PBI 2026-11-07-07.)
//
// Both backends (IdbVfsBackend and opfsWorker/purgeHandlers) run the identical
// sequence: delete-old (gated on retentionDays > 0) → SELECT changes() → COUNT
// → excess delete over maxRecords → SELECT changes(). It used to be four
// near-identical copies whose control flow could drift silently per lang; the
// statements build the SQL, and `runPurgeSequence` (purgeRunner.ts) owns the
// gates, the changes()-based counting rule and the transaction policy, so a
// fix lands once and both langs move together.
//
// The runner lives OUTSIDE this module (PBI 2026-11-07-12 — purgeRunner.ts,
// re-exported below for compat) because it executes against a live engine via
// `withTransaction`; the split requires the policy layer to hold no
// transaction import or execution, and this module keeps SQL assembly only.
// ---------------------------------------------------------------------------

export { purgeCutoffMs, runPurgeSequence } from './purgeRunner.js';
export type {
  PurgeSequenceStatements,
  PurgeExecutor,
  PurgeCountPolicy,
  PurgeSequencePolicy,
} from './purgeRunner.js';

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
    rowsSql: 'SELECT id, provider, url, created_at, char_count, policy FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?',
    rowsParams: [opts.limit, opts.offset],
    countSql: 'SELECT COUNT(*) AS c FROM audit_log',
  };
}
