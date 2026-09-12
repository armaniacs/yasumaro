// src/offscreen/sqliteQueryBuilder.ts
// Shared SQL clause builders for StorageQuery — used by IdbVfsBackend,
// FallbackStorageAdapter, and any future backend that runs SQL locally.

import type { StorageQuery } from '../utils/sqlite-types.js';
import type { SqliteValue } from './sqliteEngine.js';
import { sanitizeFtsTerm, ALLOWED_ORDER_COLUMNS, FTS_QUERY_MAX_LENGTH } from './schema.js';
import { buildFilterConditions, type FilterCondition } from './queryPlan.js';

/** WHERE-prefix projection over the shared filter conditions. */
function buildWhereFromConditions(conditions: FilterCondition[]): { where: string; params: SqliteValue[] } {
  const fragments = conditions.map((c) => c.sql);
  const params = conditions.flatMap((c) => c.params);
  return { where: fragments.length > 0 ? `WHERE ${fragments.join(' AND ')}` : '', params };
}

const ALLOWED_ORDER_DIRECTIONS = ['ASC', 'DESC'] as const;

/**
 * Build a WHERE clause + params array from a StorageQuery.
 * When `excludeDeleted` is not explicitly false, filters out soft-deleted rows.
 *
 * PBI 2026-09-12-35: this is now a thin projection over the shared
 * `buildFilterConditions` vocabulary (queryPlan.ts) — the vocabulary used to
 * be duplicated here, and the duplicate could not express multi-value params
 * (ids) as a vector, so search+ids bound a nested array as one value.
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
 * Validate and build an ORDER BY clause for plain (non-FTS) queries.
 * Returns an error string on invalid input, or the SQL clause on success.
 */
export function buildOrderByClause(
  q: StorageQuery
): { orderClause: string; error?: string } {
  const orderBy = q.orderBy || 'created_at';
  if (orderBy !== 'rank' && !ALLOWED_ORDER_COLUMNS.includes(orderBy as typeof ALLOWED_ORDER_COLUMNS[number])) {
    return { orderClause: '', error: `Invalid orderBy: ${orderBy}` };
  }
  const dir = (q.orderDir || 'DESC').toUpperCase();
  if (!ALLOWED_ORDER_DIRECTIONS.includes(dir as typeof ALLOWED_ORDER_DIRECTIONS[number])) {
    return { orderClause: '', error: `Invalid orderDir: ${dir}` };
  }
  // 'rank' for plain queries has no meaning — fall back to created_at
  const col = orderBy === 'rank' ? 'created_at' : orderBy;
  return { orderClause: `ORDER BY ${col} ${dir}` };
}

/**
 * Build the ORDER BY clause for FTS5 search results.
 */
export function buildFts5OrderClause(q: StorageQuery): { orderClause: string; error?: string } {
  const dir = (q.orderDir || 'DESC').toUpperCase();
  if (!ALLOWED_ORDER_DIRECTIONS.includes(dir as typeof ALLOWED_ORDER_DIRECTIONS[number])) {
    return { orderClause: '', error: `Invalid orderDir: ${dir}` };
  }
  const orderClause = q.orderBy === 'created_at'
    ? `b.created_at ${dir}, b.id ${dir}`
    : 'rank';
  return { orderClause };
}

/**
 * Build the ORDER BY clause for LIKE fallback search.
 */
export function buildLikeOrderClause(q: StorageQuery): { orderClause: string; error?: string } {
  const dir = (q.orderDir || 'DESC').toUpperCase();
  if (!ALLOWED_ORDER_DIRECTIONS.includes(dir as typeof ALLOWED_ORDER_DIRECTIONS[number])) {
    return { orderClause: '', error: `Invalid orderDir: ${dir}` };
  }
  return { orderClause: q.orderBy === 'created_at' ? `created_at ${dir}` : `created_at DESC` };
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
