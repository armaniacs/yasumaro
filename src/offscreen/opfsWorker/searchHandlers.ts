/**
 * searchHandlers.ts
 * Search operations: FTS5 trigram MATCH and LIKE fallback.
 *
 * SQL text and parameter order come from queryPlan.ts shared builders
 * (PBI-34); this module keeps only row mapping and the legacy
 * coerce-to-DESC invalid-order policy (see buildSearchOrderClause).
 */

import type { SearchResult } from '../../utils/sqlite-types.js';
import { sanitizeFtsTerm } from '../schema.js';
import { shouldUseFts5 } from '../sqliteQueryBuilder.js';
import type { SearchPayload } from './types.js';
import { sqlQuery, type HandlerContext } from './handlers.js';
import {
  buildExtraWhereSql,
  buildFtsMatchQuery,
  buildLikePattern,
  buildSearchOrderClause,
  buildFtsSearchStatements,
  buildLikeSearchStatements,
} from '../queryPlan.js';
import { SEARCH_COLUMNS_WITH_RANK, mapNamed } from '../rowCodec.js';

export async function handleSearch(ctx: HandlerContext, payload: SearchPayload, fts5Available: boolean): Promise<{ rows: SearchResult[]; total: number }> {
  const { text: searchQuery = '', limit = 50, offset = 0, orderBy, orderDir } = payload;
  if (!searchQuery) return { rows: [], total: 0 };
  const bare = sanitizeFtsTerm(searchQuery);
  if (!bare) return { rows: [], total: 0 };

  if (shouldUseFts5(fts5Available, bare)) {
    return handleSearchFts(ctx, buildFtsMatchQuery(bare), limit, offset, orderBy, orderDir, payload);
  }
  return handleSearchLike(ctx, searchQuery, limit, offset, orderBy, orderDir, payload);
}

function pushSearchRow(rows: SearchResult[], row: Record<string, string | number | null>): void {
  rows.push(mapNamed<SearchResult>(row, SEARCH_COLUMNS_WITH_RANK));
}

export async function handleSearchFts(
  ctx: HandlerContext,
  sanitizedQuery: string, limit: number, offset: number,
  orderBy?: 'rank' | 'created_at', orderDir?: 'ASC' | 'DESC',
  payload: SearchPayload = {}
): Promise<{ rows: SearchResult[]; total: number }> {
  const extra = buildExtraWhereSql(payload as unknown as Record<string, unknown>);
  // 'coerce' preserves the legacy worker behaviour: out-of-whitelist
  // orderDir normalizes to DESC instead of failing (IdbVfsBackend fails
  // closed instead — intentional divergence, see queryPlan.ts).
  const { orderClause } = buildSearchOrderClause({ orderBy, orderDir }, { fts: true, onInvalid: 'coerce' });
  const stmts = buildFtsSearchStatements(extra, { ftsQuery: sanitizedQuery, orderClause, limit, offset });

  let total = 0;
  await sqlQuery(ctx, stmts.countSql, stmts.countParams, (row) => { total = Number(row.c); });

  const rows: SearchResult[] = [];
  await sqlQuery(ctx, stmts.rowsSql, stmts.rowsParams, (row) => {
    pushSearchRow(rows, row as Record<string, string | number | null>);
  });

  return { rows, total };
}

export async function handleSearchLike(
  ctx: HandlerContext,
  rawQuery: string, limit: number, offset: number,
  orderBy?: 'rank' | 'created_at', orderDir?: 'ASC' | 'DESC',
  payload: SearchPayload = {}
): Promise<{ rows: SearchResult[]; total: number }> {
  const extra = buildExtraWhereSql(payload as unknown as Record<string, unknown>);
  const { orderClause } = buildSearchOrderClause({ orderBy, orderDir }, { fts: false, onInvalid: 'coerce' });
  const stmts = buildLikeSearchStatements(extra, {
    likePattern: buildLikePattern(rawQuery),
    orderClause,
    limit,
    offset,
  });

  let total = 0;
  await sqlQuery(ctx, stmts.countSql, stmts.countParams, (row) => { total = Number(row.c); });

  const rows: SearchResult[] = [];
  await sqlQuery(ctx, stmts.rowsSql, stmts.rowsParams, (row) => {
    pushSearchRow(rows, row as Record<string, string | number | null>);
  });

  return { rows, total };
}
