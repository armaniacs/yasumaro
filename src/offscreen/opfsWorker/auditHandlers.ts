/**
 * auditHandlers.ts
 * Audit log operations.
 */

import { sqlExec, sqlQuery, type HandlerContext } from './handlers.js';
import { AUDIT_INSERT_SQL, buildAuditInsertParams, buildAuditLogStatements } from '../queryPlan.js';
import { planAuditLog } from '../queryPlanner.js';
import { AUDIT_CAP_OPFS } from '../../utils/limits.js';
import { AUDIT_LOG_COLUMNS, mapNamed } from '../rowCodec.js';
import type { AuditLogEntry } from '../../utils/sqlite-types.js';
import type { AuditLogQueryPayload } from './types.js';

export async function handleAuditLogInsert(
  ctx: HandlerContext,
  record: { provider: string; url: string; created_at: number },
): Promise<{ id: number }> {
  await sqlExec(ctx, AUDIT_INSERT_SQL, buildAuditInsertParams(record));
  let id = 0;
  await sqlQuery(ctx, 'SELECT last_insert_rowid() AS id', [], (row) => { id = Number(row.id); });
  return { id };
}

export async function handleAuditLogQuery(
  ctx: HandlerContext,
  payload: AuditLogQueryPayload,
): Promise<{ rows: AuditLogEntry[]; total: number }> {
  // PBI 2026-09-12-17: paging policy lives in the planner seam — this
  // handler receives already-clamped values (was a hardcoded 1000 literal
  // with no offset policy; NaN/negative offsets reached the SQL bind).
  const { limit, offset } = planAuditLog(payload, AUDIT_CAP_OPFS);
  const stmts = buildAuditLogStatements({ limit, offset });

  const rows: AuditLogEntry[] = [];
  await sqlQuery(
    ctx,
    stmts.rowsSql,
    [...stmts.rowsParams],
    (row) => {
      rows.push(mapNamed<AuditLogEntry>(row, AUDIT_LOG_COLUMNS));
    },
  );

  let total = 0;
  await sqlQuery(ctx, stmts.countSql, [], (row) => { total = Number(row.c); });

  return { rows, total };
}
