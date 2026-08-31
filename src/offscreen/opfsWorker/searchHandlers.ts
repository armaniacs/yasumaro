/**
 * searchHandlers.ts
 * Search operations: FTS5 trigram MATCH and LIKE fallback.
 */

import type { SearchResult } from '../../utils/sqlite-types.js';
import { sanitizeFtsTerm } from '../schema.js';
import type { SearchPayload } from './types.js';
import { sqlQuery, type HandlerContext } from './handlers.js';
import { buildExtraWhereSql } from '../queryPlan.js';

export async function handleSearch(ctx: HandlerContext, payload: SearchPayload, fts5Available: boolean): Promise<{ rows: SearchResult[]; total: number }> {
  const { text: searchQuery = '', limit = 50, offset = 0, orderBy, orderDir } = payload;
  if (!searchQuery) return { rows: [], total: 0 };
  const bare = sanitizeFtsTerm(searchQuery);
  if (!bare) return { rows: [], total: 0 };

  const charLen = [...bare].length;
  if (fts5Available && charLen >= 3) {
    return handleSearchFts(ctx, `"${bare}"`, limit, offset, orderBy, orderDir, payload);
  }
  return handleSearchLike(ctx, searchQuery, limit, offset, orderBy, orderDir, payload);
}

function buildSearchExtra(payload: SearchPayload): { extraWhereSql: string; extraWhereSqlFts: string; extraParams: (string | number)[] } {
  const { extraWhereSql, extraWhereSqlFts, extraParams } = buildExtraWhereSql(payload as unknown as Record<string, unknown>);
  return { extraWhereSql, extraWhereSqlFts, extraParams: extraParams as (string | number)[] };
}

export async function handleSearchFts(
  ctx: HandlerContext,
  sanitizedQuery: string, limit: number, offset: number,
  orderBy?: 'rank' | 'created_at', orderDir?: 'ASC' | 'DESC',
  payload: SearchPayload = {}
): Promise<{ rows: SearchResult[]; total: number }> {
  const { extraWhereSqlFts, extraParams } = buildSearchExtra(payload);
  let total = 0;
  await sqlQuery(
    ctx,
    `SELECT COUNT(*) AS c FROM browsing_logs_fts
JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id
WHERE browsing_logs_fts MATCH ? AND b.is_deleted = 0${extraWhereSqlFts}`,
    [sanitizedQuery, ...extraParams],
    (row) => { total = Number(row.c); }
  );

  const dir = orderDir === 'ASC' ? 'ASC' : 'DESC';
  const orderClause = orderBy === 'created_at' ? `b.created_at ${dir}, b.id ${dir}` : 'rank';

  const rows: SearchResult[] = [];
  await sqlQuery(
    ctx,
    `SELECT b.id, b.url, b.title, b.summary, b.tags, b.created_at, b.domain, b.visit_duration, b.scroll_ratio, b.is_starred, rank AS rank
     FROM browsing_logs_fts
     JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id
     WHERE browsing_logs_fts MATCH ? AND b.is_deleted = 0${extraWhereSqlFts}
     ORDER BY ${orderClause} LIMIT ? OFFSET ?`,
    [sanitizedQuery, ...extraParams, limit, offset],
    (row) => {
      rows.push({
        id: Number(row.id),
        url: String(row.url),
        title: row.title as string | null,
        summary: row.summary as string | null,
        tags: row.tags as string | null,
        created_at: Number(row.created_at),
        domain: row.domain as string | null,
        visit_duration: row.visit_duration as number | null,
        scroll_ratio: row.scroll_ratio as number | null,
        is_starred: Number(row.is_starred),
        rank: Number(row.rank),
      });
    }
  );

  return { rows, total };
}

export async function handleSearchLike(
  ctx: HandlerContext,
  rawQuery: string, limit: number, offset: number,
  orderBy?: 'rank' | 'created_at', orderDir?: 'ASC' | 'DESC',
  payload: SearchPayload = {}
): Promise<{ rows: SearchResult[]; total: number }> {
  const like = `%${rawQuery}%`;
  const baseConds = 'is_deleted = 0 AND (url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?)';
  const baseParams: (string | number)[] = [like, like, like, like];
  const { extraWhereSql, extraParams } = buildSearchExtra(payload);
  const conditions = extraWhereSql ? `${baseConds}${extraWhereSql}` : baseConds;
  const params: (string | number)[] = [...baseParams, ...extraParams];

  let total = 0;
  await sqlQuery(
    ctx,
    `SELECT COUNT(*) AS c FROM browsing_logs WHERE ${conditions}`,
    params,
    (row) => { total = Number(row.c); }
  );

  const dir = orderBy === 'created_at' && orderDir === 'ASC' ? 'ASC' : 'DESC';

  const rows: SearchResult[] = [];
  await sqlQuery(
    ctx,
    `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred
     FROM browsing_logs WHERE ${conditions}
     ORDER BY created_at ${dir} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
    (row) => {
      rows.push({
        id: Number(row.id),
        url: String(row.url),
        title: row.title as string | null,
        summary: row.summary as string | null,
        tags: row.tags as string | null,
        created_at: Number(row.created_at),
        domain: row.domain as string | null,
        visit_duration: row.visit_duration as number | null,
        scroll_ratio: row.scroll_ratio as number | null,
        is_starred: Number(row.is_starred),
        rank: 0,
      });
    }
  );

  return { rows, total };
}
