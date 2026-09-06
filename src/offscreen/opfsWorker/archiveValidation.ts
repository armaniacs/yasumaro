/**
 * archiveValidation.ts
 * Structural validation for archive-format .db files, shared by the temp-open
 * (05) and restore (03) paths via a single implementation.
 *
 * Threat model: the archive file is untrusted user input — an attacker can
 * craft any SQLite file. Validation is therefore an ALLOWLIST over
 * `sqlite_master` (fail-closed on unknown object types), not a blocklist.
 *
 * NOTE: `handleRestore`'s trigger-count check (backupHandlers.ts) is NOT a
 * sufficient validation — it only counts triggers. Do not copy it as-is.
 */

import type { SqliteEngine, SqliteRow, SqliteValue } from '../sqliteEngine.js';
import { COLUMN_NAMES, SCHEMA_SQL } from '../schema.js';

/** Tables an archive-format database may contain. `sqlite_sequence` is
 * auto-created by AUTOINCREMENT and is harmless (managed by SQLite). */
const ALLOWED_TABLES = new Set(['browsing_logs', 'yasumaro_archive_meta', 'sqlite_sequence']);

export interface ArchiveMeta {
  archivedAt: number;
  cutoffCreatedAt: number;
  cutoffDate: string;
  recordCount: number;
  includeDeleted: number;
  archiveFormatVersion: number;
  yasumaroVersion: string;
  maxIdAtArchive?: number;
}

export interface ArchiveValidationOptions {
  /**
   * What to do when `yasumaro_archive_meta.record_count` does not match the
   * actual COUNT(*) of browsing_logs. Temp-open uses 'warn' (open continues),
   * restore uses 'reject'.
   */
  recordCountMismatch?: 'reject' | 'warn';
}

export interface ArchiveValidationResult {
  recordCount: number;
  meta: ArchiveMeta | null;
  warnings: string[];
}

function num(value: SqliteValue | undefined, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function str(value: SqliteValue | undefined, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * Scan sqlite_master against the allowlist. Rejects:
 * - any object type other than table/index (views, triggers, future kinds)
 * - virtual tables (rootpage = 0, e.g. FTS5 shadow containers)
 * - tables outside the allowlist (attacker payloads, main-DB copies)
 * Indexes are allowed regardless of name (non-executable, size bounded by data).
 */
async function validateStructure(engine: SqliteEngine): Promise<void> {
  const rows = await engine.query('SELECT type, name, rootpage FROM sqlite_master');
  for (const row of rows) {
    const type = String(row.type ?? '');
    const name = String(row.name ?? '');
    const rootpage = Number(row.rootpage ?? 0);
    if (type === 'index') continue;
    if (type === 'table') {
      if (rootpage === 0) {
        throw new Error(`Archive validation failed: virtual table detected: ${name}`);
      }
      if (!ALLOWED_TABLES.has(name)) {
        throw new Error(`Archive validation failed: unexpected table: ${name}`);
      }
      continue;
    }
    throw new Error(`Archive validation failed: unexpected object type '${type}': ${name}`);
  }
}

/**
 * Parse base column types (INTEGER / TEXT / REAL) from the SCHEMA_SQL
 * CREATE TABLE block. Used to complete missing columns on older archives.
 */
function parseColumnTypesFromSchema(): Map<string, string> {
  const types = new Map<string, string>();
  const names = ['id', ...COLUMN_NAMES];
  for (const name of names) {
    const re = new RegExp(`\\b${name}\\s+(INTEGER|TEXT|REAL|BLOB)\\b`);
    const m = re.exec(SCHEMA_SQL);
    if (m?.[1]) types.set(name, m[1]);
  }
  return types;
}

interface XInfoColumn {
  name: string;
  type: string;
  hidden: number;
}

async function readTableXInfo(engine: SqliteEngine, table: string): Promise<XInfoColumn[]> {
  const rows = await engine.query(`PRAGMA table_xinfo(${table})`);
  return rows.map((r) => ({
    name: String(r.name ?? ''),
    type: String(r.type ?? ''),
    hidden: Number(r.hidden ?? 0),
  }));
}

/**
 * Complete missing columns on an older archive (staging side only — never
 * touches the main DB schema). Missing columns are added with their base
 * SCHEMA_SQL type; hidden/generated columns reject (fail-closed); extra
 * columns are harmless because reads are projected onto COLUMN_NAMES.
 */
export async function migrateArchiveStaging(engine: SqliteEngine): Promise<void> {
  const columns = await readTableXInfo(engine, 'browsing_logs');
  for (const col of columns) {
    if (col.hidden > 0) {
      throw new Error(
        `Archive validation failed: hidden/generated column detected: ${col.name}`,
      );
    }
  }
  const present = new Set(columns.map((c) => c.name));
  const types = parseColumnTypesFromSchema();
  for (const name of COLUMN_NAMES) {
    if (present.has(name)) continue;
    const type = types.get(name);
    if (!type) {
      throw new Error(`Archive migration failed: no schema type for column ${name}`);
    }
    await engine.exec(`ALTER TABLE browsing_logs ADD COLUMN ${name} ${type}`);
  }
}

async function validateColumns(engine: SqliteEngine): Promise<void> {
  const columns = await readTableXInfo(engine, 'browsing_logs');
  const expected = new Set(['id', ...COLUMN_NAMES]);
  const types = parseColumnTypesFromSchema();
  for (const col of columns) {
    if (col.hidden > 0) {
      throw new Error(
        `Archive validation failed: hidden/generated column detected: ${col.name}`,
      );
    }
    if (!expected.has(col.name)) continue; // extra columns are projected away
    const expectedType = types.get(col.name);
    if (expectedType && col.type.toUpperCase() !== expectedType.toUpperCase()) {
      throw new Error(
        `Archive validation failed: column ${col.name} has type ${col.type}, expected ${expectedType}`,
      );
    }
  }
  for (const name of expected) {
    if (!columns.some((c) => c.name === name)) {
      throw new Error(
        `Archive validation failed: missing column ${name} (run migrateArchiveStaging first)`,
      );
    }
  }
}

function parseMetaRow(row: SqliteRow | undefined): ArchiveMeta | null {
  if (!row) return null;
  const meta: ArchiveMeta = {
    archivedAt: num(row.archived_at, 0),
    cutoffCreatedAt: num(row.cutoff_created_at, 0),
    cutoffDate: str(row.cutoff_date, ''),
    recordCount: num(row.record_count, -1),
    includeDeleted: num(row.include_deleted, 0),
    archiveFormatVersion: num(row.archive_format_version, 1),
    yasumaroVersion: str(row.yasumaro_version, ''),
  };
  // exactOptionalPropertyTypes: only attach when actually present
  if (typeof row.max_id_at_archive === 'number') {
    meta.maxIdAtArchive = row.max_id_at_archive;
  }
  return meta;
}

/**
 * Validate an opened archive engine. The engine is closed by this function
 * ONLY when validation rejects (so callers never operate on a hostile
 * file); on success the caller owns the lifecycle.
 */
export async function validateArchiveEngine(
  engine: SqliteEngine,
  opts: ArchiveValidationOptions = {},
): Promise<ArchiveValidationResult> {
  const recordCountMismatch = opts.recordCountMismatch ?? 'reject';
  const warnings: string[] = [];
  try {
    await validateStructure(engine);
    await validateColumns(engine);

    const countRows = await engine.query('SELECT COUNT(*) AS c FROM browsing_logs');
    const recordCount = Number(countRows[0]?.c ?? 0);

    const metaRows = await engine.query('SELECT * FROM yasumaro_archive_meta LIMIT 1');
    const meta = parseMetaRow(metaRows[0]);
    if (!meta) {
      throw new Error(
        'Archive validation failed: yasumaro_archive_meta is empty or unreadable',
      );
    }
    if (recordCountMismatch === 'reject' && meta.recordCount !== recordCount) {
      throw new Error(
        `Archive validation failed: meta.record_count (${meta.recordCount}) does not match actual rows (${recordCount})`,
      );
    }
    if (recordCountMismatch === 'warn' && meta.recordCount !== recordCount) {
      warnings.push(
        `Archive meta record_count (${meta.recordCount}) does not match actual rows (${recordCount})`,
      );
    }
    return { recordCount, meta, warnings };
  } catch (error) {
    // Fail-closed: never leave a hostile file's engine open after rejection.
    try {
      await engine.close();
    } catch {
      // close failure must not mask the validation error
    }
    throw error;
  }
}

/**
 * Convenience wrapper: read (and structurally validate) the archive meta.
 * Used by preview flows that only need the metadata surface.
 */
export async function readArchiveMeta(
  engine: SqliteEngine,
): Promise<{ recordCount: number; meta: ArchiveMeta | null; warnings: string[] }> {
  return validateArchiveEngine(engine, { recordCountMismatch: 'warn' });
}
