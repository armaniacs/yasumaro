/**
 * queryPlan.ts
 * SSOT for query planning — unified for Idb/OPFS/Fallback.
 *
 * PBI-12: Phase 2 — QueryPlanner as pure function.
 * Grilling decision: Fallback を含めつつ QuerySpec 構造体で統一。
 * LIMIT は fts:100000 / plain:1000 の2種を cap として明示。
 */

import { buildWhereClause, buildOrderByClause, buildFts5OrderClause, buildLikeOrderClause, sanitizeTextForFts5, shouldUseFts5 } from './sqliteQueryBuilder.js';
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
