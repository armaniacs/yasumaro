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

export const QUERY_CAPS = {
  fts: 100000,
  plain: 1000,
} as const;

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

  const rawLimit = query.limit ?? 100;
  const cap = useFts ? caps.fts : caps.plain;
  const limit = Math.min(rawLimit, cap);
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
