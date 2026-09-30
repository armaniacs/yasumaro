/**
 * auditLogRepo.ts
 * Audit log for cloud AI provider send events (separate `audit_log` table —
 * unrelated to browsing-log record CRUD).
 * Split out of sqlite.ts (PBI: sqlite.ts deepening).
 *
 * All methods delegate to the active StorageBackend returned by engine.getBackend().
 */

import { engine } from './sqliteEngineHost.js';

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

/**
 * Delete audit log entries older than the retention window.
 *
 * The trail records outbound cloud AI sends, so it is deleted on a timer
 * rather than only on the user's explicit clear-all: an unbounded record of
 * every URL sent to a provider is exactly what the privacy promise forbids.
 */
export async function purgeAuditLog(retentionDays?: number): Promise<{ success: true; purged: number } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  return backend.purgeAuditLog(retentionDays);
}
