/**
 * queryPlan.ts
 * SSOT for query planning — unified for Idb/OPFS/Fallback.
 *
 * PBI-12: Phase 2 — QueryPlanner as pure function.
 * Grilling decision: Fallback を含めつつ QuerySpec 構造体で統一。
 * LIMIT は fts:100000 / plain:10000 の2種を cap として明示。定義本体は
 * messaging/limits.ts にあり、queryPlanner が cap 選択を所有する
 * (PBI 2026-09-12-16)。ここの clamp は worker 境界での防御的再適用。
 */

import { buildWhereClause, buildOrderByClause, buildFts5OrderClause, buildLikeOrderClause, buildTagFilterCondition, sanitizeTextForFts5, shouldUseFts5 } from './sqliteQueryBuilder.js';
import type { TagFilterCondition } from './sqliteQueryBuilder.js';
import { BROWSING_LOG_COLUMNS_SQL } from './rowCodec.js';
import type { StorageQuery } from '../utils/sqlite-types.js';
import type { SqliteValue } from './sqliteEngine.js';
import { QUERY_CAPS as QUERY_CAPS_SOURCE } from '../messaging/limits.js';

/**
 * Unified extra WHERE fragment for FTS/LIKE search paths.
 *
 * IdbVfsBackend, OpfsWorker/searchHandlers and any future SQL backend
 * previously re-implemented the same date/domain/starred/gist/ids filter.
 * This is the single source of truth — see `StorageBackend` Queryable split.
 */
export interface ExtraWhere {
  extraWhereSql: string;
  extraWhereSqlFts: string;
  extraParams: SqliteValue[];
  /** Whether the is_deleted filter rode on this WHERE (search builders drop their hardcoded base condition when false). */
  includeDeletedFilter: boolean;
}

/**
 * PBI 2026-09-12-27: single structured condition set — the ONE spelling of
 * the shared filter vocabulary (dateFrom/dateTo/domain/starred/gistSynced/
 * ids/excludeDeleted). `buildExtraWhereSql` (search SQL), `buildWhereClause`
 * (plain SQL) and `matchesExtraWhere` (non-SQL parity) all derive from this
 * list, so a new filter is one row here instead of three synchronized edits.
 *
 * `qualifier` prefixes column names for the FTS JOIN path (`b.`), replacing
 * the former regex string-rewrite of the assembled SQL (the most fragile
 * point: a new column that is a substring of an existing one silently
 * produced wrong SQL).
 */
export interface FilterCondition {
  sql: string;
  param?: SqliteValue;
}

export function buildFilterConditions(
  query: Pick<StorageQuery, 'dateFrom' | 'dateTo' | 'domain' | 'starred' | 'gistSynced' | 'ids' | 'excludeDeleted'>,
): FilterCondition[] {
  const conditions: FilterCondition[] = [];
  if (query.excludeDeleted !== false) {
    conditions.push({ sql: 'is_deleted = 0' });
  }
  if (query.dateFrom != null) conditions.push({ sql: 'created_at >= ?', param: query.dateFrom });
  if (query.dateTo != null) conditions.push({ sql: 'created_at <= ?', param: query.dateTo });
  if (query.domain) conditions.push({ sql: 'domain = ?', param: query.domain });
  if (query.starred != null) conditions.push({ sql: 'is_starred = ?', param: query.starred ? 1 : 0 });
  if (query.gistSynced != null) conditions.push({ sql: 'gist_synced = ?', param: query.gistSynced });
  if (query.ids != null && query.ids.length > 0) {
    conditions.push({ sql: `id IN (${query.ids.map(() => '?').join(',')})`, param: query.ids as unknown as SqliteValue });
  }
  return conditions;
}

/** Qualify column names in a condition for the FTS JOIN path (`b.` prefix). */
export function qualifyCondition(condition: FilterCondition, qualifier: string): FilterCondition {
  const qualified = condition.sql.replace(/\b(created_at|domain|is_starred|gist_synced|is_deleted)\b/g, `${qualifier}$&`)
    .replace(new RegExp(`\\b${qualifier}id\\b`, 'g'), `${qualifier}id`.replace(qualifier, qualifier))
    .replace(/\bid IN \(/g, `${qualifier}id IN (`);
  return { ...condition, sql: qualified };
}

export function buildExtraWhereSql(query: Pick<StorageQuery, 'dateFrom' | 'dateTo' | 'domain' | 'starred' | 'gistSynced' | 'ids' | 'excludeDeleted'>, options: { qualified?: boolean } = {}): ExtraWhere {
  const conditions = buildFilterConditions(query);
  const qualified = options.qualified === true;
  const projected = conditions
    .map((c) => (qualified ? qualifyCondition(c, 'b.') : c));
  const extraConds = projected.map((c) => c.sql);
  const extraParams = projected.map((c) => c.param).filter((p): p is SqliteValue => p !== undefined);
  const extraWhereSql = extraConds.length > 0 ? ` AND ${extraConds.join(' AND ')}` : '';
  const extraWhereSqlFts = extraWhereSql;
  // The is_deleted condition rode on this WHERE only when excludeDeleted was
  // not explicitly false — search builders read this flag instead of their
  // hardcoded base condition (PBI 2026-09-12-27).
  const includeDeletedFilter = query.excludeDeleted !== false;
  return { extraWhereSql, extraWhereSqlFts, extraParams, includeDeletedFilter };
}

/** @deprecated alias — use buildExtraWhereSql */
export const extraWhereSql = buildExtraWhereSql;

/**
 * Tag predicate shared by the non-SQL paths (matchesExtraWhere consumers and
 * FallbackStorage) — mirrors the SQL semantics of buildTagFilterCondition:
 * comma-split partial match on the raw tag text, exactly the former
 * client-side filterRowsByTag rule. Rows with unset/non-string tags never
 * match (existing rule).
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
  if (query.tag != null && query.tag !== '' && !tagMatchesFilter(record.tags, query.tag)) return false;
  return true;
}

/**
 * Re-exported for the OPFS worker boundary (PBI 2026-09-12-16): worker code
 * cannot import the messaging layer directly, so the single definition in
 * messaging/limits.ts is surfaced here. Do not re-declare the values here.
 */
export const QUERY_CAPS: typeof QUERY_CAPS_SOURCE = QUERY_CAPS_SOURCE;

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
  error?: string;
}

/**
 * Build a QuerySpec from a StorageQuery.
 * Pure function — fts5Available and caps are injected by the caller (Idb/OPFS/Fallback).
 */
export function buildQuerySpec(
  query: StorageQuery,
  opts: { caps?: typeof QUERY_CAPS; fts5Available?: boolean } = {}
): QuerySpec {
  const caps = opts.caps ?? QUERY_CAPS;
  const fts5Available = opts.fts5Available ?? false;

  const { where, params: whereParams } = buildWhereClause(query);
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
      error: orderError,
    };
  }

  const cap = useFts ? caps.fts : caps.plain;
  const limit = clampLimit(query.limit, cap, 100);
  const offset = clampOffset(query.offset ?? 0);

  // Tag filter condition (PBI 2026-09-11): partial-match semantics, built once
  // here so every backend reads the same condition set.
  const tagFilter = query.tag
    ? buildTagFilterCondition(query.tag, { fts5Available })
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
  const tagSql = opts.tagFilter ? ` AND ${opts.tagFilter.condition}` : '';
  const tagParams = opts.tagFilter ? opts.tagFilter.params : [];
  // PBI 2026-09-12-27: the deleted-row filter rides on `extra` (built from
  // the shared condition set) instead of a hardcoded `b.is_deleted = 0` —
  // `excludeDeleted: false` now reaches the FTS path like fallback/InMemory.
  const deletedCond = extra.includeDeletedFilter ? ' AND b.is_deleted = 0' : '';
  const countSql =
    'SELECT COUNT(*) AS c FROM browsing_logs_fts JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id ' +
    `WHERE browsing_logs_fts MATCH ?${deletedCond}${extra.extraWhereSqlFts}${tagSql}`;
  const rowsSql =
    'SELECT b.id, b.url, b.title, b.summary, b.tags, b.created_at, b.domain, b.visit_duration, b.scroll_ratio, b.is_starred, rank AS rank ' +
    'FROM browsing_logs_fts ' +
    'JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id ' +
    `WHERE browsing_logs_fts MATCH ?${deletedCond}${extra.extraWhereSqlFts}${tagSql} ` +
    `ORDER BY ${opts.orderClause} LIMIT ? OFFSET ?`;
  return {
    countSql,
    rowsSql,
    countParams: [opts.ftsQuery, ...extra.extraParams, ...tagParams],
    rowsParams: [opts.ftsQuery, ...extra.extraParams, ...tagParams, opts.limit, opts.offset],
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
  const tagSql = opts.tagFilter ? ` AND ${opts.tagFilter.condition}` : '';
  const tagParams = opts.tagFilter ? opts.tagFilter.params : [];
  const conditions = extra.extraWhereSql
    ? `${baseConds}${extra.extraWhereSql}${tagSql}`
    : `${baseConds}${tagSql}`;
  const likeParams: SqliteValue[] = [opts.likePattern, opts.likePattern, opts.likePattern, opts.likePattern];
  return {
    countSql: `SELECT COUNT(*) AS c FROM browsing_logs WHERE ${conditions}`,
    rowsSql:
      'SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred ' +
      `FROM browsing_logs WHERE ${conditions} ORDER BY ${opts.orderClause} LIMIT ? OFFSET ?`,
    countParams: [...likeParams, ...extra.extraParams, ...tagParams],
    rowsParams: [...likeParams, ...extra.extraParams, ...tagParams, opts.limit, opts.offset],
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
  const params: SqliteValue[] = [...spec.params];
  if (spec.tagFilter) {
    where = where ? `${where} AND ${spec.tagFilter.condition}` : `WHERE ${spec.tagFilter.condition}`;
    params.push(...spec.tagFilter.params);
  }
  return {
    countSql: `SELECT COUNT(*) AS c FROM browsing_logs ${where}`,
    rowsSql: `SELECT ${opts.columns} FROM browsing_logs ${where} ${spec.order} LIMIT ? OFFSET ?`,
    countParams: params,
    rowsParams: [...params, spec.limit, spec.offset],
  };
}

// ---------------------------------------------------------------------------
// Purge assembly — retention cutoff and DELETE/UPDATE conditions in ONE place.
// ---------------------------------------------------------------------------

/** Retention cutoff in epoch ms. `now` is injectable for tests. */
export function purgeCutoffMs(retentionDays: number, now: number = Date.now()): number {
  return now - retentionDays * 24 * 60 * 60 * 1000;
}

/** Age-based + cap-based hard-delete statements shared by idb/opfs purge. */
export function buildPurgeOldRecordsStatements(cutoffMs: number): {
  deleteOldSql: string;
  deleteOldParams: SqliteValue[];
  countSql: string;
  deleteExcessSql: string;
} {
  return {
    deleteOldSql: 'DELETE FROM browsing_logs WHERE created_at < ? AND is_starred = 0 AND is_deleted = 0',
    deleteOldParams: [cutoffMs],
    countSql: 'SELECT COUNT(*) AS c FROM browsing_logs WHERE is_deleted = 0',
    deleteExcessSql:
      'DELETE FROM browsing_logs WHERE id IN (' +
      'SELECT id FROM browsing_logs WHERE is_starred = 0 AND is_deleted = 0 ' +
      'ORDER BY created_at ASC LIMIT ?)',
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
 * NOTE on counting (preserved, not unified): the idb backend reports
 * `changes()` for the cap-based UPDATE while the opfs worker adds the
 * computed excess — both equal the affected-row count in the normal case.
 * FallbackStorage additionally differs in cap eviction: it can NULL the
 * content of starred rows when over maxRecords, while this SQL only touches
 * unstarred rows unless includeStarred is set (documented divergence).
 */
export function buildContentPurgeStatements(starredClause: string): {
  deleteOldSql: string;
  countSql: string;
  clearExcessSql: string;
} {
  return {
    deleteOldSql:
      'UPDATE browsing_logs SET content = NULL ' +
      `WHERE content IS NOT NULL AND created_at < ? ${starredClause}`,
    countSql: `SELECT COUNT(*) AS c FROM browsing_logs WHERE content IS NOT NULL ${starredClause}`,
    clearExcessSql:
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
