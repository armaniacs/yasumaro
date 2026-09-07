/**
 * sqliteMessageHandlers.ts
 * Registry of SQLite message handlers for the offscreen document.
 * Replaces the 24-case switch in offscreen.ts with a Map<SqliteMessageType, Handler>
 * plus a common payload-size guard middleware.
 */

import { engine } from './sqliteEngineHost.js';
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
import type { ArchiveOpType } from '../messaging/archiveWireTable.js';
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

/**
 * Table-driven archive dispatch (PBI 2026-09-07-22).
 *
 * The 14 archive handlers used to be hand-written 1:1 copies that differed
 * only in backend method, payload args, and response projection. Each row
 * here carries exactly that per-op knowledge; handleArchive below executes
 * the shared shape (call backend -> project success fields -> forward the
 * failure reason). Keyed by ArchiveOpType, so a new table op without a row
 * here is a type error. Error strings are unchanged.
 */
type ArchiveBackendMethod =
  | 'archivePreview' | 'archiveCreate' | 'archiveCleanup' | 'archiveExportChunk'
  | 'archivePrepareIncoming' | 'archiveRestorePreview' | 'archiveRestore'
  | 'archiveDeleteByStaging' | 'archiveOpen' | 'archiveQuery' | 'archiveUpdate'
  | 'archiveSave' | 'archiveClose' | 'archiveStatus';

type ArchiveBackendResult = { success: true; [field: string]: unknown } | { success: false; error: string };

interface ArchiveDispatchEntry {
  method: ArchiveBackendMethod;
  args: (payload: Record<string, unknown>) => unknown[];
  /** Success-field projection; null means the backend returned no data. */
  pick: (result: { success: true; [field: string]: unknown }) => Record<string, unknown> | null;
  emptyError: string;
}

const ARCHIVE_DISPATCH: Record<ArchiveOpType, ArchiveDispatchEntry> = {
  archivePreview: {
    method: 'archivePreview',
    args: (p) => [p['cutoffDate'] as string, p['cutoffMs'] as number, p['includeDeleted'] as boolean],
    pick: (r) => ('preview' in r ? { preview: r['preview'] } : null),
    emptyError: 'Archive preview returned no data',
  },
  archiveCreate: {
    method: 'archiveCreate',
    args: (p) => [p],
    pick: (r) => ('stagingName' in r ? { stagingName: r['stagingName'], recordCount: r['recordCount'] } : null),
    emptyError: 'Archive create returned no staging file',
  },
  archiveCleanup: {
    method: 'archiveCleanup',
    args: () => [],
    pick: (r) => ('removed' in r ? { removed: r['removed'] } : null),
    emptyError: 'Archive cleanup returned no data',
  },
  archiveExport: {
    method: 'archiveExportChunk',
    args: (p) => [p['stagingName'] as string, p['offset'] as number, p['length'] as number],
    pick: (r) => ('chunk' in r ? { chunk: r['chunk'], nextOffset: r['nextOffset'], total: r['total'], done: r['done'] } : null),
    emptyError: 'Archive export returned no data',
  },
  archivePrepareIncoming: {
    method: 'archivePrepareIncoming',
    args: () => [],
    pick: (r) => ('stagingName' in r ? { stagingName: r['stagingName'] } : null),
    emptyError: 'Archive prepare returned no staging name',
  },
  archiveRestorePreview: {
    method: 'archiveRestorePreview',
    args: (p) => [p['stagingName'] as string],
    pick: (r) => ('preview' in r ? { preview: r['preview'] } : null),
    emptyError: 'Archive restore preview returned no data',
  },
  archiveRestore: {
    method: 'archiveRestore',
    args: (p) => [p['stagingName'] as string],
    pick: (r) => ('restored' in r ? { restored: r['restored'], restoredDeleted: r['restoredDeleted'], skipped: r['skipped'], skippedInvalid: r['skippedInvalid'] } : null),
    emptyError: 'Archive restore returned no data',
  },
  archiveDeleteByStaging: {
    method: 'archiveDeleteByStaging',
    args: (p) => [p['stagingName'] as string],
    pick: (r) => ('deleted' in r ? { deleted: r['deleted'], remaining: r['remaining'], freelistBefore: r['freelistBefore'], freelistAfter: r['freelistAfter'], vacuumOk: r['vacuumOk'] } : null),
    emptyError: 'Archive purge returned no data',
  },
  archiveOpen: {
    method: 'archiveOpen',
    args: (p) => [p['stagingName'] as string],
    pick: () => ({}),
    emptyError: 'Archive open returned no data',
  },
  archiveQuery: {
    method: 'archiveQuery',
    args: (p) => [p['stagingName'] as string, p['query'] as string, p['limit'] as number, p['offset'] as number],
    pick: (r) => ('rows' in r ? { rows: r['rows'], total: r['total'] } : null),
    emptyError: 'Archive query returned no data',
  },
  archiveUpdate: {
    method: 'archiveUpdate',
    args: (p) => [p['stagingName'] as string, p['id'] as number, p['changes'] as Record<string, unknown>],
    pick: (r) => ('dirty' in r ? { dirty: r['dirty'] } : null),
    emptyError: 'Archive update returned no data',
  },
  archiveSave: {
    method: 'archiveSave',
    args: (p) => [p['stagingName'] as string],
    pick: (r) => ('dirty' in r ? { dirty: r['dirty'] } : null),
    emptyError: 'Archive save returned no data',
  },
  archiveClose: {
    method: 'archiveClose',
    args: (p) => [p['stagingName'] as string],
    pick: (r) => ('dirty' in r ? { dirty: r['dirty'] } : null),
    emptyError: 'Archive close returned no data',
  },
  archiveStatus: {
    method: 'archiveStatus',
    args: () => [],
    pick: (r) => ('status' in r ? { status: r['status'] } : null),
    emptyError: 'Archive status returned no data',
  },
};

async function handleArchive(op: ArchiveOpType, msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const entry = ARCHIVE_DISPATCH[op];
  const payload = (msg as { payload?: Record<string, unknown> }).payload ?? {};
  const backend = await engine.getBackend();
  const call = backend[entry.method] as unknown as (...args: unknown[]) => Promise<ArchiveBackendResult>;
  const result = await call(...entry.args(payload));
  if (!result.success) {
    sendResponse({ success: false, error: result.error });
    return;
  }
  const fields = entry.pick(result);
  if (fields === null) {
    sendResponse({ success: false, error: entry.emptyError });
    return;
  }
  sendResponse({ success: true, ...fields });
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
  SQLITE_ARCHIVE_PREVIEW: (msg, sendResponse) => handleArchive('archivePreview', msg, sendResponse),
  SQLITE_ARCHIVE_CREATE: (msg, sendResponse) => handleArchive('archiveCreate', msg, sendResponse),
  SQLITE_ARCHIVE_CLEANUP: (msg, sendResponse) => handleArchive('archiveCleanup', msg, sendResponse),
  SQLITE_ARCHIVE_EXPORT: (msg, sendResponse) => handleArchive('archiveExport', msg, sendResponse),
  SQLITE_ARCHIVE_PREPARE_INCOMING: (msg, sendResponse) => handleArchive('archivePrepareIncoming', msg, sendResponse),
  SQLITE_ARCHIVE_RESTORE_PREVIEW: (msg, sendResponse) => handleArchive('archiveRestorePreview', msg, sendResponse),
  SQLITE_ARCHIVE_RESTORE: (msg, sendResponse) => handleArchive('archiveRestore', msg, sendResponse),
  SQLITE_ARCHIVE_DELETE_BY_STAGING: (msg, sendResponse) => handleArchive('archiveDeleteByStaging', msg, sendResponse),
  SQLITE_ARCHIVE_OPEN: (msg, sendResponse) => handleArchive('archiveOpen', msg, sendResponse),
  SQLITE_ARCHIVE_QUERY: (msg, sendResponse) => handleArchive('archiveQuery', msg, sendResponse),
  SQLITE_ARCHIVE_UPDATE: (msg, sendResponse) => handleArchive('archiveUpdate', msg, sendResponse),
  SQLITE_ARCHIVE_SAVE: (msg, sendResponse) => handleArchive('archiveSave', msg, sendResponse),
  SQLITE_ARCHIVE_CLOSE: (msg, sendResponse) => handleArchive('archiveClose', msg, sendResponse),
  SQLITE_ARCHIVE_STATUS: (msg, sendResponse) => handleArchive('archiveStatus', msg, sendResponse),
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
