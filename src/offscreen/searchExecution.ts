/**
 * searchExecution.ts
 * PBI 2026-09-21-23: single owner of the OPFS search execution skeleton.
 *
 * handleSearchFts / handleSearchLike were the same six steps with only the
 * statement builder and the tag-filter path ('fts' / 'like') differing, so a
 * params-order / tag+text / deleted-filter fix had to be applied twice.
 * This module owns the whole skeleton — extraWhere build, tag-filter select,
 * order-clause apply, statement build, count exec, rows exec, row mapping —
 * and callers pass only the path plus the invalid-order policy.
 *
 * SQL text assembly stays in queryPlan.ts (PBI-34 builders, read-only here).
 * IdbVfsBackend is intentionally NOT migrated: it reads positionally
 * (mapPositional over execWithCache) vs the worker's named rows (mapNamed
 * over sqlQuery), takes its order clause from QuerySpec (error policy) rather
 * than buildSearchOrderClause, and splits extra into qualified/unqualified
 * variants. Threading all three differences through one helper would make the
 * call sites harder to read than the current two explicit copies (S landing).
 */

import type { SearchResult } from '../utils/sqlite-types.js';
import {
  buildExtraWhereSql,
  buildLikePattern,
  buildSearchOrderClause,
  buildFtsSearchStatements,
  buildLikeSearchStatements,
  selectTagFilter,
} from './queryPlan.js';
import type { InvalidOrderPolicy } from './queryPlan.js';
import { SEARCH_COLUMNS_WITH_RANK, mapNamed } from './rowCodec.js';
import { sqlQuery, type HandlerContext } from './opfsWorker/handlers.js';
import type { SearchPayload } from './opfsWorker/types.js';

/** The two search paths — selects the statement builder + tag-filter path. */
export type SearchPath = 'fts' | 'like';

export interface RunOpfsSearchArgs {
  /** 'fts' -> buildFtsSearchStatements, 'like' -> buildLikeSearchStatements. */
  path: SearchPath;
  /**
   * FTS path: the already-built MATCH query (buildFtsMatchQuery output);
   * LIKE path: the raw term (buildLikePattern is applied inside).
   */
  searchInput: string;
  limit: number;
  offset: number;
  // Callers hold these as `T | undefined` (handler optional params) — the
  // explicit-undefined shape is part of the contract under
  // exactOptionalPropertyTypes.
  orderBy?: 'rank' | 'created_at' | undefined;
  orderDir?: 'ASC' | 'DESC' | undefined;
  payload?: SearchPayload;
  fts5Available?: boolean;
  /**
   * Invalid-order policy. OPFS callers use 'coerce' (legacy: normalize to
   * DESC); the parameter exists so the IDB 'error' divergence stays visible
   * if a future caller needs it — never silently unified.
   */
  onInvalid?: InvalidOrderPolicy;
}

export function pushSearchRow(rows: SearchResult[], row: Record<string, string | number | null>): void {
  rows.push(mapNamed<SearchResult>(row, SEARCH_COLUMNS_WITH_RANK));
}

export async function runOpfsSearch(
  ctx: HandlerContext,
  args: RunOpfsSearchArgs,
): Promise<{ rows: SearchResult[]; total: number }> {
  const { path, searchInput, limit, offset, orderBy, orderDir } = args;
  const payload = args.payload ?? {};
  const fts5Available = args.fts5Available ?? (path === 'fts');
  const onInvalid = args.onInvalid ?? 'coerce';

  const extra = buildExtraWhereSql(payload as unknown as Record<string, unknown>);
  // PBI 2026-09-11-06 (round 5): text+tag applies BOTH conditions — the tag
  // condition is the same partial-match semantics as the plain listing.
  const tagFilter = payload.tag
    ? selectTagFilter(payload.tag, path, fts5Available)
    : null;
  const isFts = path === 'fts';
  const { orderClause } = buildSearchOrderClause({ orderBy, orderDir }, { fts: isFts, onInvalid });
  const stmts = isFts
    ? buildFtsSearchStatements(extra, { ftsQuery: searchInput, orderClause, limit, offset, tagFilter })
    : buildLikeSearchStatements(extra, {
        likePattern: buildLikePattern(searchInput),
        orderClause,
        limit,
        offset,
        tagFilter,
      });

  let total = 0;
  await sqlQuery(ctx, stmts.countSql, stmts.countParams, (row) => { total = Number(row.c); });

  const rows: SearchResult[] = [];
  await sqlQuery(ctx, stmts.rowsSql, stmts.rowsParams, (row) => {
    pushSearchRow(rows, row as Record<string, string | number | null>);
  });

  return { rows, total };
}
