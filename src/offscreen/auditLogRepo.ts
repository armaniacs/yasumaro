/**
 * auditLogRepo.ts
 * Audit log for cloud AI provider send events (separate `audit_log` table —
 * unrelated to browsing-log record CRUD).
 * Split out of sqlite.ts (PBI: sqlite.ts deepening).
 *
 * All methods delegate to the active StorageBackend returned by engine.getBackend().
 */

import { engine } from './sqliteEngineContext.js';

import type { AuditLogRecord, AuditLogEntry } from '../utils/sqlite-types.js';

/**
 * Insert an audit log entry for cloud AI provider send events.
 */
export async function insertAuditLog(record: AuditLogRecord): Promise<{ success: true; id: number } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  return backend.insertAuditLog(record);
}

/**
 * Query audit log entries, most recent first by default.
 */
export async function queryAuditLog(options: { limit?: number; offset?: number } = {}): Promise<
  { success: true; rows: AuditLogEntry[]; total: number } | { success: false; error: string }
> {
  const backend = await engine.getBackend();
  return backend.queryAuditLog(options);
}
