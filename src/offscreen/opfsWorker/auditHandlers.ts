/**
 * auditHandlers.ts
 * Audit log operations.
 */

import { sqlExec, sqlQuery, type HandlerContext } from './handlers.js';
import { clampLimit } from '../queryPlan.js';
import type { AuditLogQueryPayload } from './types.js';

export async function handleAuditLogInsert(
  ctx: HandlerContext,
  record: { provider: string; url: string; created_at: number },
): Promise<{ id: number }> {
  await sqlExec(
    ctx,
    'INSERT INTO audit_log (provider, url, created_at) VALUES (?, ?, ?)',
    [record.provider, record.url, record.created_at],
  );
  let id = 0;
  await sqlQuery(ctx, 'SELECT last_insert_rowid() AS id', [], (row) => { id = Number(row.id); });
  return { id };
}

export async function handleAuditLogQuery(
  ctx: HandlerContext,
  payload: AuditLogQueryPayload,
): Promise<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number }> {
  const limit = clampLimit(payload.limit, 1000, 100);
  const offset = payload.offset ?? 0;

  const rows: Array<{ id: number; provider: string; url: string; created_at: number }> = [];
  await sqlQuery(
    ctx,
    'SELECT id, provider, url, created_at FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [limit, offset],
    (row) => {
      rows.push({
        id: Number(row.id),
        provider: String(row.provider),
        url: String(row.url),
        created_at: Number(row.created_at),
      });
    },
  );

  let total = 0;
  await sqlQuery(ctx, 'SELECT COUNT(*) AS c FROM audit_log', [], (row) => { total = Number(row.c); });

  return { rows, total };
}
