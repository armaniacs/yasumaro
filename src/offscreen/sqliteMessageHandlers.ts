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
import { ARCHIVE_DESCRIPTORS, ARCHIVE_WIRE_TABLE, pickProjectedFields } from '../messaging/archiveWireTable.js';
import { SQLITE_WIRE_TABLE, type SqliteWireDescriptor, type SqliteWireOp } from '../messaging/sqliteWireTable.js';
import {
  insertAuditLog as sqliteInsertAuditLog,
  queryAuditLog as sqliteQueryAuditLog,
  purgeAuditLog as sqlitePurgeAuditLog,
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

/**
 * Shared wire runner (PBI 2026-10-20-23): receives its wire-table descriptor
 * row directly from the BY_MESSAGE-derived registry below instead of looking
 * the op up by string. The row is the dispatch key, so the former string
 * lookup and its unreachable unknown-op guard are gone — every caller is
 * built from a real table row.
 */
async function handleSqliteWire(row: SqliteWireDescriptor, msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
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

async function handleAuditLogPurge(msg: SqliteMessage, sendResponse: (r: unknown) => void): Promise<void> {
  const payload = (msg as Extract<SqliteMessage, { type: 'SQLITE_AUDIT_LOG_PURGE' }>).payload;
  // Same trust boundary as the other purges: a NaN/negative window makes
  // purgeCutoffMs NaN and would report "0 purged" while deleting nothing.
  // maxRecords 0 is the planner's "skip this dimension" marker — audit_log
  // has no cap dimension, the age filter is the whole purge.
  await runPlannedPurge({ ...payload, maxRecords: 0 }, sendResponse, (days) => sqlitePurgeAuditLog(days));
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

/**
 * Typed staging-backend callers (PBI 2026-10-20-23).
 *
 * handleArchive used to read the method off the backend with
 * `(stagingBackend as unknown as Record<string, unknown>)[entry.method]` and
 * re-bind it — a runtime string lookup that compiled even when a wire row
 * named a method the staging backend did not have. Each entry here invokes
 * the real backend method with its real parameter types, so a renamed or
 * removed method is a type error at this table instead of a runtime miss.
 * The Record forces all 14 ArchiveBackendMethods to be listed, and the
 * `_checkTableBackendMethods` assert above pins the wire-table rows to the
 * same union: a row whose method loses its caller fails to compile.
 *
 * Member calls bind `this` by construction, so the former unbound extraction
 * + .bind dance is gone. The WHY it carried — extracting the method unbound
 * drops `this` and OpfsWorkerBackend's archive methods read this.proxyArchive
 * (CI e2e @extension failure) — is structurally impossible now;
 * archiveWireDispatch.test.ts keeps the pin.
 */
type ArchiveStagingBackend = StorageBackend & ArchiveStaging;

type ArchiveBackendCaller = (
  backend: ArchiveStagingBackend,
  args: unknown[],
) => Promise<ArchiveBackendResult>;

const ARCHIVE_BACKEND_CALLS: Record<ArchiveBackendMethod, ArchiveBackendCaller> = {
  archivePreview: (backend, args) =>
    backend.archivePreview(...(args as Parameters<ArchiveStagingBackend['archivePreview']>)),
  archiveCreate: (backend, args) =>
    backend.archiveCreate(...(args as Parameters<ArchiveStagingBackend['archiveCreate']>)),
  archiveCleanup: (backend, args) =>
    backend.archiveCleanup(...(args as Parameters<ArchiveStagingBackend['archiveCleanup']>)),
  archiveExportChunk: (backend, args) =>
    backend.archiveExportChunk(...(args as Parameters<ArchiveStagingBackend['archiveExportChunk']>)),
  archivePrepareIncoming: (backend, args) =>
    backend.archivePrepareIncoming(...(args as Parameters<ArchiveStagingBackend['archivePrepareIncoming']>)),
  archiveRestorePreview: (backend, args) =>
    backend.archiveRestorePreview(...(args as Parameters<ArchiveStagingBackend['archiveRestorePreview']>)),
  archiveRestore: (backend, args) =>
    backend.archiveRestore(...(args as Parameters<ArchiveStagingBackend['archiveRestore']>)),
  archiveDeleteByStaging: (backend, args) =>
    backend.archiveDeleteByStaging(...(args as Parameters<ArchiveStagingBackend['archiveDeleteByStaging']>)),
  archiveOpen: (backend, args) =>
    backend.archiveOpen(...(args as Parameters<ArchiveStagingBackend['archiveOpen']>)),
  archiveQuery: (backend, args) =>
    backend.archiveQuery(...(args as Parameters<ArchiveStagingBackend['archiveQuery']>)),
  archiveUpdate: (backend, args) =>
    backend.archiveUpdate(...(args as Parameters<ArchiveStagingBackend['archiveUpdate']>)),
  archiveSave: (backend, args) =>
    backend.archiveSave(...(args as Parameters<ArchiveStagingBackend['archiveSave']>)),
  archiveClose: (backend, args) =>
    backend.archiveClose(...(args as Parameters<ArchiveStagingBackend['archiveClose']>)),
  archiveStatus: (backend, args) =>
    backend.archiveStatus(...(args as Parameters<ArchiveStagingBackend['archiveStatus']>)),
};

interface ArchiveDispatchEntry {
  call: ArchiveBackendCaller;
  args: (payload: Record<string, unknown>) => unknown[];
  /** Success-field projection; null means the backend returned no data. */
  pick: (result: { success: true; [field: string]: unknown }) => Record<string, unknown> | null;
  emptyError: string;
}

function archiveDispatchEntry(descriptor: ArchiveDescriptor): ArchiveDispatchEntry {
  return {
    // The `_checkTableBackendMethods` assert pins the rows' backendMethod
    // literals to the ArchiveBackendMethod union, so this lookup needs no cast.
    call: ARCHIVE_BACKEND_CALLS[descriptor.backendMethod],
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
  // supportsArchive narrowed `backend` to StorageBackend & ArchiveStaging; the
  // callers table invokes the method as a member call, so `this` stays bound
  // to the backend instance by construction.
  const result = await entry.call(backend, entry.args(payload));
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
 * BY_MESSAGE-derived wire registry entries (PBI 2026-10-20-23).
 *
 * The 9 `SQLITE_*` query/mutate lambdas used to be hand-written in
 * handlerRecord below, duplicating SQLITE_WIRE_TABLE's messageType⇔op
 * pairing op-for-op — the same drift class archiveMessageHandlers already
 * folded for the archive group. Each entry is now built from its table row:
 * the row owns the message type and the op, and the shared handleSqliteWire
 * runner owns the rest. Adding an op is one wire-table row (plus one repo
 * runner only when it needs a new repo call shape); a stale hand entry
 * cannot shadow the table.
 *
 * The 'search' row is excluded on purpose: its messageType is SQLITE_QUERY,
 * shared with 'records', and the SQLITE_QUERY handler must stay the records
 * runner — planQueryOrSearch routes the gateway's kind:'search' marker to
 * planSearch, while the search row would call planSearch unconditionally and
 * change the listing default (100 → 50). The search op keeps its
 * hand-written SQLITE_SEARCH handler below (sqliteWireTable.ts header note).
 * wireOpEnumerationDerived.test.ts pins the fold.
 */
type GatewayWireOp = Exclude<SqliteWireOp, 'search'>;
type GatewayWireMessageType = Extract<SqliteWireDescriptor, { op: GatewayWireOp }>['messageType'];

function isGatewayWireRow(row: SqliteWireDescriptor): row is Extract<SqliteWireDescriptor, { op: GatewayWireOp }> {
  return row.op !== 'search';
}

const wireMessageHandlers = Object.fromEntries(
  SQLITE_WIRE_TABLE.filter(isGatewayWireRow).map((row) => [
    row.messageType,
    ((msg: SqliteMessage, sendResponse: (response: unknown) => void) =>
      handleSqliteWire(row, msg, sendResponse)) as SqliteHandler,
  ]),
) as Record<GatewayWireMessageType, SqliteHandler>;

/**
 * BY_MESSAGE-derived archive registry entries (PBI 2026-10-16-08).
 *
 * The 14 `SQLITE_ARCHIVE_*` lambdas used to be hand-written in handlerRecord
 * below, duplicating the wire table op-for-op (same drift class ARCHIVE_DISPATCH
 * already folded). Each entry is now built from its table row: the row owns the
 * message type and the op, and the shared handleArchive runner owns the rest.
 * The keys mirror the BY_MESSAGE map (archiveWireForMessage) — a table row
 * without a registry entry, or a registry entry without a row, fails the
 * table-driven tests in archiveOpEnumerationDerived.test.ts.
 */
export const archiveMessageHandlers = Object.fromEntries(
  ARCHIVE_WIRE_TABLE.map((descriptor) => [
    descriptor.messageType,
    ((msg: SqliteMessage, sendResponse: (response: unknown) => void) =>
      handleArchive(descriptor.op, msg, sendResponse)) as SqliteHandler,
  ]),
) as Record<(typeof ARCHIVE_WIRE_TABLE)[number]['messageType'], SqliteHandler>;

/**
 * Static registry object — `satisfies` guarantees exhaustiveness at compile time.
 * Adding a new SqliteMessage variant without a handler is a type error.
 *
 * Query/mutate entries come from `wireMessageHandlers` (PBI 2026-10-20-23):
 * the 9 hand-written lambdas duplicated SQLITE_WIRE_TABLE op-for-op, so they
 * are now spread from the BY_MESSAGE-derived map — adding an op is one wire
 * row, and a stale hand entry cannot shadow the table.
 *
 * Archive entries come from `archiveMessageHandlers` below (PBI 2026-10-16-08):
 * the 14 hand-written lambdas duplicated the wire table op-for-op, so they
 * are now spread from the BY_MESSAGE-derived map — adding an op is one table
 * row, and a stale hand entry cannot shadow the table.
 */
const handlerRecord = {
  SQLITE_HEALTH_CHECK: handleHealthCheck,
  SQLITE_INIT: handleInit,
  ...wireMessageHandlers,
  SQLITE_AUDIT_LOG_PURGE: handleAuditLogPurge,
  SQLITE_SEARCH: handleSearch,
  SQLITE_STATUS: handleStatus,
  SQLITE_CLEAR_ALL: handleClearAll,
  SQLITE_BACKUP: handleBackup,
  SQLITE_RESTORE: handleRestore,
  SQLITE_PURGE: handlePurge,
  CONTENT_PURGE: handleContentPurge,
  ...archiveMessageHandlers,
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
