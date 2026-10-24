/**
 * recordsRepo.ts
 * Single SQLite secondary-store module for the offscreen document.
 *
 * Owns every operation callers need against the secondary store: browsing-log
 * record CRUD, FTS5 search, and JSON export (folded in from the former thin
 * recordsRepo split), the audit_log trail (folded in from auditLogRepo), and
 * retention purging, binary backup/restore, and health check (folded in from
 * dbMaintenance). The former per-table modules now re-export from here so a
 * delegation-target change lands in exactly one place.
 *
 * All methods delegate to the active StorageBackend returned by engine.getBackend().
 * Store-level policy owned here: read-policy application (query), retention
 * defaults SSOT (purgeOldRecords), and status envelope normalization (getStatus).
 */

import { engine, DB_FILENAME } from './sqliteEngineHost.js';
import { applyReadPolicy } from './queryPlanner.js';
// Retention defaults — SSOT via queryPlanner (PBI 04): one definition for the
// wire defaults (planPurge) and these executor defaults, so a one-sided edit
// cannot leave a destructive purge purging on a different default. Pinned by
// purgeDefaultsParity.test.ts.
import { DEFAULT_RETENTION_DAYS, DEFAULT_MAX_RECORDS } from './queryPlanner.js';

import type { BrowsingLogRecord, BrowsingLogEntry, StorageQuery } from '../utils/sqlite-types.js';
import type { AuditLogRecord, AuditLogEntry } from '../utils/sqlite-types.js';

/**
 * Insert a new browsing log record and return the auto-generated row id.
 */
export async function insert(record: BrowsingLogRecord): Promise<{ success: true; id: number } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  return backend.insert(record);
}

/**
 * Insert a batch of records atomically using a transaction.
 * Uses INSERT OR IGNORE to handle UNIQUE constraint violations (url, created_at).
 * PBI 2026-09-11-07: keeps `skipped` in the return so the dashboard import
 * flow can report duplicates without re-deriving them per row.
 */
export async function insertBatch(records: BrowsingLogRecord[]): Promise<{ success: true; inserted: number; skipped: number } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  return backend.insertBatch(records);
}

/**
 * Unified read path — text search (FTS5 / LIKE) and plain filtered listing
 * through a single StorageQuery interface.
 */
export async function query(q: StorageQuery = {}): Promise<{
  success: true; rows: (BrowsingLogEntry & { rank: number })[]; total: number
} | { success: false; error: string }> {
  // Read policy (limit clamp, FTS input truncation) is owned by queryPlanner.
  const planned = applyReadPolicy(q);
  const backend = await engine.getBackend();
  return backend.query(planned);
}

/**
 * Update a browsing log record by id.
 */
export async function update(id: number, changes: Partial<BrowsingLogRecord>): Promise<{ success: true } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  return backend.update(id, changes as Record<string, unknown>);
}

/**
 * Hard-delete a browsing log record by id (physical DELETE, GDPR Art.17).
 * FTS5 triggers automatically clean up the FTS index.
 */
export async function hardDelete(id: number): Promise<{ success: true } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  return backend.delete(id);
}

/**
 * Toggle the starred status of a record.
 */
export async function toggleStar(id: number): Promise<{ success: true; is_starred: number } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  return backend.toggleStar(id);
}

/**
 * Get the total number of records (excluding soft-deleted).
 */
export async function getCount(): Promise<{ success: true; count: number } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  return backend.getCount();
}

/**
 * Check if the database is initialized and accessible.
 */
export async function getStatus(): Promise<{ success: true; initialized: boolean; path: string; fallback: boolean; initError?: string; fts5: boolean; supportsBinaryBackup: boolean; compileOptions?: string[]; compileOptionsSource?: 'opfs-worker' | 'idb' | 'fallback' } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  const result = await backend.getStatus();
  if ('error' in result) return result;
  // Backends that already know their real path (e.g. OPFS worker returns
  // 'OPFS:<file>') must not be overwritten with the generic DB_FILENAME —
  // that erased the OPFS/IDB distinction the diagnostics panel relies on.
  const path = result.path ?? DB_FILENAME;
  // fts5 is part of the base contract every backend reports (SqliteStatusExtras
  // carries it optional for hop-shape reuse); re-assert the backend guarantee.
  return { success: true, ...result, path, fts5: result.fts5 ?? false };
}

/**
 * Clear all browsing logs from the database (GDPR Art.17 hard delete).
 */
export async function clearAll(): Promise<{ success: boolean; error?: string }> {
  const backend = await engine.getBackend();
  return backend.clearAll();
}

/**
 * Export all browsing_logs as a JSON Uint8Array (NOT a SQLite binary .db file).
 * For true SQLite binary serialization, use wa-sqlite backup API.
 *
 * PBI 2026-09-12-22: `serialize` now lives on the `Queryable` interface and
 * every backend returns the shared envelope (exportEnvelope.ts) — previously
 * the OPFS worker returned a bare array over 13 columns while IDB/fallback
 * returned an envelope over 11, so the export schema depended on the backend.
 */
export async function serialize(): Promise<{ success: true; data: Uint8Array } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  return backend.serialize();
}

// ── Audit log (folded in from auditLogRepo) ───────────────────────────────
// Cloud AI provider send-event trail in the separate `audit_log` table —
// unrelated to browsing-log record CRUD.

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

// ── Maintenance (folded in from dbMaintenance) ────────────────────────────
// Retention purging, binary backup/restore, and a lightweight health check.

/**
 * Purge old browsing log records based on retention policy.
 * Deletes records older than retentionDays (excluding starred items).
 * If total non-deleted records still exceed maxRecords, deletes oldest non-starred.
 */
export async function purgeOldRecords(
  retentionDays: number = DEFAULT_RETENTION_DAYS,
  maxRecords: number = DEFAULT_MAX_RECORDS
): Promise<{ success: true; purged: number } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  return backend.purgeOldRecords(retentionDays, maxRecords);
}

/**
 * Purge content (page body) from old records based on retention policy.
 * Sets content = NULL (does NOT delete records).
 * Respects is_starred protection based on includeStarred flag.
 */
export async function purgeContent(
  retentionDays?: number | null,
  maxRecords?: number | null,
  includeStarred?: boolean | null,
): Promise<{ success: true; purged: number } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  return backend.purgeContent(retentionDays ?? undefined, maxRecords ?? undefined, includeStarred ?? undefined);
}

/**
 * Take a binary .db backup.
 * Returns the binary .db on the OPFS path; returns an error on the
 * IDB/fallback paths (the JSON fallback was removed — handing consumers a
 * broken .db is worse than failing).
 */
export async function backupDb(): Promise<{ success: true; data: Uint8Array } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  return backend.backupDb();
}

/**
 * Restore the history DB from a binary .db payload.
 * OPFS path only. Temporary-file validation lives on the opfsWorker side.
 */
export async function restoreDb(data: Uint8Array): Promise<{ success: true } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  return backend.restoreDb(data);
}

/**
 * Lightweight health check — verifies the SQLite database is reachable.
 * Returns true if a SELECT 1 succeeds on any available backend.
 */
export async function sqliteHealthCheck(): Promise<boolean> {
  const backend = await engine.getBackend();
  const result = await backend.healthCheck();
  return result.success;
}
