/**
 * auditHandlers.ts
 * Audit log operations.
 */

import { sqlExec, sqlQuery, type HandlerContext } from './handlers.js';
import { buildAuditLogStatements } from '../queryPlan.js';
import { planAuditLog } from '../queryPlanner.js';
import { AUDIT_CAP_OPFS } from '../../messaging/limits.js';
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
  // PBI 2026-09-12-17: paging policy lives in the planner seam — this
  // handler receives already-clamped values (was a hardcoded 1000 literal
  // with no offset policy; NaN/negative offsets reached the SQL bind).
  const { limit, offset } = planAuditLog(payload, AUDIT_CAP_OPFS);
  const stmts = buildAuditLogStatements({ limit, offset });

  const rows: Array<{ id: number; provider: string; url: string; created_at: number }> = [];
  await sqlQuery(
    ctx,
    stmts.rowsSql,
    [...stmts.rowsParams],
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
  await sqlQuery(ctx, stmts.countSql, [], (row) => { total = Number(row.c); });

  return { rows, total };
}
