/**
 * sqliteMessageHandlers.ts
 * Registry of SQLite message handlers for the offscreen document.
 * Replaces the 24-case switch in offscreen.ts with a Map<SqliteMessageType, Handler>
 * plus a common payload-size guard middleware.
 */

import { engine } from './sqliteEngineContext.js';
import {
  insert as sqliteInsert,
  insertBatch as sqliteInsertBatch,
  query as sqliteQuery,
  update as sqliteUpdate,
  hardDelete as sqliteHardDelete,
  toggleStar as sqliteToggleStar,
  getCount as sqliteGetCount,
  getStatus as sqliteGetStatus,
  serialize as sqliteSerialize,
  clearAll as sqliteClearAll,
} from './recordsRepo.js';
import {
  sqliteHealthCheck,
  backupDb as sqliteBackupDb,
  restoreDb as sqliteRestoreDb,
  purgeOldRecords as sqlitePurgeOldRecords,
  purgeContent as sqlitePurgeContent,
} from './dbMaintenance.js';
import {
  insertAuditLog as sqliteInsertAuditLog,
  queryAuditLog as sqliteQueryAuditLog,
} from './auditLogRepo.js';
import { StorageKeys } from '../utils/storage/types.js';
import { pickDefined } from '../utils/objectUtils.js';
import { buildRecordFromPayload } from './browsingLogCodec.js';
import type { SqliteMessage, SqliteMessageType } from '../messaging/sqliteMessages.js';

export type SqliteHandler = (
  msg: SqliteMessage,
  sendResponse: (response: unknown) => void,
) => Promise<void>;

async function handleHealthCheck(_msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const ok = await sqliteHealthCheck();
  sendResponse({ success: ok });
}

async function handleInit(_msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const ok = await engine.init();
  sendResponse({ success: ok, initialized: ok });
}

async function handleInsert(msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const payload = (msg as Extract<SqliteMessage, { type: 'SQLITE_INSERT' }>).payload as Record<string, unknown>;
  const record = buildRecordFromPayload(payload);
  const result = await sqliteInsert(record);
  sendResponse(result);
}

async function handleInsertBatch(msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const rawRecords = (msg as Extract<SqliteMessage, { type: 'SQLITE_INSERT_BATCH' }>).payload.records || [];
  const records = (rawRecords as Record<string, unknown>[]).map(r => buildRecordFromPayload(r as Record<string, unknown>));
  const result = await sqliteInsertBatch(records);
  sendResponse(result);
}

async function handleQuery(msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const payload = (msg as Extract<SqliteMessage, { type: 'SQLITE_QUERY' }>).payload as Record<string, unknown>;
  const options: import('../utils/sqlite-types.js').StorageQuery = pickDefined({
    limit: payload?.limit != null ? Number(payload.limit) : undefined,
    offset: payload?.offset != null ? Number(payload.offset) : undefined,
    orderBy: payload?.orderBy as 'created_at' | 'rank' | undefined,
    orderDir: payload?.orderDir as 'ASC' | 'DESC' | undefined,
    domain: payload?.domain != null ? String(payload.domain) : undefined,
    starred: payload?.starred != null ? Boolean(payload.starred) : payload?.isStarred != null ? Boolean(payload.isStarred) : undefined,
    excludeDeleted: payload?.excludeDeleted != null ? Boolean(payload.excludeDeleted) : undefined,
    dateFrom: payload?.dateFrom != null ? Number(payload.dateFrom) : payload?.since != null ? Number(payload.since) : undefined,
    dateTo: payload?.dateTo != null ? Number(payload.dateTo) : payload?.until != null ? Number(payload.until) : undefined,
    ids: payload?.ids != null ? (payload.ids as number[]) : undefined,
    tag: payload?.tag != null ? String(payload.tag) : payload?.tagFilter != null ? String(payload.tagFilter) : undefined,
    gistSynced: payload?.gistSynced != null ? Number(payload.gistSynced) : undefined,
  });
  const result = await sqliteQuery(options);
  sendResponse(result);
}

async function handleAuditLogInsert(msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const payload = (msg as Extract<SqliteMessage, { type: 'SQLITE_AUDIT_LOG_INSERT' }>).payload as Record<string, unknown>;
  const result = await sqliteInsertAuditLog({
    provider: String(payload.provider || ''),
    url: String(payload.url || ''),
    created_at: Number(payload.created_at || Date.now()),
  });
  sendResponse(result);
}

async function handleAuditLogQuery(msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const payload = (msg as Extract<SqliteMessage, { type: 'SQLITE_AUDIT_LOG_QUERY' }>).payload;
  const result = await sqliteQueryAuditLog(
    pickDefined({
      limit: payload?.limit != null ? Number(payload.limit) : undefined,
      offset: payload?.offset != null ? Number(payload.offset) : undefined,
    }),
  );
  sendResponse(result);
}

async function handleSearch(msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const p = (msg as Extract<SqliteMessage, { type: 'SQLITE_SEARCH' }>).payload;
  const q: import('../utils/sqlite-types.js').StorageQuery = {
    text: String(p.query || ''),
    ...pickDefined({
      limit: p.limit != null ? Number(p.limit) : undefined,
      offset: p.offset != null ? Number(p.offset) : undefined,
      orderBy: p.orderBy as 'created_at' | 'rank' | undefined,
      orderDir: p.orderDir as 'ASC' | 'DESC' | undefined,
    }),
  };
  const result = await sqliteQuery(q);
  sendResponse(result);
}

async function handleUpdate(msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const payload = (msg as Extract<SqliteMessage, { type: 'SQLITE_UPDATE' }>).payload as Record<string, unknown>;
  const id = Number(payload.id);
  const changes: Record<string, unknown> = {};
  for (const key of [
    'url',
    'title',
    'summary',
    'tags',
    'domain',
    'visit_duration',
    'scroll_ratio',
    'is_starred',
    'is_deleted',
    'obsidian_synced',
    'gist_synced',
    'content',
    'masked_count',
    'cleansed_reason',
    'ai_provider',
    'ai_model',
    'ai_duration_ms',
    'obsidian_duration_ms',
    'sent_tokens',
    'received_tokens',
    'original_tokens',
    'cleansed_tokens',
    'page_bytes',
    'candidate_bytes',
    'original_bytes',
    'cleansed_bytes',
    'ai_summary_original_bytes',
    'ai_summary_cleansed_bytes',
    'extracted_sentences_bytes',
    'extracted_sentences_original_bytes',
    'fallback_triggered',
  ]) {
    if (key in payload) {
      changes[key] = payload[key];
    }
  }
  const result = await sqliteUpdate(id, changes);
  sendResponse(result);
}

async function handleDelete(msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const id = Number((msg as Extract<SqliteMessage, { type: 'SQLITE_DELETE' }>).payload.id);
  const result = await sqliteHardDelete(id);
  sendResponse(result);
}

async function handleToggleStar(msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const id = Number((msg as Extract<SqliteMessage, { type: 'SQLITE_TOGGLE_STAR' }>).payload.id);
  const result = await sqliteToggleStar(id);
  sendResponse(result);
}

async function handleCount(_msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const result = await sqliteGetCount();
  sendResponse(result);
}

// Old-path constants — must match opfsMigrationV2Reader.ts / migrationBackup.ts
// exactly, since they name pre-migration storage locations that must never change.
const OLD_OPFS_POOL_DIR = 'yasumaro-opfs';
const OLD_OPFS_DB_FILENAME = 'yasumaro.db';
const OLD_IDB_NAME = 'idb-batch-atomic';

/** Origin Private File System has no path API — only directory/file existence can be checked. */
async function oldOpfsDbExists(): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OLD_OPFS_POOL_DIR, { create: false });
    await dir.getFileHandle(OLD_OPFS_DB_FILENAME, { create: false });
    return true;
  } catch {
    return false;
  }
}

async function oldIdbDbExists(): Promise<boolean> {
  try {
    const databases = await indexedDB.databases?.() ?? [];
    return databases.some((d) => d.name === OLD_IDB_NAME);
  } catch {
    return false;
  }
}

async function handleStatus(_msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const result = await sqliteGetStatus();
  if (result.success) {
    try {
      const [items, opfsLegacyExists, idbLegacyExists] = await Promise.all([
        chrome.storage.local.get([
          StorageKeys.OPFS_MIGRATION_V2_DONE,
          StorageKeys.OPFS_MIGRATION_V2_LAST_ATTEMPTED_AT,
          StorageKeys.OPFS_MIGRATION_V2_COMPLETED_AT,
          StorageKeys.OPFS_MIGRATION_V2_RECORD_COUNT,
          StorageKeys.IDB_MIGRATION_V2_DONE,
        ]),
        oldOpfsDbExists(),
        oldIdbDbExists(),
      ]);
      sendResponse({
        ...result,
        opfsMigrationV2Done: items[StorageKeys.OPFS_MIGRATION_V2_DONE] ?? false,
        opfsMigrationV2LastAttemptedAt: items[StorageKeys.OPFS_MIGRATION_V2_LAST_ATTEMPTED_AT] ?? null,
        opfsMigrationV2CompletedAt: items[StorageKeys.OPFS_MIGRATION_V2_COMPLETED_AT] ?? null,
        opfsMigrationV2RecordCount: items[StorageKeys.OPFS_MIGRATION_V2_RECORD_COUNT] ?? null,
        idbMigrationV2Done: items[StorageKeys.IDB_MIGRATION_V2_DONE] ?? false,
        opfsLegacyDbPath: opfsLegacyExists ? `${OLD_OPFS_POOL_DIR}/${OLD_OPFS_DB_FILENAME}` : null,
        idbLegacyDbName: idbLegacyExists ? OLD_IDB_NAME : null,
      });
    } catch {
      sendResponse(result);
    }
  } else {
    sendResponse(result);
  }
}

async function handleClearAll(_msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const result = await sqliteClearAll();
  sendResponse(result);
}

async function handleExport(_msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const result = await sqliteSerialize();
  sendResponse(result);
}

async function handleBackup(_msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const result = await sqliteBackupDb();
  if (result.success && result.data instanceof Uint8Array) {
    sendResponse({ success: true, data: Array.from(result.data) });
  } else {
    sendResponse(result);
  }
}

async function handleRestore(msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const rawData = (msg as Extract<SqliteMessage, { type: 'SQLITE_RESTORE' }>).payload.data || [];
  const data = new Uint8Array(rawData);
  const result = await sqliteRestoreDb(data);
  sendResponse(result.success ? { success: true } : { success: false, error: result.error });
}

async function handlePurge(msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const payload = (msg as Extract<SqliteMessage, { type: 'SQLITE_PURGE' }>).payload;
  const result = await sqlitePurgeOldRecords(payload?.retentionDays, payload?.maxRecords);
  sendResponse(result);
}

async function handleContentPurge(msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const payload = (msg as Extract<SqliteMessage, { type: 'CONTENT_PURGE' }>).payload;
  const result = await sqlitePurgeContent(payload?.retentionDays, payload?.maxRecords, payload?.includeStarred);
  sendResponse(result);
}

async function handleOpfsSpike(_msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const { runOpfsSpikeA } = await import('./opfsSpike.js');
  const report = await runOpfsSpikeA();
  sendResponse({ success: true, report });
}

/**
 * Static registry object — `satisfies` guarantees exhaustiveness at compile time.
 * Adding a new SqliteMessage variant without a handler is a type error.
 */
const handlerRecord = {
  SQLITE_HEALTH_CHECK: handleHealthCheck,
  SQLITE_INIT: handleInit,
  SQLITE_INSERT: handleInsert,
  SQLITE_INSERT_BATCH: handleInsertBatch,
  SQLITE_QUERY: handleQuery,
  SQLITE_AUDIT_LOG_INSERT: handleAuditLogInsert,
  SQLITE_AUDIT_LOG_QUERY: handleAuditLogQuery,
  SQLITE_SEARCH: handleSearch,
  SQLITE_UPDATE: handleUpdate,
  SQLITE_DELETE: handleDelete,
  SQLITE_TOGGLE_STAR: handleToggleStar,
  SQLITE_COUNT: handleCount,
  SQLITE_STATUS: handleStatus,
  SQLITE_CLEAR_ALL: handleClearAll,
  SQLITE_EXPORT: handleExport,
  SQLITE_BACKUP: handleBackup,
  SQLITE_RESTORE: handleRestore,
  SQLITE_PURGE: handlePurge,
  CONTENT_PURGE: handleContentPurge,
  SQLITE_OPFS_SPIKE: handleOpfsSpike,
} satisfies Record<SqliteMessageType, SqliteHandler>;

/**
 * Registry of all SQLite message handlers.
 * Adding a new SqliteMessage variant requires adding an entry here
 * and in SQLITE_MESSAGE_TYPES — the type checker enforces the coupling
 * via the exhaustive check in dispatch.
 */
export const sqliteMessageHandlers: Map<SqliteMessageType, SqliteHandler> = new Map(
  Object.entries(handlerRecord) as [SqliteMessageType, SqliteHandler][],
);
