/**
 * exportEnvelope.ts — SSOT for the SQLITE_EXPORT JSON shape (PBI
 * 2026-09-12-22).
 *
 * The export used to be spelled per backend: the OPFS worker returned a bare
 * array over 13 hand-mapped columns (with 6 `as` casts outside rowCodec), IDB
 * and fallback returned a `{version, table, rows}` envelope over 11 columns.
 * A caller decoding SQLITE_EXPORT got a different schema per backend. The
 * envelope and the column projection live here, derived from rowCodec's
 * canonical lists so a schema column addition fails the drift guard instead
 * of silently dropping from exports.
 */

import type { NamedRow } from './rowCodec.js';

/**
 * Export column projection — a subset of the canonical browsing-log columns.
 * Kept as an explicit whitelist (export shape is a stable contract; adding a
 * schema column must not silently change exported files). The drift guard
 * asserts this list stays a subset of BROWSING_LOG_COLUMNS.
 */
export const EXPORT_COLUMNS = [
  'id',
  'url',
  'title',
  'summary',
  'tags',
  'created_at',
  'domain',
  'visit_duration',
  'scroll_ratio',
  'is_starred',
  'is_deleted',
  'obsidian_synced',
  'gist_synced',
] as const;

export const EXPORT_VERSION = 1;
export const EXPORT_TABLE = 'browsing_logs';

/** Project a named row onto the export columns (missing → null, like SQLite). */
export function projectExportRow(row: NamedRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of EXPORT_COLUMNS) {
    const value = row[col];
    out[col] = value === undefined ? null : value;
  }
  return out;
}

/** Build the canonical export envelope bytes for the given named rows. */
export function buildExportEnvelope(rows: NamedRow[]): Uint8Array {
  const json = JSON.stringify({ version: EXPORT_VERSION, table: EXPORT_TABLE, rows: rows.map(projectExportRow) }, null, 2);
  return new TextEncoder().encode(json);
}
