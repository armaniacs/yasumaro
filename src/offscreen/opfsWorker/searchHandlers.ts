/**
 * searchHandlers.ts
 * Search operations: FTS5 trigram MATCH and LIKE fallback.
 *
 * SQL text and parameter order come from queryPlan.ts shared builders
 * (PBI-34); the count+rows execution skeleton lives in searchExecution.ts
 * (PBI 2026-09-21-23) — this module keeps only dispatch plus the legacy
 * coerce-to-DESC invalid-order policy (see buildSearchOrderClause).
 */

import type { SearchResult, StorageQuery } from '../../utils/sqlite-types.js';
import { sanitizeFtsTerm } from '../schema.js';
import { shouldUseFts5 } from '../sqliteQueryBuilder.js';
import type { SearchPayload } from './types.js';
import type { HandlerContext } from './handlers.js';
import {
  buildFtsMatchQuery,
  clampOffset,
} from '../queryPlan.js';
import { applySearchPolicy } from '../queryPlanner.js';
import { runOpfsSearch } from '../searchExecution.js';

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
    orderBy, orderDir, payload, fts5Available, onInvalid: 'coerce',
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
    orderBy, orderDir, payload, fts5Available, onInvalid: 'coerce',
  });
}
