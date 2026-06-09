/**
 * sqlite.ts
 * SQLite (wa-sqlite + OPFS) operations for the offscreen document.
 * Provides CRUD operations and FTS5 full-text search for browsing logs.
 */

import SQLiteESMFactory from 'wa-sqlite/dist/wa-sqlite-async.mjs';
import * as SQLite from 'wa-sqlite';
import { OriginPrivateFileSystemVFS } from 'wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js';

// The wa-sqlite package uses ambient type declarations for SQLiteAPI and SQLiteCompatibleType
// that are not directly exported. We define local aliases for the types we need.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type SqliteValue = number | string | Uint8Array | null;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type WaSqliteAPI = any;

/** Column names allowed in ORDER BY clauses (prevents SQL injection). */
const ALLOWED_ORDER_COLUMNS = [
  'id', 'url', 'title', 'summary', 'tags', 'created_at',
  'domain', 'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted',
] as const;

// ============================================================================
// Schema definition
// ============================================================================

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS browsing_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    title TEXT,
    summary TEXT,
    tags TEXT,
    created_at INTEGER NOT NULL,
    domain TEXT,
    visit_duration INTEGER,
    scroll_ratio REAL,
    is_starred INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_logs_created ON browsing_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_logs_domain ON browsing_logs(domain);
  CREATE INDEX IF NOT EXISTS idx_logs_active ON browsing_logs(is_deleted, created_at);
  CREATE INDEX IF NOT EXISTS idx_logs_obsidian ON browsing_logs(obsidian_synced);

  CREATE VIRTUAL TABLE IF NOT EXISTS browsing_logs_fts USING fts5(
    url, title, summary, tags,
    content='browsing_logs',
    content_rowid='id',
    tokenize='unicode61 tokenchars'
  );

  -- Triggers to keep FTS index in sync with the main table
  CREATE TRIGGER IF NOT EXISTS browsing_logs_ai AFTER INSERT ON browsing_logs BEGIN
    INSERT INTO browsing_logs_fts(rowid, url, title, summary, tags)
    VALUES (new.id, new.url, new.title, new.summary, new.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS browsing_logs_ad AFTER DELETE ON browsing_logs BEGIN
    INSERT INTO browsing_logs_fts(browsing_logs_fts, rowid, url, title, summary, tags)
    VALUES ('delete', old.id, old.url, old.title, old.summary, old.tags);
  END;

  CREATE TRIGGER IF NOT EXISTS browsing_logs_au AFTER UPDATE ON browsing_logs BEGIN
    INSERT INTO browsing_logs_fts(browsing_logs_fts, rowid, url, title, summary, tags)
    VALUES ('delete', old.id, old.url, old.title, old.summary, old.tags);
    INSERT INTO browsing_logs_fts(rowid, url, title, summary, tags)
    VALUES (new.id, new.url, new.title, new.summary, new.tags);
  END;
`;

const DB_FILENAME = 'yasumaro.db';

// ============================================================================
// Types
// ============================================================================

export interface BrowsingLogRecord {
  id?: number;
  url: string;
  title?: string | null;
  summary?: string | null;
  tags?: string | null;
  created_at: number;
  domain?: string | null;
  visit_duration?: number | null;
  scroll_ratio?: number | null;
  is_starred?: number;
  is_deleted?: number;
}

export interface QueryOptions {
  /** Maximum number of rows to return */
  limit?: number;
  /** Number of rows to skip */
  offset?: number;
  /** Column to order by (default: created_at) */
  orderBy?: string;
  /** Sort direction (default: DESC) */
  orderDir?: 'ASC' | 'DESC';
  /** Filter by domain (exact match) */
  domain?: string;
  /** Filter by starred status */
  isStarred?: boolean;
  /** Filter out deleted records (default: true) */
  excludeDeleted?: boolean;
  /** Filter records on or after this timestamp (Unix ms) */
  since?: number;
  /** Filter records on or before this timestamp (Unix ms) */
  until?: number;
}

export interface SearchResult {
  id: number;
  url: string;
  title: string | null;
  summary: string | null;
  tags: string | null;
  created_at: number;
  domain: string | null;
  visit_duration: number | null;
  scroll_ratio: number | null;
  is_starred: number;
  /** FTS5 rank (relevance score) */
  rank: number;
}

// ============================================================================
// Module-level state
// ============================================================================

let dbHandle: number | null = null;
let sqlite3: WaSqliteAPI | null = null;
let initPromise: Promise<boolean> | null = null;

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the SQLite database. Safe to call multiple times —
 * subsequent calls are no-ops.
 */
export async function init(): Promise<boolean> {
  if (dbHandle) return true;
  if (initPromise) return initPromise;

  initPromise = _doInit();
  return initPromise;
}

async function _doInit(): Promise<boolean> {
  try {
    // Load the SQLite WASM module
    const module = await SQLiteESMFactory();
    sqlite3 = SQLite.Factory(module);

    // Register the OPFS VFS
    const vfs = new OriginPrivateFileSystemVFS();
    sqlite3.vfs_register(vfs, true);

    // Open the database on OPFS
    dbHandle = await sqlite3.open_v2(
      DB_FILENAME,
      SQLite.SQLITE_OPEN_CREATE | SQLite.SQLITE_OPEN_READWRITE,
      'opfs'
    );

    // Execute schema creation
    await sqlite3.exec(dbHandle, SCHEMA_SQL);

    // Schema migration: add obsidian_synced column if not present (Phase 6)
    try {
      await sqlite3.exec(dbHandle, 'ALTER TABLE browsing_logs ADD COLUMN obsidian_synced INTEGER DEFAULT 0');
    } catch {
      // Column already exists — that's fine
    }

    // Enable WAL mode for better concurrent read performance
    await sqlite3.exec(dbHandle, 'PRAGMA journal_mode=WAL;');
    await sqlite3.exec(dbHandle, 'PRAGMA wal_autocheckpoint=1000;');

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('SQLite init failed:', errorMessage, error);
    dbHandle = null;
    sqlite3 = null;
    initPromise = null;
    return false;
  }
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Insert a new browsing log record and return the auto-generated row id.
 */
export async function insert(record: BrowsingLogRecord): Promise<{ success: true; id: number } | { success: false; error: string }> {
  try {
    if (!dbHandle || !sqlite3) {
      const ok = await init();
      if (!ok) return { success: false, error: 'Database not initialized' };
    }

    const domain = record.domain || extractDomain(record.url);

    // Use run() for INSERT, then query last_insert_rowid
    await sqlite3!.exec(
      dbHandle!,
      `INSERT INTO browsing_logs (url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.url,
        record.title ?? null,
        record.summary ?? null,
        record.tags ?? null,
        record.created_at,
        domain,
        record.visit_duration ?? null,
        record.scroll_ratio ?? null,
        record.is_starred ?? 0,
        record.is_deleted ?? 0,
      ]
    );

    // Get the last insert row id
    let newId = 0;
    await sqlite3!.exec(dbHandle!, 'SELECT last_insert_rowid()', (row: SqliteValue[]) => {
      newId = Number(row[0]);
    });

    return { success: true, id: newId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('SQLite insert failed:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Query browsing logs with optional filters.
 */
export async function query(options: QueryOptions = {}): Promise<{
  success: true; rows: BrowsingLogRecord[]; total: number
} | { success: false; error: string }> {
  try {
    if (!dbHandle || !sqlite3) {
      const ok = await init();
      if (!ok) return { success: false, error: 'Database not initialized' };
    }

    const conditions: string[] = [];
    const params: SqliteValue[] = [];

    if (options.excludeDeleted !== false) {
      conditions.push('is_deleted = 0');
    }
    if (options.domain) {
      conditions.push('domain = ?');
      params.push(options.domain);
    }
    if (options.isStarred !== undefined) {
      conditions.push('is_starred = ?');
      params.push(options.isStarred ? 1 : 0);
    }
    if (options.since !== undefined) {
      conditions.push('created_at >= ?');
      params.push(options.since);
    }
    if (options.until !== undefined) {
      conditions.push('created_at <= ?');
      params.push(options.until);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    // Validate orderBy against allowlist to prevent SQL injection
    const orderBy = options.orderBy && ALLOWED_ORDER_COLUMNS.includes(options.orderBy as typeof ALLOWED_ORDER_COLUMNS[number])
      ? options.orderBy : 'created_at';
    const orderDir = options.orderDir === 'ASC' ? 'ASC' : 'DESC';
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    // Get total count
    let total = 0;
    await sqlite3!.exec(
      dbHandle!,
      `SELECT COUNT(*) FROM browsing_logs ${whereClause}`,
      params,
      (row: SqliteValue[]) => {
        total = Number(row[0]);
      }
    );

    // Get rows
    const rows: BrowsingLogRecord[] = [];
    await sqlite3!.exec(
      dbHandle!,
      `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted
       FROM browsing_logs ${whereClause}
       ORDER BY ${orderBy} ${orderDir}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
      (row: SqliteValue[]) => {
        rows.push({
          id: Number(row[0]),
          url: String(row[1]),
          title: row[2] as string | null,
          summary: row[3] as string | null,
          tags: row[4] as string | null,
          created_at: Number(row[5]),
          domain: row[6] as string | null,
          visit_duration: row[7] != null ? Number(row[7]) : null,
          scroll_ratio: row[8] != null ? Number(row[8]) : null,
          is_starred: Number(row[9]),
          is_deleted: Number(row[10]),
        });
      }
    );

    return { success: true, rows, total };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('SQLite query failed:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Full-text search using FTS5.
 */
export async function search(searchQuery: string, limit: number = 50, offset: number = 0): Promise<{
  success: true; rows: SearchResult[]; total: number
} | { success: false; error: string }> {
  try {
    if (!dbHandle || !sqlite3) {
      const ok = await init();
      if (!ok) return { success: false, error: 'Database not initialized' };
    }

    // Sanitize the search query for FTS5
    const ftsQuery = sanitizeFtsQuery(searchQuery);

    // Get total count
    let total = 0;
    await sqlite3!.exec(
      dbHandle!,
      `SELECT COUNT(*) FROM browsing_logs_fts WHERE browsing_logs_fts MATCH ?`,
      [ftsQuery],
      (row: SqliteValue[]) => {
        total = Number(row[0]);
      }
    );

    // Search with ranking using FTS5 bm25 function
    const rows: SearchResult[] = [];
    await sqlite3!.exec(
      dbHandle!,
      `SELECT
         b.id, b.url, b.title, b.summary, b.tags,
         b.created_at, b.domain, b.visit_duration, b.scroll_ratio, b.is_starred,
         rank
       FROM browsing_logs_fts
       JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id
       WHERE browsing_logs_fts MATCH ?
         AND b.is_deleted = 0
       ORDER BY rank
       LIMIT ? OFFSET ?`,
      [ftsQuery, limit, offset],
      (row: SqliteValue[]) => {
        rows.push({
          id: Number(row[0]),
          url: String(row[1]),
          title: row[2] as string | null,
          summary: row[3] as string | null,
          tags: row[4] as string | null,
          created_at: Number(row[5]),
          domain: row[6] as string | null,
          visit_duration: row[7] != null ? Number(row[7]) : null,
          scroll_ratio: row[8] != null ? Number(row[8]) : null,
          is_starred: Number(row[9]),
          rank: Number(row[10]),
        });
      }
    );

    return { success: true, rows, total };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('SQLite search failed:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Update a browsing log record by id.
 */
export async function update(id: number, changes: Partial<BrowsingLogRecord>): Promise<{ success: true } | { success: false; error: string }> {
  try {
    if (!dbHandle || !sqlite3) {
      const ok = await init();
      if (!ok) return { success: false, error: 'Database not initialized' };
    }

    const setClauses: string[] = [];
    const params: SqliteValue[] = [];

    const updatableFields: (keyof BrowsingLogRecord)[] = [
      'url', 'title', 'summary', 'tags', 'domain',
      'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted'
    ];

    for (const field of updatableFields) {
      if (field in changes) {
        setClauses.push(`${field} = ?`);
        params.push(changes[field] ?? null);
      }
    }

    if (setClauses.length === 0) {
      return { success: true };
    }

    params.push(id);
    await sqlite3!.exec(
      dbHandle!,
      `UPDATE browsing_logs SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('SQLite update failed:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Soft-delete a browsing log record by id (marks is_deleted = 1).
 */
export async function softDelete(id: number): Promise<{ success: true } | { success: false; error: string }> {
  return update(id, { is_deleted: 1 });
}

/**
 * Toggle the starred status of a record.
 */
export async function toggleStar(id: number): Promise<{ success: true; is_starred: number } | { success: false; error: string }> {
  try {
    if (!dbHandle || !sqlite3) {
      const ok = await init();
      if (!ok) return { success: false, error: 'Database not initialized' };
    }
    // Toggle the star value
    await sqlite3!.exec(
      dbHandle!,
      'UPDATE browsing_logs SET is_starred = CASE WHEN is_starred = 0 THEN 1 ELSE 0 END WHERE id = ?',
      [id]
    );
    // Read back the new value
    let newStarred = 0;
    await sqlite3!.exec(
      dbHandle!,
      'SELECT is_starred FROM browsing_logs WHERE id = ?',
      [id],
      (row: SqliteValue[]) => {
        newStarred = Number(row[0]);
      }
    );
    return { success: true, is_starred: newStarred };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('SQLite toggleStar failed:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Get the total number of records (excluding soft-deleted).
 */
export async function getCount(): Promise<{ success: true; count: number } | { success: false; error: string }> {
  try {
    if (!dbHandle || !sqlite3) {
      const ok = await init();
      if (!ok) return { success: false, error: 'Database not initialized' };
    }

    let count = 0;
    await sqlite3!.exec(
      dbHandle!,
      'SELECT COUNT(*) FROM browsing_logs WHERE is_deleted = 0',
      [],
      (row: SqliteValue[]) => {
        count = Number(row[0]);
      }
    );

    return { success: true, count };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('SQLite getCount failed:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Check if the database is initialized and accessible.
 */
export async function getStatus(): Promise<{ success: true; initialized: boolean; path: string } | { success: false; error: string }> {
  try {
    if (!dbHandle || !sqlite3) {
      return { success: true, initialized: false, path: DB_FILENAME };
    }

    let count = 0;
    await sqlite3!.exec(
      dbHandle!,
      'SELECT COUNT(*) FROM browsing_logs',
      [],
      (row: SqliteValue[]) => {
        count = Number(row[0]);
      }
    );

    return { success: true, initialized: true, path: DB_FILENAME };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('SQLite getStatus failed:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract the domain from a URL string.
 */
function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url;
  }
}

/**
 * Sanitize user input for FTS5 query syntax.
 * Escapes special FTS5 characters and wraps in double quotes if needed.
 */
const FTS_QUERY_MAX_LENGTH = 200;

function sanitizeFtsQuery(query: string): string {
  if (!query) return '';

  // Limit input length to prevent DoS via extremely long queries
  const truncated = query.slice(0, FTS_QUERY_MAX_LENGTH);

  // FTS5 special chars: ^ * " : ~ ( ) + -
  // Remove or escape them to prevent syntax errors
  const sanitized = truncated
    .replace(/[()"*~^:]/g, '')
    .replace(/[+-]/g, ' ')
    .trim();

  if (!sanitized) return '';

  // For multi-word queries, use implicit AND
  return sanitized;
}

// ============================================================================
// Export
// ============================================================================

/**
 * Serialize the database to a binary blob (.db file download).
 */
export async function serialize(): Promise<{ success: true; data: Uint8Array } | { success: false; error: string }> {
  try {
    if (!dbHandle || !sqlite3) {
      const ok = await init();
      if (!ok) return { success: false, error: 'Database not initialized' };
    }

    // Use sqlite3_serialize to dump the database to a byte array
    const result = sqlite3!.exec(dbHandle!, `SELECT writefile('${DB_FILENAME}', NULL)`) as unknown;
    // wa-sqlite doesn't have a simple serialize function — use backup API instead
    // For now, run a query to get all data as JSON and return Uint8Array
    const rows: Record<string, unknown>[] = [];
    await sqlite3!.exec(
      dbHandle!,
      `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted
       FROM browsing_logs WHERE is_deleted = 0 ORDER BY created_at DESC`,
      [],
      (row: SqliteValue[]) => {
        rows.push({
          id: Number(row[0]),
          url: String(row[1]),
          title: row[2],
          summary: row[3],
          tags: row[4],
          created_at: Number(row[5]),
          domain: row[6],
          visit_duration: row[7],
          scroll_ratio: row[8],
          is_starred: Number(row[9]),
          is_deleted: Number(row[10]),
        });
      }
    );

    const json = JSON.stringify({ version: 1, table: 'browsing_logs', rows }, null, 2);
    const encoder = new TextEncoder();
    return { success: true, data: encoder.encode(json) };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('SQLite serialize failed:', errorMessage);
    return { success: false, error: errorMessage };
  }
}

// ============================================================================
// Testing helper
// ============================================================================

/** Reset the module state for testing. */
export function _resetForTesting(): void {
  dbHandle = null;
  sqlite3 = null;
  initPromise = null;
}
