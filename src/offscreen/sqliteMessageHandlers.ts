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
import type { ArchiveDescriptor, ArchiveOpType } from '../messaging/archiveWireTable.js';
import { ARCHIVE_DESCRIPTORS, pickProjectedFields } from '../messaging/archiveWireTable.js';
import {
  insertAuditLog as sqliteInsertAuditLog,
  queryAuditLog as sqliteQueryAuditLog,
} from './auditLogRepo.js';
import { pickDefined } from '../utils/objectUtils.js';
import { planQuery, planSearch } from './queryPlanner.js';
import { ARCHIVE_UNSUPPORTED_ERROR } from './StorageBackend.js';
import { UPDATABLE_FIELDS } from './schema.js';
import { buildRecordFromPayload } from './browsingLogCodec.js';
import { collectMigrationExtras } from './sqliteStatus.js';
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
  const result = await sqliteQuery(planQuery(payload));
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
  const result = await sqliteQuery(planSearch(p as unknown as Record<string, unknown>));
  sendResponse(result);
}

async function handleUpdate(msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const payload = (msg as Extract<SqliteMessage, { type: 'SQLITE_UPDATE' }>).payload as Record<string, unknown>;
  const id = Number(payload.id);
  const changes: Record<string, unknown> = {};
  for (const key of UPDATABLE_FIELDS) {
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

// PBI 2026-09-11-06: STATUS enrichment (migration flags + legacy-DB probes)
// moved to sqliteStatus.ts — field-isolated collection + the SSOT legacy-path
// constants. This handler only merges the extras onto the backend's base shape.
async function handleStatus(_msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const result = await sqliteGetStatus();
  if (!result.success) {
    sendResponse(result);
    return;
  }
  const extras = await collectMigrationExtras();
  sendResponse({ ...result, ...extras });
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
 * Table-driven archive dispatch (PBI 2026-09-07-22, codec by 2026-09-09-05).
 *
 * The 14 archive handlers used to be hand-written 1:1 copies that differed
 * only in backend method, payload args, and response projection. Each entry
 * here is now a pure view over its wire-table descriptor — the method, the
 * arg builder, the projected fields, and the empty-success message all live
 * in the descriptor row. The Record<> still forces all 14 ops to be listed,
 * so a table row without a dispatch entry is a type error. Error strings
 * are unchanged.
 */
type ArchiveBackendMethod =
  | 'archivePreview' | 'archiveCreate' | 'archiveCleanup' | 'archiveExportChunk'
  | 'archivePrepareIncoming' | 'archiveRestorePreview' | 'archiveRestore'
  | 'archiveDeleteByStaging' | 'archiveOpen' | 'archiveQuery' | 'archiveUpdate'
  | 'archiveSave' | 'archiveClose' | 'archiveStatus';

type _TableBackendMethodsLive = ArchiveDescriptor['backendMethod'] extends ArchiveBackendMethod ? true : never;
const _checkTableBackendMethods: _TableBackendMethodsLive = true;

type ArchiveBackendResult = { success: true; [field: string]: unknown } | { success: false; error: string };

interface ArchiveDispatchEntry {
  method: ArchiveBackendMethod;
  args: (payload: Record<string, unknown>) => unknown[];
  /** Success-field projection; null means the backend returned no data. */
  pick: (result: { success: true; [field: string]: unknown }) => Record<string, unknown> | null;
  emptyError: string;
}

function archiveDispatchEntry(descriptor: ArchiveDescriptor): ArchiveDispatchEntry {
  return {
    method: descriptor.backendMethod as ArchiveBackendMethod,
    args: descriptor.backendArgs,
    pick: (result) => pickProjectedFields(result, descriptor),
    emptyError: descriptor.emptyError,
  };
}

const ARCHIVE_DISPATCH: Record<ArchiveOpType, ArchiveDispatchEntry> = {
  archivePreview: archiveDispatchEntry(ARCHIVE_DESCRIPTORS.archivePreview),
  archiveCreate: archiveDispatchEntry(ARCHIVE_DESCRIPTORS.archiveCreate),
  archiveCleanup: archiveDispatchEntry(ARCHIVE_DESCRIPTORS.archiveCleanup),
  archiveExport: archiveDispatchEntry(ARCHIVE_DESCRIPTORS.archiveExport),
  archivePrepareIncoming: archiveDispatchEntry(ARCHIVE_DESCRIPTORS.archivePrepareIncoming),
  archiveRestorePreview: archiveDispatchEntry(ARCHIVE_DESCRIPTORS.archiveRestorePreview),
  archiveRestore: archiveDispatchEntry(ARCHIVE_DESCRIPTORS.archiveRestore),
  archiveDeleteByStaging: archiveDispatchEntry(ARCHIVE_DESCRIPTORS.archiveDeleteByStaging),
  archiveOpen: archiveDispatchEntry(ARCHIVE_DESCRIPTORS.archiveOpen),
  archiveQuery: archiveDispatchEntry(ARCHIVE_DESCRIPTORS.archiveQuery),
  archiveUpdate: archiveDispatchEntry(ARCHIVE_DESCRIPTORS.archiveUpdate),
  archiveSave: archiveDispatchEntry(ARCHIVE_DESCRIPTORS.archiveSave),
  archiveClose: archiveDispatchEntry(ARCHIVE_DESCRIPTORS.archiveClose),
  archiveStatus: archiveDispatchEntry(ARCHIVE_DESCRIPTORS.archiveStatus),
};

async function handleArchive(op: ArchiveOpType, msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const entry = ARCHIVE_DISPATCH[op];
  const payload = (msg as { payload?: Record<string, unknown> }).payload ?? {};
  const backend = await engine.getBackend();
  // PBI 2026-09-11-06: archive lives behind ArchiveStaging, not StorageBackend.
  // Non-staging backends (IDB / fallback / noop) fail closed here — the same
  // error the per-adapter stubs used to return, now from one place. The check
  // is per-method so a backend is never asked for an op it does not implement.
  const raw = (backend as unknown as Record<string, unknown>)[entry.method];
  if (typeof raw !== 'function') {
    sendResponse({ success: false, error: ARCHIVE_UNSUPPORTED_ERROR });
    return;
  }
  // WHY: extracting the method unbound drops `this` — OpfsWorkerBackend's
  // archive methods read this.proxyArchive, so a bare call threw
  // "Cannot read properties of undefined (reading 'proxyArchive')" in
  // OPFS mode (e2e @extension suite). Bind before invoking.
  const call = (raw as (...args: unknown[]) => Promise<ArchiveBackendResult>).bind(backend);
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
