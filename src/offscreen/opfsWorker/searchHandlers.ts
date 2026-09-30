/**
 * searchHandlers.ts
 * Search operations: FTS5 trigram MATCH and LIKE fallback.
 *
 * SQL text and parameter order come from queryPlan.ts shared builders
 * (PBI-34); the count+rows execution skeleton lives in searchExecution.ts —
 * this module keeps only dispatch, the worker-side row reader (the engine
 * hands back named rows) and the legacy coerce-to-DESC invalid-order policy
 * (see buildSearchOrderClause).
 */

import type { SearchResult, StorageQuery } from '../../utils/sqlite-types.js';
import { sanitizeFtsTerm } from '../schema.js';
import { shouldUseFts5 } from '../sqliteQueryBuilder.js';
import type { SqliteRow } from '../sqliteEngine.js';
import type { SearchPayload } from './types.js';
import { sqlQuery, type HandlerContext } from './handlers.js';
import {
  buildFtsMatchQuery,
  clampOffset,
} from '../queryPlan.js';
import { applySearchPolicy } from '../queryPlanner.js';
import { SEARCH_COLUMNS_WITH_RANK, mapNamed } from '../rowCodec.js';
import { runSearch, type SearchInput, type SearchRowSource } from '../searchExecution.js';

/**
 * The worker's half of the shared skeleton: named rows, counted as `row.c`
 * (every COUNT in queryPlan.ts emits the alias), decoded by column name.
 * The FTS JOIN's filter columns stay unqualified here — the worker has always
 * emitted them that way and the statements are pinned byte-for-byte.
 */
function workerRowSource(ctx: HandlerContext): SearchRowSource<SqliteRow, SearchResult> {
  return {
    run: (sql, params, onRow) => sqlQuery(ctx, sql, params, onRow),
    count: (row) => Number(row.c),
    decode: (row) => mapNamed<SearchResult>(row, SEARCH_COLUMNS_WITH_RANK),
  };
}

export async function runOpfsSearch(
  ctx: HandlerContext,
  args: {
    input: SearchInput;
    limit: number;
    offset: number;
    orderBy?: 'rank' | 'created_at' | undefined;
    orderDir?: 'ASC' | 'DESC' | undefined;
    payload?: SearchPayload;
    fts5Available?: boolean;
  },
): Promise<{ rows: SearchResult[]; total: number }> {
  const path = args.input.path;
  return runSearch({
    reader: workerRowSource(ctx),
    input: args.input,
    query: args.payload ?? {},
    limit: args.limit,
    offset: args.offset,
    orderBy: args.orderBy,
    orderDir: args.orderDir,
    onInvalid: 'coerce',
    extraQualification: 'none',
    fts5Available: args.fts5Available ?? (path === 'fts'),
  });
}

export async function handleSearch(ctx: HandlerContext, payload: SearchPayload, fts5Available: boolean): Promise<{ rows: SearchResult[]; total: number }> {
  const { text: searchQuery = '', orderBy, orderDir } = payload;
  if (!searchQuery) return { rows: [], total: 0 };
  const bare = sanitizeFtsTerm(searchQuery);
  if (!bare) return { rows: [], total: 0 };

  // PBI 2026-09-12-16: the fts/plain cap choice lives in the planner seam
  // (was an inline ternary here). Paging defaults: PBI 2026-09-12-06.
  const { limit } = applySearchPolicy(payload as unknown as StorageQuery, fts5Available);
  const offset = clampOffset(payload.offset ?? 0);

  if (shouldUseFts5(fts5Available, bare)) {
    return handleSearchFts(ctx, buildFtsMatchQuery(bare), limit, offset, orderBy, orderDir, payload);
  }
  return handleSearchLike(ctx, searchQuery, limit, offset, orderBy, orderDir, payload);
}

export async function handleSearchFts(
  ctx: HandlerContext,
  sanitizedQuery: string, limit: number, offset: number,
  orderBy?: 'rank' | 'created_at', orderDir?: 'ASC' | 'DESC',
  payload: SearchPayload = {}, fts5Available = true
): Promise<{ rows: SearchResult[]; total: number }> {
  // 'coerce' preserves the legacy worker behaviour: out-of-whitelist
  // orderDir normalizes to DESC instead of failing (IdbVfsBackend fails
  // closed instead — intentional divergence, see queryPlan.ts).
  return runOpfsSearch(ctx, {
    input: { path: 'fts', ftsQuery: sanitizedQuery }, limit, offset,
    orderBy, orderDir, payload, fts5Available,
  });
}

export async function handleSearchLike(
  ctx: HandlerContext,
  rawQuery: string, limit: number, offset: number,
  orderBy?: 'rank' | 'created_at', orderDir?: 'ASC' | 'DESC',
  payload: SearchPayload = {}, fts5Available = false
): Promise<{ rows: SearchResult[]; total: number }> {
  return runOpfsSearch(ctx, {
    input: { path: 'like', rawTerm: rawQuery }, limit, offset,
    orderBy, orderDir, payload, fts5Available,
  });
}
