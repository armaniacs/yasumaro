/**
 * queryPlan.ts
 * SSOT for query planning — unified for Idb/OPFS/Fallback.
 *
 * PBI-12: Phase 2 — QueryPlanner as pure function.
 * Grilling decision: Fallback を含めつつ QuerySpec 構造体で統一。
 * LIMIT は fts:100000 / plain:1000 の2種を cap として明示。
 */

import { buildWhereClause, buildOrderByClause, buildFts5OrderClause, buildLikeOrderClause, buildFtsTagMatchCondition, sanitizeTextForFts5, shouldUseFts5 } from './sqliteQueryBuilder.js';
import { sanitizeFtsTerm } from './schema.js';
import type { StorageQuery } from '../utils/sqlite-types.js';
import type { SqliteValue } from './sqliteEngine.js';

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
}

export function buildExtraWhereSql(query: Pick<StorageQuery, 'dateFrom' | 'dateTo' | 'domain' | 'starred' | 'gistSynced' | 'ids'>): ExtraWhere {
  const extraConds: string[] = [];
  const extraParams: SqliteValue[] = [];
  if ((query as StorageQuery).dateFrom != null) { extraConds.push('created_at >= ?'); extraParams.push((query as StorageQuery).dateFrom as number); }
  if ((query as StorageQuery).dateTo != null) { extraConds.push('created_at <= ?'); extraParams.push((query as StorageQuery).dateTo as number); }
  if ((query as StorageQuery).domain) { extraConds.push('domain = ?'); extraParams.push((query as StorageQuery).domain as string); }
  if ((query as StorageQuery).starred != null) { extraConds.push('is_starred = ?'); extraParams.push(((query as StorageQuery).starred ? 1 : 0) as unknown as SqliteValue); }
  if ((query as StorageQuery).gistSynced != null) { extraConds.push('gist_synced = ?'); extraParams.push((query as StorageQuery).gistSynced as unknown as SqliteValue); }
  if ((query as StorageQuery).ids != null && (query as StorageQuery).ids!.length > 0) {
    extraConds.push(`id IN (${(query as StorageQuery).ids!.map(() => '?').join(',')})`);
    extraParams.push(...((query as StorageQuery).ids as unknown as SqliteValue[]));
  }
  const extraWhereSql = extraConds.length > 0 ? ` AND ${extraConds.join(' AND ')}` : '';
  const extraWhereSqlFts = extraWhereSql
    .replace(/domain = \?/g, 'b.domain = ?')
    .replace(/created_at/g, 'b.created_at')
    .replace(/is_starred/g, 'b.is_starred')
    .replace(/gist_synced/g, 'b.gist_synced')
    .replace(/\bid\b/g, 'b.id');
  return { extraWhereSql, extraWhereSqlFts, extraParams };
}

/** @deprecated alias — use buildExtraWhereSql */
export const extraWhereSql = buildExtraWhereSql;

/**
 * Shared in-memory predicate mirroring buildExtraWhereSql's semantics.
 * Lets InMemoryTransport filter without reimplementing the condition set —
 * both the SQL generator and the JS fallback read from the same source.
 */
export function matchesExtraWhere(
  record: { domain?: string | null; is_starred?: number; gist_synced?: number | null; created_at: number; id?: number },
  query: Pick<StorageQuery, 'dateFrom' | 'dateTo' | 'domain' | 'starred' | 'gistSynced' | 'ids'>
): boolean {
  if (query.domain != null && query.domain !== '' && record.domain !== query.domain) return false;
  if (query.starred != null && Boolean(record.is_starred) !== query.starred) return false;
  if (query.gistSynced != null && (record.gist_synced ?? 0) !== query.gistSynced) return false;
  if (query.dateFrom != null && record.created_at < (query as StorageQuery).dateFrom!) return false;
  if (query.dateTo != null && record.created_at > (query as StorageQuery).dateTo!) return false;
  if (query.ids != null && query.ids.length > 0) {
    if (record.id == null || !query.ids.includes(record.id)) return false;
  }
  return true;
}

export const QUERY_CAPS = {
  fts: 100000,
  plain: 1000,
} as const;

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

export interface QuerySpec {
  where: string;
  order: string;
  limit: number;
  offset: number;
  cap: typeof QUERY_CAPS;
  ftsTag: string | null;
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
      ftsTag: null,
      bareText,
      params: whereParams,
      useFts,
      error: orderError,
    };
  }

  const cap = useFts ? caps.fts : caps.plain;
  const limit = clampLimit(query.limit, cap, 100);
  const offset = query.offset ?? 0;

  // FTS tag handling
  let ftsTag: string | null = null;
  if (query.tag) {
    const sanitizedTag = sanitizeFtsTerm(query.tag.slice(0, 200));
    if (sanitizedTag) {
      ftsTag = `#${sanitizedTag}`;
    }
  }

  return {
    where,
    order,
    limit,
    offset,
    cap: caps,
    ftsTag,
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
 */
export function buildFtsSearchStatements(
  extra: ExtraWhere,
  opts: { ftsQuery: string; orderClause: string; limit: number; offset: number }
): SearchStatements {
  // `AS c` alias: required by the opfs named-row reader (row.c), ignored by
  // the idb positional reader (row[0]) — one text serves both (PBI-34).
  const countSql =
    'SELECT COUNT(*) AS c FROM browsing_logs_fts JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id ' +
    `WHERE browsing_logs_fts MATCH ? AND b.is_deleted = 0${extra.extraWhereSqlFts}`;
  const rowsSql =
    'SELECT b.id, b.url, b.title, b.summary, b.tags, b.created_at, b.domain, b.visit_duration, b.scroll_ratio, b.is_starred, rank AS rank ' +
    'FROM browsing_logs_fts ' +
    'JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id ' +
    `WHERE browsing_logs_fts MATCH ? AND b.is_deleted = 0${extra.extraWhereSqlFts} ` +
    `ORDER BY ${opts.orderClause} LIMIT ? OFFSET ?`;
  return {
    countSql,
    rowsSql,
    countParams: [opts.ftsQuery, ...extra.extraParams],
    rowsParams: [opts.ftsQuery, ...extra.extraParams, opts.limit, opts.offset],
  };
}

/**
 * LIKE-fallback search statements (no FTS available or term too short).
 * `orderClause` comes from buildSearchOrderClause({ fts: false }).
 */
export function buildLikeSearchStatements(
  extra: ExtraWhere,
  opts: { likePattern: string; orderClause: string; limit: number; offset: number }
): SearchStatements {
  const likeConds = 'is_deleted = 0 AND (url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?)';
  const conditions = extra.extraWhereSql ? `${likeConds}${extra.extraWhereSql}` : likeConds;
  const likeParams: SqliteValue[] = [opts.likePattern, opts.likePattern, opts.likePattern, opts.likePattern];
  return {
    countSql: `SELECT COUNT(*) AS c FROM browsing_logs WHERE ${conditions}`,
    rowsSql:
      'SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred ' +
      `FROM browsing_logs WHERE ${conditions} ORDER BY ${opts.orderClause} LIMIT ? OFFSET ?`,
    countParams: [...likeParams, ...extra.extraParams],
    rowsParams: [...likeParams, ...extra.extraParams, opts.limit, opts.offset],
  };
}

/**
 * Plain filtered-listing statements. The optional `#tag` filter is appended
 * via buildFtsTagMatchCondition; callers pass null to skip it.
 *
 * INTENTIONAL divergence preserved by PBI-34: opfs QUERY honours the tag
 * filter, IdbVfsBackend.query ignores it (passes null), and the fallback /
 * in-memory paths ignore it as well. Unifying that would change idb query
 * results, so the gap stays explicit at the call site instead.
 */
export const PLAIN_LIST_COLUMNS =
  'id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted, obsidian_synced, gist_synced';

export function buildPlainListStatements(
  spec: Pick<QuerySpec, 'where' | 'order' | 'limit' | 'offset' | 'params'>,
  opts: { tag?: string | null; columns?: string } = {}
): SearchStatements {
  let where = spec.where;
  const params: SqliteValue[] = [...spec.params];
  if (opts.tag) {
    const { condition, param } = buildFtsTagMatchCondition(opts.tag);
    where = where ? `${where} AND ${condition}` : `WHERE ${condition}`;
    params.push(param);
  }
  return {
    countSql: `SELECT COUNT(*) AS c FROM browsing_logs ${where}`,
    rowsSql: `SELECT ${opts.columns ?? '*'} FROM browsing_logs ${where} ${spec.order} LIMIT ? OFFSET ?`,
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
