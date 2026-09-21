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
import { sqliteWireFor, type SqliteWireDescriptor, type SqliteWireOp } from '../messaging/sqliteWireTable.js';
import {
  insertAuditLog as sqliteInsertAuditLog,
  queryAuditLog as sqliteQueryAuditLog,
} from './auditLogRepo.js';
import { pickDefined } from '../utils/objectUtils.js';
import { planPurge, planQueryOrSearch, planSearch } from './queryPlanner.js';
import { ARCHIVE_UNSUPPORTED_ERROR, type StorageBackend } from './StorageBackend.js';
import { supportsArchive, type ArchiveStaging } from './archiveStaging.js';
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

/**
 * Table-driven query/mutate dispatch (PBI 2026-09-20-16).
 *
 * The 10 query/mutate handlers used to be hand-written 1:1 copies that
 * differed only in repo call, payload coercion, and planner. Each entry here
 * is now a pure view over its wire-table descriptor — the row names the
 * runner, and the runner owns the layer-specific preprocessing (record
 * codec, planners, UPDATABLE_FIELDS filter, id coercion) that the neutral
 * table must not import. Adding an op is one table row, plus one runner only
 * when it needs a new repo call shape.
 *
 * SQLITE_SEARCH is intentionally NOT tabled: no QueryOp reaches it through
 * the gateway (kind:'search' folds into SQLITE_QUERY), so it keeps its
 * hand-written handler below.
 */
export type SqliteRepoMethod =
  | 'insert' | 'insertBatch' | 'query' | 'search' | 'count'
  | 'update' | 'delete' | 'toggleStar' | 'insertAuditLog' | 'auditLogQuery';

type _TableRepoMethodsLive = SqliteWireDescriptor['repoMethod'] extends SqliteRepoMethod ? true : never;
const _checkTableRepoMethods: _TableRepoMethodsLive = true;

const SQLITE_REPO_RUNNERS: Record<SqliteRepoMethod, (payload: Record<string, unknown>) => Promise<unknown>> = {
  insert: (payload) => sqliteInsert(buildRecordFromPayload(payload)),
  insertBatch: (payload) => sqliteInsertBatch(
    (((payload.records as Record<string, unknown>[] | undefined) || []) as Record<string, unknown>[]).map((r) => buildRecordFromPayload(r)),
  ),
  query: (payload) => {
    // Route decision lives in queryPlanner.planQueryOrSearch (Checking Team
    // 2026-09-22: Legacy Bridge Medium) — the gateway folds search into
    // SQLITE_QUERY with a kind marker and planSearch owns the search default.
    return sqliteQuery(planQueryOrSearch(payload));
  },
  search: (payload) => sqliteQuery(planSearch(payload)),
  count: () => sqliteGetCount(),
  update: (payload) => {
    const id = Number(payload.id);
    const changes: Record<string, unknown> = {};
    for (const key of UPDATABLE_FIELDS) {
      if (key in payload) {
        changes[key] = payload[key];
      }
    }
    return sqliteUpdate(id, changes);
  },
  delete: (payload) => sqliteHardDelete(Number(payload.id)),
  toggleStar: (payload) => sqliteToggleStar(Number(payload.id)),
  insertAuditLog: (payload) => sqliteInsertAuditLog({
    provider: String(payload.provider || ''),
    url: String(payload.url || ''),
    created_at: Number(payload.created_at || Date.now()),
  }),
  auditLogQuery: (payload) => sqliteQueryAuditLog(
    pickDefined({
      limit: payload?.limit != null ? Number(payload.limit) : undefined,
      offset: payload?.offset != null ? Number(payload.offset) : undefined,
    }),
  ),
};

async function handleSqliteWire(op: SqliteWireOp, msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const row = sqliteWireFor(op);
  if (!row) {
    sendResponse({ success: false, error: `Unknown sqlite op: ${op}` });
    return;
  }
  const payload = (msg as { payload?: Record<string, unknown> }).payload ?? {};
  const run = SQLITE_REPO_RUNNERS[row.repoMethod as SqliteRepoMethod];
  sendResponse(await run(payload));
}

async function handleSearch(msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const p = (msg as Extract<SqliteMessage, { type: 'SQLITE_SEARCH' }>).payload;
  const result = await sqliteQuery(planSearch(p as unknown as Record<string, unknown>));
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

/**
 * Planned-purge runner shared by handlePurge/handleContentPurge
 * (PBI 2026-09-18-08). The trust boundary for destructive purges —
 * garbage numbers fail closed instead of silently purging nothing.
 * Pinned by sqliteHandlers-twins-parity.test.ts.
 */
async function runPlannedPurge(
  payload: { retentionDays?: unknown; maxRecords?: unknown; includeStarred?: unknown } | undefined | null,
  sendResponse: (r: unknown) => void,
  purge: (
    retentionDays: number | undefined,
    maxRecords: number | undefined,
    includeStarred?: boolean | undefined,
  ) => Promise<unknown>,
  includeStarred?: boolean,
): Promise<void> {
  const planned = planPurge(payload?.retentionDays, payload?.maxRecords, includeStarred);
  if (!planned.ok) {
    sendResponse({ success: false, error: planned.error });
    return;
  }
  // SQLITE_PURGE passes no includeStarred (undefined); CONTENT_PURGE forwards
  // the payload value — the narrowed planned.includeStarred carries it.
  // The purge callback preserves the original call arity (2 args for
  // purgeOldRecords, 3 for purgeContent) — callers wrap the repo function.
  const result = await purge(planned.retentionDays, planned.maxRecords, planned.includeStarred);
  sendResponse(result);
}

async function handlePurge(msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const payload = (msg as Extract<SqliteMessage, { type: 'SQLITE_PURGE' }>).payload;
  // PBI 2026-09-12-19: the trust boundary for the destructive purge —
  // garbage numbers fail closed instead of silently purging nothing.
  // The arrow wrapper preserves the original 2-arg call arity.
  await runPlannedPurge(payload, sendResponse, (days, max) => sqlitePurgeOldRecords(days, max));
}

async function handleContentPurge(msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const payload = (msg as Extract<SqliteMessage, { type: 'CONTENT_PURGE' }>).payload;
  // The arrow wrapper preserves the original 3-arg call arity.
  await runPlannedPurge(
    payload,
    sendResponse,
    (days, max, starred) => sqlitePurgeContent(days, max, starred),
    payload?.includeStarred,
  );
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

// Derived from the wire table (PBI 2026-09-15-04): the per-op hand-written
// enumeration duplicated ARCHIVE_DESCRIPTORS op-for-op. Adding an op is now a
// single table row.
const ARCHIVE_DISPATCH = Object.fromEntries(
  (Object.keys(ARCHIVE_DESCRIPTORS) as ArchiveOpType[]).map((op) => [op, archiveDispatchEntry(ARCHIVE_DESCRIPTORS[op])]),
) as Record<ArchiveOpType, ArchiveDispatchEntry>;

async function handleArchive(op: ArchiveOpType, msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const entry = ARCHIVE_DISPATCH[op];
  const payload = (msg as { payload?: Record<string, unknown> }).payload ?? {};
  const backend = await engine.getBackend();
  // PBI 2026-09-11-06: archive lives behind ArchiveStaging, not StorageBackend.
  // PBI 2026-09-12-32: narrowing uses the exported `supportsArchive` seam (one
  // rule — the former inline per-method probe duplicated it and the
  // StorageBackend comments documented the wrong spelling). Non-staging
  // backends (IDB / fallback / noop) fail closed here — the same error the
  // per-adapter stubs used to return, now from one place.
  if (!supportsArchive(backend)) {
    sendResponse({ success: false, error: ARCHIVE_UNSUPPORTED_ERROR });
    return;
  }
  const stagingBackend = backend as StorageBackend & ArchiveStaging;
  // WHY: extracting the method unbound drops `this` — OpfsWorkerBackend's
  // archive methods read this.proxyArchive, so a bare call threw
  // "Cannot read properties of undefined (reading 'proxyArchive')" in
  // OPFS mode (e2e @extension suite). Bind before invoking.
  const raw = (stagingBackend as unknown as Record<string, unknown>)[entry.method];
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
  SQLITE_INSERT: (msg, sendResponse) => handleSqliteWire('insert', msg, sendResponse),
  SQLITE_INSERT_BATCH: (msg, sendResponse) => handleSqliteWire('insertBatch', msg, sendResponse),
  SQLITE_QUERY: (msg, sendResponse) => handleSqliteWire('records', msg, sendResponse),
  SQLITE_AUDIT_LOG_INSERT: (msg, sendResponse) => handleSqliteWire('insertAuditLog', msg, sendResponse),
  SQLITE_AUDIT_LOG_QUERY: (msg, sendResponse) => handleSqliteWire('auditLog', msg, sendResponse),
  SQLITE_SEARCH: handleSearch,
  SQLITE_UPDATE: (msg, sendResponse) => handleSqliteWire('update', msg, sendResponse),
  SQLITE_DELETE: (msg, sendResponse) => handleSqliteWire('delete', msg, sendResponse),
  SQLITE_TOGGLE_STAR: (msg, sendResponse) => handleSqliteWire('toggleStar', msg, sendResponse),
  SQLITE_COUNT: (msg, sendResponse) => handleSqliteWire('count', msg, sendResponse),
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
