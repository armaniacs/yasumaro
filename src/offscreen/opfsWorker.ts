/**
 * opfsWorker.ts
 * Production OPFS Worker using @subframe7536/sqlite-wasm with OPFSCoopSyncVFS + FTS5.
 *
 * Runs inside a Worker (where createSyncAccessHandle is permitted) and handles
 * all SQLite operations. Communicates with the offscreen document via postMessage.
 *
 * Replaces the old wa-sqlite sync build (AccessHandlePoolVFS, no FTS5).
 */
/// <reference lib="webworker" />

import { createEngine, type SqliteEngine, type SqliteValue, type SqliteRow } from './sqliteEngine.js';
import { errorMessage } from '../utils/errorUtils.js';
import { migrateOldOpfsDb } from './opfsMigrationV2.js';
import { readOldDbRecords, deleteOldDbFile } from './opfsMigrationV2Reader.js';
import { StorageKeys } from '../utils/storage/types.js';

// ---------------------------------------------------------------------------
// Types (worker-internal — mirrors BrowsingLogRecord / QueryOptions / SearchResult)
// ---------------------------------------------------------------------------

interface BrowsingLogRecord {
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
  obsidian_synced?: number;
  gist_synced?: number;
  content?: string | null;
  masked_count?: number | null;
  cleansed_reason?: string | null;
  ai_provider?: string | null;
  ai_model?: string | null;
  ai_duration_ms?: number | null;
  obsidian_duration_ms?: number | null;
  sent_tokens?: number | null;
  received_tokens?: number | null;
  original_tokens?: number | null;
  cleansed_tokens?: number | null;
  page_bytes?: number | null;
  candidate_bytes?: number | null;
  original_bytes?: number | null;
  cleansed_bytes?: number | null;
  ai_summary_original_bytes?: number | null;
  ai_summary_cleansed_bytes?: number | null;
  extracted_sentences_bytes?: number | null;
  extracted_sentences_original_bytes?: number | null;
  fallback_triggered?: number;
}

interface SearchResultRecord {
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
  rank: number;
}

interface AuditLogQueryPayload {
  limit?: number;
  offset?: number;
}

interface QueryPayload {
  limit?: number;
  offset?: number;
  since?: number;
  until?: number;
  domain?: string;
  isStarred?: number;
  orderBy?: string;
  orderDir?: string;
  ids?: number[];
  tagFilter?: string;
}

interface SearchPayload {
  searchQuery: string;
  limit?: number;
  offset?: number;
}

interface RequestMessage {
  id: number;
  type: string;
  payload: unknown;
}

interface ResponseMessage {
  id: number;
  success: boolean;
  result?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_FILENAME = 'yasumaro.db';
const ALLOWED_ORDER_COLUMNS = [
  'id', 'url', 'title', 'summary', 'tags', 'created_at',
  'domain', 'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted',
] as const;

const WASM_URL = new URL('@subframe7536/sqlite-wasm/wasm', import.meta.url).href;

import { SCHEMA_SQL, GIST_SYNCED_INDEX_SQL, FTS5_STATEMENTS, AUDIT_LOG_SCHEMA_SQL, INSERT_SQL, INSERT_IGNORE_SQL, buildInsertParams, FTS_QUERY_MAX_LENGTH, sanitizeFtsTerm } from './schema.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let engine: SqliteEngine | null = null;
let cachedCompileOptions: string[] | null = null;
let fts5Available = false;

// ---------------------------------------------------------------------------
// Init helpers
// ---------------------------------------------------------------------------

async function initSqlite(): Promise<void> {
  if (engine !== null) return;

  try {
    await initSqliteInner();
  } catch (err) {
    // Reset so a future call can retry from scratch instead of being
    // permanently stuck with a half-initialized engine (see PBI-11 postmortem:
    // a failure here previously left `engine` non-null while migrations
    // that depend on it, like the gist_synced column, never ran).
    engine = null;
    throw err;
  }
}

async function initSqliteInner(): Promise<void> {
  engine = await createEngine(DB_FILENAME, WASM_URL);

  await engine.exec(SCHEMA_SQL);
  await engine.exec(AUDIT_LOG_SCHEMA_SQL);

  // Schema migration: add obsidian_synced column if not present
  try {
    await engine.exec('ALTER TABLE browsing_logs ADD COLUMN obsidian_synced INTEGER DEFAULT 0');
  } catch {
    // Column already exists
  }

  // PBI-11: add gist_synced column for per-target sync flags
  try {
    await engine.exec('ALTER TABLE browsing_logs ADD COLUMN gist_synced INTEGER DEFAULT 0');
  } catch {
    // Column already exists
  }
  await engine.exec(GIST_SYNCED_INDEX_SQL);

  // Try to enable FTS5 — execute each DDL statement individually because
  // @subframe7536/sqlite-wasm's run() does not support multi-statement SQL.
  fts5Available = false;
  try {
    for (const stmt of FTS5_STATEMENTS) {
      await engine.exec(stmt);
    }
    fts5Available = true;

    // I2: If base table has rows but FTS index is empty, rebuild the index.
    // This handles the case where rows existed before FTS triggers were added.
    try {
      const baseCount = Number(await engine.queryValue('SELECT COUNT(*) AS c FROM browsing_logs') ?? 0);
      const ftsCount = Number(await engine.queryValue('SELECT COUNT(*) AS c FROM browsing_logs_fts') ?? 0);
      if (baseCount > 0 && ftsCount === 0) {
        console.info('OPFS Worker: FTS index empty, rebuilding...');
        await engine.exec("INSERT INTO browsing_logs_fts(browsing_logs_fts) VALUES('rebuild')");
        console.info('OPFS Worker: FTS index rebuild complete');
      }
    } catch (rebuildErr) {
      console.warn('OPFS Worker: FTS rebuild check failed:', errorMessage(rebuildErr));
    }
  } catch (err) {
    console.warn('OPFS Worker: FTS5 unavailable, falling back to LIKE search:', errorMessage(err));
  }

  // PBI-1: ALTER TABLE migration for new columns
  const newColumns = [
    'content TEXT',
    'masked_count INTEGER',
    'cleansed_reason TEXT',
    'ai_provider TEXT',
    'ai_model TEXT',
    'ai_duration_ms INTEGER',
    'obsidian_duration_ms INTEGER',
    'sent_tokens INTEGER',
    'received_tokens INTEGER',
    'original_tokens INTEGER',
    'cleansed_tokens INTEGER',
    'page_bytes INTEGER',
    'candidate_bytes INTEGER',
    'original_bytes INTEGER',
    'cleansed_bytes INTEGER',
    'ai_summary_original_bytes INTEGER',
    'ai_summary_cleansed_bytes INTEGER',
    'extracted_sentences_bytes INTEGER',
    'extracted_sentences_original_bytes INTEGER',
    'fallback_triggered INTEGER DEFAULT 0',
  ];

  for (const colDef of newColumns) {
    try {
      await sqlExec(`ALTER TABLE browsing_logs ADD COLUMN ${colDef}`);
    } catch (err) {
      // Column already exists — ignore
      // Log unexpected errors (disk full, corruption, etc.) so they are surfaced
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('duplicate column name')) {
        console.warn('OPFS Worker: unexpected ALTER TABLE error:', msg);
      }
    }
  }

  // Cache compile options for diagnostics
  const opts = await engine.query('PRAGMA compile_options');
  cachedCompileOptions = opts.map((r) => String(Object.values(r)[0] ?? ''));

  // Migrate old AccessHandlePoolVFS database (one-time, idempotent)
  await runMigrationV2();
}

// ---------------------------------------------------------------------------
// V2 Migration helpers
// ---------------------------------------------------------------------------

/**
 * Module-level guard to avoid redundant migration attempts within the same
 * Worker lifetime (covers the case where chrome.storage is unavailable).
 */
let migrationV2AttemptedThisSession = false;

async function runMigrationV2(): Promise<void> {
  if (migrationV2AttemptedThisSession) return;
  migrationV2AttemptedThisSession = true;

  try {
    // chrome.storage.local may not be available inside a Worker depending on the
    // browser version and extension manifest.  We guard before each access and
    // fall back to a purely idempotent strategy:
    //   - isMigrationDone: check chrome.storage if available; otherwise treat
    //     the old OPFS dir absence (which readOldDbRecords already handles by
    //     returning []) as "nothing to do".
    //   - setMigrationDone: write to chrome.storage if available; otherwise the
    //     module-level guard + deleteOldDb ensure we don't re-migrate.
    const chromeStorageAvailable =
      typeof chrome !== 'undefined' && chrome.storage?.local !== undefined;

    const result = await migrateOldOpfsDb({
      isMigrationDone: async () => {
        if (!chromeStorageAvailable) return false; // rely on old-dir absence check
        return new Promise<boolean>((resolve) => {
          chrome.storage.local.get(StorageKeys.OPFS_MIGRATION_V2_DONE, (items) => {
            resolve(items[StorageKeys.OPFS_MIGRATION_V2_DONE] === true);
          });
        });
      },
      setMigrationDone: async () => {
        if (!chromeStorageAvailable) return;
        await new Promise<void>((resolve) => {
          chrome.storage.local.set({ [StorageKeys.OPFS_MIGRATION_V2_DONE]: true }, resolve);
        });
      },
      readOldRecords: readOldDbRecords,
      insertBatch: handleInsertBatch,
      deleteOldDb: deleteOldDbFile,
    });

    if (result.skipped) {
      // Already done — nothing to log
    } else if (result.error) {
      console.warn('OPFS Worker: V2 migration failed (will retry next init):', result.error);
    } else {
      console.info(`OPFS Worker: V2 migration complete — ${result.migrated} records migrated`);
    }
  } catch (err) {
    console.warn('OPFS Worker: runMigrationV2 unexpected error:', errorMessage(err));
  }
}

function getEngine(): SqliteEngine {
  if (!engine) throw new Error('OPFS SQLite not initialized');
  return engine;
}

function extractDomain(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// SQL execution helpers
// ---------------------------------------------------------------------------

async function sqlExec(sql: string, params: SqliteValue[] = []): Promise<void> {
  await getEngine().exec(sql, params);
}

async function sqlQuery(
  sql: string, params: SqliteValue[], callback: (row: SqliteRow) => void
): Promise<void> {
  const rows = await getEngine().query(sql, params);
  for (const row of rows) callback(row);
}

// ---------------------------------------------------------------------------
// CRUD Handlers
// ---------------------------------------------------------------------------

async function handleInsert(record: BrowsingLogRecord): Promise<{ id: number }> {
  const domain = record.domain || extractDomain(record.url);

  await sqlExec(INSERT_SQL, buildInsertParams(record, domain));

  let id = 0;
  await sqlQuery('SELECT last_insert_rowid() AS id', [], (row) => { id = Number(row.id); });
  return { id };
}

async function handleQuery(payload: QueryPayload): Promise<{ rows: BrowsingLogRecord[]; total: number }> {
  const {
    limit = 20, offset = 0, since, until, domain,
    isStarred, orderBy = 'created_at', orderDir = 'DESC', ids,
    tagFilter,
  } = payload;

  // Validate sort columns
  if (!ALLOWED_ORDER_COLUMNS.includes(orderBy as typeof ALLOWED_ORDER_COLUMNS[number])) {
    throw new Error(`Invalid orderBy: ${orderBy}`);
  }
  const dir = orderDir === 'ASC' ? 'ASC' : 'DESC';

  // Build WHERE clause
  const conditions: string[] = ['is_deleted = 0'];
  const params: SqliteValue[] = [];

  if (since !== undefined) { conditions.push('created_at >= ?'); params.push(since); }
  if (until !== undefined) { conditions.push('created_at <= ?'); params.push(until); }
  if (domain) { conditions.push('domain = ?'); params.push(domain); }
  if (isStarred !== undefined) { conditions.push('is_starred = ?'); params.push(isStarred); }
  if (ids !== undefined && ids.length > 0) {
    conditions.push(`id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  if (tagFilter) {
    // Strip FTS5 operator keywords and special chars, but preserve # prefix for trigram matching
    // Apply length limit to prevent expensive FTS5 queries on extremely long input
    const limitedTag = tagFilter.slice(0, FTS_QUERY_MAX_LENGTH);
    const cleanTag = limitedTag
      .replace(/["'*^~:()+\-\\]/g, ' ')
      .replace(/\b(OR|AND|NOT|NEAR)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const ftsExpr = `"#${cleanTag}"`;
    conditions.push('id IN (SELECT rowid FROM browsing_logs_fts WHERE tags MATCH ?)');
    params.push(ftsExpr);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count
  let total = 0;
  await sqlQuery(`SELECT COUNT(*) AS c FROM browsing_logs ${where}`, params, (row) => { total = Number(row.c); });

  // Select
  const rows: BrowsingLogRecord[] = [];
  await sqlQuery(
    `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted, obsidian_synced, gist_synced
     FROM browsing_logs ${where}
     ORDER BY ${orderBy} ${dir} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
    (row) => {
      rows.push({
        id: Number(row.id),
        url: String(row.url),
        title: row.title as string | null,
        summary: row.summary as string | null,
        tags: row.tags as string | null,
        created_at: Number(row.created_at),
        domain: row.domain as string | null,
        visit_duration: row.visit_duration as number | null,
        scroll_ratio: row.scroll_ratio as number | null,
        is_starred: Number(row.is_starred),
        is_deleted: Number(row.is_deleted),
        obsidian_synced: Number(row.obsidian_synced),
        gist_synced: Number(row.gist_synced),
      });
    }
  );

  return { rows, total };
}

async function handleUpdate(payload: { id: number; changes: Record<string, SqliteValue> }): Promise<void> {
  const { id, changes } = payload;
  const sets: string[] = [];
  const vals: SqliteValue[] = [];

  for (const [key, val] of Object.entries(changes)) {
    if (val !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(val);
    }
  }

  if (sets.length === 0) return;
  vals.push(id);

  await sqlExec(
    `UPDATE browsing_logs SET ${sets.join(', ')} WHERE id = ?`,
    vals
  );
}

async function handleHardDelete(id: number): Promise<void> {
  await sqlExec('DELETE FROM browsing_logs WHERE id = ?', [id]);
}

async function handleToggleStar(id: number): Promise<{ is_starred: number }> {
  await sqlExec(
    'UPDATE browsing_logs SET is_starred = CASE WHEN is_starred = 0 THEN 1 ELSE 0 END WHERE id = ?',
    [id]
  );
  let isStarred = 0;
  await sqlQuery('SELECT is_starred AS is_starred FROM browsing_logs WHERE id = ?', [id], (row) => { isStarred = Number(row.is_starred); });
  return { is_starred: isStarred };
}

async function handleGetCount(): Promise<number> {
  let count = 0;
  await sqlQuery('SELECT COUNT(*) AS c FROM browsing_logs WHERE is_deleted = 0', [], (row) => { count = Number(row.c); });
  return count;
}

async function handleFtsIndexSize(): Promise<{ count: number }> {
  if (!engine || !fts5Available) return { count: 0 };
  let count = 0;
  await sqlQuery('SELECT COUNT(*) AS c FROM browsing_logs_fts', [], (row) => { count = Number(row.c); });
  return { count };
}

async function handleInsertBatch(records: BrowsingLogRecord[]): Promise<{ count: number }> {
  if (!engine) await initSqlite();
  let inserted = 0;
  try {
    await sqlExec('BEGIN');
    for (const record of records) {
      try {
        const domain = record.domain || extractDomain(record.url);
        await sqlExec(INSERT_IGNORE_SQL, buildInsertParams(record, domain));
        inserted++;
      } catch (err) {
        // Log first error for diagnosis, silently skip the rest
        if (inserted === 0 && records.indexOf(record) === 0) {
          console.error('OPFS Worker: first INSERT failed:', err, 'record:', record.url);
        }
      }
    }
    await sqlExec('COMMIT');
    // M10: use local counter instead of per-row SELECT changes() (O(n) → O(1))
    // NOTE: local counter may overcount with INSERT OR IGNORE but is sufficient for logging
  } catch (err) {
    await sqlExec('ROLLBACK');
    console.error('OPFS Worker: insertBatch transaction failed:', err);
  }
  return { count: inserted };
}

async function handleAuditLogInsert(record: { provider: string; url: string; created_at: number }): Promise<{ id: number }> {
  await sqlExec(
    'INSERT INTO audit_log (provider, url, created_at) VALUES (?, ?, ?)',
    [record.provider, record.url, record.created_at],
  );
  let id = 0;
  await sqlQuery('SELECT last_insert_rowid() AS id', [], (row) => { id = Number(row.id); });
  return { id };
}

async function handleAuditLogQuery(payload: AuditLogQueryPayload): Promise<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number }> {
  const limit = Math.min(payload.limit ?? 100, 1000);
  const offset = payload.offset ?? 0;

  const rows: Array<{ id: number; provider: string; url: string; created_at: number }> = [];
  await sqlQuery(
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
  await sqlQuery('SELECT COUNT(*) AS c FROM audit_log', [], (row) => { total = Number(row.c); });

  return { rows, total };
}

async function handleGetStatus(): Promise<{ initialized: boolean; path: string; fallback: boolean; fts5: boolean; count: number; compileOptions?: string[] }> {
  if (!engine) {
    return { initialized: false, path: DB_FILENAME, fallback: false, fts5: false, count: 0 };
  }

  let count = 0;
  await sqlQuery('SELECT COUNT(*) AS c FROM browsing_logs', [], (row) => { count = Number(row.c); });

  return {
    initialized: true,
    path: `OPFS:${DB_FILENAME}`,
    fallback: false,
    fts5: fts5Available,
    count,
    compileOptions: cachedCompileOptions ?? undefined,
  };
}

async function handlePurgeOldRecords(payload: { retentionDays: number; maxRecords: number }): Promise<{ purged: number }> {
  const { retentionDays, maxRecords } = payload;
  const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let totalPurged = 0;

  // Delete old non-starred records
  await sqlExec(
    'DELETE FROM browsing_logs WHERE created_at < ? AND is_starred = 0 AND is_deleted = 0',
    [cutoffMs]
  );

  // Get change count via query
  await sqlQuery('SELECT changes() AS c', [], (row) => { totalPurged = Number(row.c); });

  // If still over max, delete oldest non-starred records
  let count = 0;
  await sqlQuery('SELECT COUNT(*) AS c FROM browsing_logs WHERE is_deleted = 0', [], (row) => { count = Number(row.c); });

  if (count > maxRecords) {
    const toDelete = count - maxRecords;
    await sqlExec(
      `DELETE FROM browsing_logs WHERE id IN (
         SELECT id FROM browsing_logs WHERE is_starred = 0 AND is_deleted = 0
         ORDER BY created_at ASC LIMIT ?
       )`,
      [toDelete]
    );
    // Use actual change count from SQLite
    await sqlQuery('SELECT changes() AS c', [], (row) => { totalPurged += Number(row.c); });
  }

  return { purged: totalPurged };
}

async function handleContentPurge(payload: {
  retentionDays?: number | null;
  maxRecords?: number | null;
  includeStarred?: boolean | null;
}): Promise<{ purged: number }> {
  const starredClause = payload.includeStarred ? '' : 'AND is_starred = 0';
  let totalPurged = 0;

  // 1. Days-based
  if (payload.retentionDays != null && payload.retentionDays > 0) {
    const cutoffMs = Date.now() - payload.retentionDays * 24 * 60 * 60 * 1000;
    await sqlExec(
      `UPDATE browsing_logs SET content = NULL
       WHERE content IS NOT NULL AND created_at < ? ${starredClause}`,
      [cutoffMs]
    );
    await sqlQuery('SELECT changes() AS c', [], (row) => { totalPurged += Number(row.c); });
  }

  // 2. Count-based
  if (payload.maxRecords != null && payload.maxRecords > 0) {
    let count = 0;
    await sqlQuery(
      `SELECT COUNT(*) AS c FROM browsing_logs WHERE content IS NOT NULL ${starredClause}`,
      [],
      (row) => { count = Number(row.c); }
    );

    if (count > payload.maxRecords) {
      const excess = count - payload.maxRecords;
      await sqlExec(
        `UPDATE browsing_logs SET content = NULL
         WHERE id IN (
           SELECT id FROM browsing_logs
           WHERE content IS NOT NULL ${starredClause}
           ORDER BY created_at ASC
           LIMIT ?
         )`,
        [excess]
      );
      totalPurged += excess;
    }
  }

  return { purged: totalPurged };
}

async function handleClearAll(): Promise<void> {
  await sqlExec('DELETE FROM browsing_logs', []);
  if (fts5Available) {
    await sqlExec("INSERT INTO browsing_logs_fts(browsing_logs_fts) VALUES('rebuild')", []);
  }
}

async function handleSerialize(): Promise<Uint8Array> {
  const rows: BrowsingLogRecord[] = [];
  await sqlQuery(
    `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted, obsidian_synced, gist_synced
     FROM browsing_logs WHERE is_deleted = 0 ORDER BY created_at DESC`,
    [],
    (row) => {
      rows.push({
        id: Number(row.id),
        url: String(row.url),
        title: row.title as string | null,
        summary: row.summary as string | null,
        tags: row.tags as string | null,
        created_at: Number(row.created_at),
        domain: row.domain as string | null,
        visit_duration: row.visit_duration as number | null,
        scroll_ratio: row.scroll_ratio as number | null,
        is_starred: Number(row.is_starred),
        is_deleted: Number(row.is_deleted),
        obsidian_synced: Number(row.obsidian_synced),
        gist_synced: Number(row.gist_synced),
      });
    }
  );

  const encoder = new TextEncoder();
  return encoder.encode(JSON.stringify(rows));
}

/**
 * バイナリ .db バックアップを取得
 * OPFS ファイルシステムから直接データベースファイルを読み取る
 *
 * 注意: createSyncAccessHandle は OPFSCoopSyncVFS が同一ファイルを開いていると
 *       INVALID_STATE エラーになるため、非排他読み取りの getFile() を使用する。
 */
async function handleBackup(): Promise<Uint8Array> {
  if (!engine) throw new Error('OPFS SQLite not initialized');

  // WAL チェックポイントを実行し、すべてのデータをメイン .db ファイルにフラッシュ
  try {
    await engine.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    // WAL モードでない場合は無視
  }

  // OPFS ファイルシステムから .db ファイルのスナップショットを読み取る
  // getFile() は排他ロックを要求しないため、SQLite が使用中でも動作する
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(DB_FILENAME, { create: false });
  const file = await fileHandle.getFile();
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}

const RESTORE_TMP_FILENAME = `${DB_FILENAME}.restore-tmp`;

/**
 * バイナリ .db を書き戻して履歴DBを復元する。
 * 一時ファイルに書き込み → SQLite として開けるか検証 → 検証OKなら本番ファイルと置換。
 * 検証に失敗した場合は一時ファイルを破棄し、本番ファイルは変更しない。
 */
export async function handleRestore(data: Uint8Array): Promise<{ restored: true }> {
  const root = await navigator.storage.getDirectory();

  // 1. 一時ファイルに書き込む
  const tmpHandle = await root.getFileHandle(RESTORE_TMP_FILENAME, { create: true });
  const writable = await tmpHandle.createWritable();
  await writable.write(data.slice() as unknown as ArrayBuffer);
  await writable.close();

  // 2. 一時ファイルが開ける有効な SQLite ファイルか検証する
  try {
    const tmpEngine = await createEngine(RESTORE_TMP_FILENAME, WASM_URL);
    await tmpEngine.exec('SELECT count(*) FROM sqlite_master');
    await tmpEngine.close();
  } catch (validationError) {
    // 検証失敗: 一時ファイルを破棄し、本番ファイルには触れない
    await root.removeEntry(RESTORE_TMP_FILENAME).catch(() => {});
    throw new Error(`Restore validation failed: ${errorMessage(validationError)}`);
  }

  // 3. 検証OK: 既存の engine を閉じてから本番ファイルと置換する
  if (engine) {
    await engine.close();
    engine = null;
  }
  await root.removeEntry(DB_FILENAME).catch(() => {});
  await (tmpHandle as unknown as { move: (name: string) => Promise<void> }).move(DB_FILENAME);

  // 4. 復元したファイルで engine を再初期化する
  await initSqlite();

  return { restored: true };
}

async function handleSearch(payload: SearchPayload): Promise<{ rows: SearchResultRecord[]; total: number }> {
  const { searchQuery, limit = 50, offset = 0 } = payload;
  const bare = sanitizeFtsTerm(searchQuery);
  if (!bare) return { rows: [], total: 0 };

  // trigram MATCH requires >= 3 unicode code points; shorter terms fall back to LIKE.
  const charLen = [...bare].length;
  if (fts5Available && charLen >= 3) {
    return handleSearchFts(`"${bare}"`, limit, offset);
  }
  return handleSearchLike(searchQuery, limit, offset);
}

async function handleSearchFts(
  sanitizedQuery: string, limit: number, offset: number
): Promise<{ rows: SearchResultRecord[]; total: number }> {
  let total = 0;
  await sqlQuery(
    `SELECT COUNT(*) AS c FROM browsing_logs_fts
JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id
WHERE browsing_logs_fts MATCH ? AND b.is_deleted = 0`,
    [sanitizedQuery],
    (row) => { total = Number(row.c); }
  );

  const rows: SearchResultRecord[] = [];
  await sqlQuery(
    `SELECT b.id, b.url, b.title, b.summary, b.tags, b.created_at, b.domain, b.visit_duration, b.scroll_ratio, b.is_starred, rank AS rank
     FROM browsing_logs_fts
     JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id
     WHERE browsing_logs_fts MATCH ? AND b.is_deleted = 0
     ORDER BY rank LIMIT ? OFFSET ?`,
    [sanitizedQuery, limit, offset],
    (row) => {
      rows.push({
        id: Number(row.id),
        url: String(row.url),
        title: row.title as string | null,
        summary: row.summary as string | null,
        tags: row.tags as string | null,
        created_at: Number(row.created_at),
        domain: row.domain as string | null,
        visit_duration: row.visit_duration as number | null,
        scroll_ratio: row.scroll_ratio as number | null,
        is_starred: Number(row.is_starred),
        rank: Number(row.rank),
      });
    }
  );

  return { rows, total };
}

async function handleSearchLike(
  rawQuery: string, limit: number, offset: number
): Promise<{ rows: SearchResultRecord[]; total: number }> {
  const like = `%${rawQuery}%`;
  const conditions = 'is_deleted = 0 AND (url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?)';
  const params: SqliteValue[] = [like, like, like, like];

  let total = 0;
  await sqlQuery(
    `SELECT COUNT(*) AS c FROM browsing_logs WHERE ${conditions}`,
    params,
    (row) => { total = Number(row.c); }
  );

  const rows: SearchResultRecord[] = [];
  await sqlQuery(
    `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred
     FROM browsing_logs WHERE ${conditions}
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
    (row) => {
      rows.push({
        id: Number(row.id),
        url: String(row.url),
        title: row.title as string | null,
        summary: row.summary as string | null,
        tags: row.tags as string | null,
        created_at: Number(row.created_at),
        domain: row.domain as string | null,
        visit_duration: row.visit_duration as number | null,
        scroll_ratio: row.scroll_ratio as number | null,
        is_starred: Number(row.is_starred),
        rank: 0,
      });
    }
  );

  return { rows, total };
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

export async function handleRequest(req: RequestMessage): Promise<ResponseMessage> {
  const { id, type, payload } = req;

  try {
    let result: unknown;

    // Ensure engine is initialized for all operations except INIT
    if (type !== 'INIT' && !engine) {
      await initSqlite();
    }

    switch (type) {
      case 'INIT': {
        result = { initialized: true };
        break;
      }
      case 'INSERT': {
        result = await handleInsert(payload as BrowsingLogRecord);
        break;
      }
      case 'QUERY': {
        result = await handleQuery(payload as QueryPayload);
        break;
      }
      case 'SEARCH': {
        result = await handleSearch(payload as SearchPayload);
        break;
      }
      case 'UPDATE': {
        await handleUpdate(payload as { id: number; changes: Record<string, SqliteValue> });
        result = { updated: true };
        break;
      }
      case 'DELETE': {
        await handleHardDelete(payload as number);
        result = { deleted: true };
        break;
      }
      case 'TOGGLE_STAR': {
        result = await handleToggleStar(payload as number);
        break;
      }
      case 'GET_COUNT': {
        result = { count: await handleGetCount() };
        break;
      }
      case 'STATUS': {
        result = await handleGetStatus();
        break;
      }
      case 'PURGE': {
        result = await handlePurgeOldRecords(payload as { retentionDays: number; maxRecords: number });
        break;
      }
      case 'CONTENT_PURGE': {
        result = await handleContentPurge(payload as { retentionDays?: number; maxRecords?: number; includeStarred?: boolean });
        break;
      }
      case 'CLEAR_ALL': {
        await handleClearAll();
        result = { cleared: true };
        break;
      }
      case 'SERIALIZE': {
        result = await handleSerialize();
        break;
      }
      case 'BACKUP': {
        result = await handleBackup();
        break;
      }
      case 'RESTORE': {
        const restorePayload = payload as { data: number[] | Uint8Array };
        const bytes = restorePayload.data instanceof Uint8Array
          ? restorePayload.data
          : new Uint8Array(restorePayload.data);
        result = await handleRestore(bytes);
        break;
      }
      case 'FTS_INDEX_SIZE': {
        result = await handleFtsIndexSize();
        break;
      }
      case 'INSERT_BATCH': {
        result = await handleInsertBatch(payload as BrowsingLogRecord[]);
        break;
      }
      case 'HEALTH_CHECK': {
        result = { ok: engine !== null };
        break;
      }
      case 'AUDIT_LOG_INSERT': {
        result = await handleAuditLogInsert(payload as { provider: string; url: string; created_at: number });
        break;
      }
      case 'AUDIT_LOG_QUERY': {
        result = await handleAuditLogQuery(payload as AuditLogQueryPayload);
        break;
      }
      default:
        return { id, success: false, error: `Unknown worker type: ${type}` };
    }

    return { id, success: true, result };
  } catch (err) {
    return { id, success: false, error: errorMessage(err) };
  }
}

// ---------------------------------------------------------------------------
// Request serialization queue
// Prevents concurrent SQLite access which causes SQLITE_LOCKED errors.
// ---------------------------------------------------------------------------

type QueueTask = () => Promise<void>;
const requestQueue: QueueTask[] = [];
let queueProcessing = false;

async function processQueue(): Promise<void> {
  if (queueProcessing) return;
  queueProcessing = true;
  try {
    while (requestQueue.length > 0) {
      const task = requestQueue.shift()!;
      try { await task(); } catch { /* individual task errors are handled inside task */ }
    }
  } finally {
    queueProcessing = false;
  }
}

function enqueue(task: QueueTask): void {
  requestQueue.push(task);
  void processQueue();
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

self.onmessage = (e: MessageEvent<RequestMessage>) => {
  enqueue(async () => {
    const response = await handleRequest(e.data);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(response);
  });
};
