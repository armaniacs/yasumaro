/**
 * recordsRepo.ts
 * Browsing-log record CRUD, FTS5 search, and JSON export.
 * Split out of sqlite.ts (PBI: sqlite.ts deepening).
 *
 * All methods delegate to the active StorageBackend returned by engine.getBackend().
 */

import { engine, DB_FILENAME } from './sqliteEngineHost.js';
import { applyReadPolicy } from './queryPlanner.js';

import type { BrowsingLogRecord, BrowsingLogEntry, StorageQuery } from '../utils/sqlite-types.js';

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
