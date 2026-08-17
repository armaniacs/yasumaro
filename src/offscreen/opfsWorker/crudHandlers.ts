/**
 * crudHandlers.ts
 * CRUD operations: insert, query, update, hard delete, toggle star, get count, insert batch.
 */

import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';
import type { StorageQuery } from '../../utils/sqlite-types.js';
import type { SqliteValue } from '../sqliteEngine.js';
import { INSERT_SQL, INSERT_IGNORE_SQL, buildInsertParams, UPDATABLE_FIELDS } from '../schema.js';
import { buildWhereClause, buildOrderByClause, buildFtsTagMatchCondition } from '../sqliteQueryBuilder.js';
import type { QueryPayload } from './types.js';
import { sqlExec, sqlQuery, type HandlerContext } from './handlers.js';
import { errorMessage } from '../../utils/errorUtils.js';

function extractDomain(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

export async function handleInsert(ctx: HandlerContext, record: BrowsingLogRecord): Promise<{ id: number }> {
  const domain = record.domain || extractDomain(record.url);
  await sqlExec(ctx, INSERT_SQL, buildInsertParams(record, domain));
  let id = 0;
  await sqlQuery(ctx, 'SELECT last_insert_rowid() AS id', [], (row) => { id = Number(row.id); });
  return { id };
}

export async function handleQuery(ctx: HandlerContext, payload: QueryPayload): Promise<{ rows: BrowsingLogRecord[]; total: number }> {
  const { limit = 20, offset = 0, tag } = payload;

  const { orderClause, error } = buildOrderByClause(payload as StorageQuery);
  if (error) {
    throw new Error(error);
  }

  const { where: baseWhere, params: baseParams } = buildWhereClause(payload as StorageQuery);
  let where = baseWhere;
  const params: SqliteValue[] = [...baseParams];

  if (tag) {
    const { condition, param } = buildFtsTagMatchCondition(tag);
    where = where ? `${where} AND ${condition}` : `WHERE ${condition}`;
    params.push(param);
  }

  let total = 0;
  await sqlQuery(ctx, `SELECT COUNT(*) AS c FROM browsing_logs ${where}`, params, (row) => { total = Number(row.c); });

  const rows: BrowsingLogRecord[] = [];
  await sqlQuery(
    ctx,
    `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted, obsidian_synced, gist_synced
     FROM browsing_logs ${where}
     ${orderClause} LIMIT ? OFFSET ?`,
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
        is_deleted: Number(row.is_deleted),
        obsidian_synced: Number(row.obsidian_synced),
        gist_synced: Number(row.gist_synced),
      });
    }
  );

  return { rows, total };
}

export async function handleUpdate(ctx: HandlerContext, payload: { id: number; changes: Record<string, SqliteValue> }): Promise<void> {
  const { id, changes } = payload;
  const sets: string[] = [];
  const vals: SqliteValue[] = [];

  // Whitelist validation — same as IdbVfsBackend.update() to prevent arbitrary field updates
  for (const field of UPDATABLE_FIELDS) {
    const val = changes[field];
    if (val !== undefined) {
      sets.push(`${field} = ?`);
      vals.push(val);
    }
  }

  if (sets.length === 0) return;
  vals.push(id);

  await sqlExec(
    ctx,
    `UPDATE browsing_logs SET ${sets.join(', ')} WHERE id = ?`,
    vals
  );
}

export async function handleHardDelete(ctx: HandlerContext, id: number): Promise<void> {
  await sqlExec(ctx, 'DELETE FROM browsing_logs WHERE id = ?', [id]);
}

export async function handleToggleStar(ctx: HandlerContext, id: number): Promise<{ is_starred: number }> {
  await sqlExec(
    ctx,
    'UPDATE browsing_logs SET is_starred = CASE WHEN is_starred = 0 THEN 1 ELSE 0 END WHERE id = ?',
    [id]
  );
  let isStarred = 0;
  await sqlQuery(ctx, 'SELECT is_starred AS is_starred FROM browsing_logs WHERE id = ?', [id], (row) => { isStarred = Number(row.is_starred); });
  return { is_starred: isStarred };
}

export async function handleGetCount(ctx: HandlerContext): Promise<number> {
  let count = 0;
  await sqlQuery(ctx, 'SELECT COUNT(*) AS c FROM browsing_logs WHERE is_deleted = 0', [], (row) => { count = Number(row.c); });
  return count;
}

export async function handleInsertBatch(
  ctx: HandlerContext,
  records: BrowsingLogRecord[],
  postLog: (level: 'warn' | 'error' | 'info', message: string, details?: Record<string, unknown>) => void,
  ensureEngine: () => Promise<void>,
): Promise<{ count: number }> {
  await ensureEngine();
  let inserted = 0;
  try {
    await sqlExec(ctx, 'BEGIN IMMEDIATE');
    for (const record of records) {
      try {
        const domain = record.domain || extractDomain(record.url);
        await sqlExec(ctx, INSERT_IGNORE_SQL, buildInsertParams(record, domain));
      } catch (err) {
        if (inserted === 0 && records.indexOf(record) === 0) {
          postLog('error', 'OPFS Worker: first INSERT failed', { error: errorMessage(err), url: record.url });
        }
      }
    }
    await sqlExec(ctx, 'COMMIT');
    await sqlQuery(ctx, 'SELECT changes() AS c', [], (row) => {
      inserted = Number(row.c);
    });
  } catch (err) {
    await sqlExec(ctx, 'ROLLBACK');
    postLog('error', 'OPFS Worker: insertBatch transaction failed', { error: errorMessage(err) });
  }
  return { count: inserted };
}
