/**
 * archiveWireTable.ts
 *
 * Single routing + codec table for the 14 archive ops (PBI 2026-09-07-22,
 * extended to a codec by PBI 2026-09-09-05).
 *
 * Each archive subtype used to be mapped 1:1 by hand in every hop
 * (gateway switch, dbMaintenance forwarders, backend methods, worker
 * dispatch), so adding a subtype required editing 7 files and copy-paste
 * drift already produced three duplicated declaration blocks. The routing
 * half of that collapse lives here; the response-shape half used to be
 * re-derived in five more places (dashboard decode x14, background
 * re-projection x14, offscreen pick, worker project lambda x14, result
 * interface x14). Each row is now an ArchiveOpDescriptor that also carries
 * the codec — every hop derives its shape from the row, so adding an op
 * is one table row.
 *
 * Neutral placement: both background (gateway) and offscreen (handlers)
 * already depend on messaging, while background -> offscreen imports are
 * forbidden — so this file must not import from offscreen or background.
 * Worker type strings are kept as literals and synced to
 * WORKER_MESSAGE_TYPES by test (no offscreen import in production code).
 * Dashboard protocol shapes are likewise not imported (background-owned);
 * decodes operate on the wire field sets both sides already agree on.
 */

import type { MaintainOp } from './sqliteRpcClient.js';
import type { SqliteMessage, SqliteMessageType } from './sqliteMessages.js';
import type {
  ArchiveCreateData,
  ArchiveExportData,
  ArchivePreviewData,
  ArchivePurgeData,
  ArchiveRestoreData,
  ArchiveRestorePreviewData,
  ArchiveSessionRow,
  ArchiveSessionStatusData,
} from './sqliteMessages.js';
import type { DashboardSqliteSubtype } from './sqliteOperationSecurity.js';

/** Dashboard subtypes owned by the archive group. */
export type DashboardArchiveSubtype = Extract<DashboardSqliteSubtype, `archive_${string}`>;

/**
 * Codec carried by one wire-table row.
 *
 * S is the MaintainOp discriminator, R the dashboard public value produced
 * by decodeResponse. The remaining per-hop codecs share the loose record
 * level on purpose: the table sits in neutral messaging territory and must
 * not import background/offscreen types, so precise per-hop signatures
 * would couple it to the layers it is meant to decouple.
 */
export interface ArchiveOpDescriptor<S extends string = string, R = unknown> {
  /** MaintainOp discriminator (source of truth is the MaintainOp union). */
  op: S;
  /** Dashboard DASHBOARD_SQLITE subtype (snake_case twin of op). */
  subtype: DashboardArchiveSubtype;
  /** background -> offscreen message type. */
  messageType: SqliteMessageType;
  /** offscreen -> OPFS worker type. */
  workerType: string;
  /** Bulk or state-changing ops where a blind retry would double-execute. */
  noRetry: boolean;
  /** StorageBackend method the offscreen dispatch calls. */
  backendMethod: string;
  /** ArchiveDeps method the background handler calls. */
  depsMethod: string;
  /** Success fields every hop projects; empty means the op returns no data. */
  projectFields: readonly string[];
  /** Historical error when a backend success carries none of the fields. */
  emptyError: string;
  /** Dashboard fallback message when the failure carries no reason. */
  defaultError: string;
  /** Background payload shape check; null means the payload is acceptable. */
  validate: (payload: Record<string, unknown>) => string | null;
  /** Builds the MaintainOp the background deps send to SqliteClient. */
  encodeRequest: (...args: never[]) => MaintainOp;
  /** Decodes the wire success shape into the dashboard public value. */
  decodeResponse: (response: { success: true } & Record<string, unknown>) => R;
  /** Positional backend args the offscreen dispatch spreads. */
  backendArgs: (payload: Record<string, unknown>) => unknown[];
  /** Deps args the background handler spreads (normalizes loose flags). */
  depsArgs: (payload: Record<string, unknown>) => unknown[];
  /** Projects a worker raw result into the wire field set. */
  project: (raw: unknown) => Record<string, unknown>;
  /** Projects deps data into the wire field set; defaults to project. */
  projectDeps?: (data: unknown) => Record<string, unknown>;
}

/** Single constructor for table rows; preserves literal types per row. */
export function defineArchiveOp<const R extends ArchiveOpDescriptor<string, unknown>>(row: R): R {
  return row;
}

export const ARCHIVE_WIRE_TABLE = [
  defineArchiveOp({
    op: 'archivePreview',
    subtype: 'archive_preview',
    messageType: 'SQLITE_ARCHIVE_PREVIEW',
    workerType: 'ARCHIVE_PREVIEW',
    noRetry: false,
    backendMethod: 'archivePreview',
    depsMethod: 'archivePreview',
    projectFields: ['preview'],
    emptyError: 'Archive preview returned no data',
    defaultError: 'Archive preview failed',
    validate: (p) => {
      if (typeof p.cutoffDate !== 'string' || p.cutoffDate.length === 0) {
        return 'archive_preview: cutoffDate is required';
      }
      if (typeof p.cutoffMs !== 'number' || !Number.isFinite(p.cutoffMs) || p.cutoffMs <= 0) {
        return 'archive_preview: cutoffMs must be a positive number';
      }
      return null;
    },
    encodeRequest: (
      cutoffDate: string,
      cutoffMs: number,
      includeDeleted: boolean,
    ): Extract<MaintainOp, { type: 'archivePreview' }> => ({ type: 'archivePreview', cutoffDate, cutoffMs, includeDeleted }),
    decodeResponse: (response) => {
      const preview = response.preview as ArchivePreviewData | undefined;
      if (!preview) throw new Error('Archive preview returned no data');
      return preview;
    },
    backendArgs: (p) => [p.cutoffDate as string, p.cutoffMs as number, p.includeDeleted as boolean],
    depsArgs: (p) => [p.cutoffDate as string, p.cutoffMs as number, p.includeDeleted === true],
    project: (raw) => ({ preview: raw as ArchivePreviewData }),
  }),
  defineArchiveOp({
    op: 'archiveCreate',
    subtype: 'archive_create',
    messageType: 'SQLITE_ARCHIVE_CREATE',
    workerType: 'ARCHIVE_CREATE',
    noRetry: true,
    backendMethod: 'archiveCreate',
    depsMethod: 'archiveCreate',
    projectFields: ['stagingName', 'recordCount'],
    emptyError: 'Archive create returned no staging file',
    defaultError: 'Archive creation failed',
    validate: (p) => {
      if (typeof p.cutoffDate !== 'string' || p.cutoffDate.length === 0) {
        return 'archive_create: cutoffDate is required';
      }
      if (typeof p.cutoffMs !== 'number' || !Number.isFinite(p.cutoffMs) || p.cutoffMs <= 0) {
        return 'archive_create: cutoffMs must be a positive number';
      }
      return null;
    },
    encodeRequest: (params: {
      cutoffDate: string;
      cutoffMs: number;
      includeDeleted: boolean;
      yasumaroVersion: string;
    }): Extract<MaintainOp, { type: 'archiveCreate' }> => ({ type: 'archiveCreate', ...params }),
    decodeResponse: (response) => {
      const stagingName = response.stagingName as string | undefined;
      if (!stagingName) throw new Error('Archive create returned no staging file');
      return { stagingName, recordCount: response.recordCount as number };
    },
    backendArgs: (p) => [p],
    depsArgs: (p) => [{
      cutoffDate: p.cutoffDate as string,
      cutoffMs: p.cutoffMs as number,
      includeDeleted: p.includeDeleted === true,
      yasumaroVersion: p.yasumaroVersion as string,
    }],
    project: (raw) => {
      const r = raw as ArchiveCreateData;
      return { stagingName: r.stagingName, recordCount: r.recordCount };
    },
  }),
  defineArchiveOp({
    op: 'archiveCleanup',
    subtype: 'archive_cleanup',
    messageType: 'SQLITE_ARCHIVE_CLEANUP',
    workerType: 'ARCHIVE_CLEANUP',
    noRetry: false,
    backendMethod: 'archiveCleanup',
    depsMethod: 'archiveCleanup',
    projectFields: ['removed'],
    emptyError: 'Archive cleanup returned no data',
    defaultError: 'Archive cleanup failed',
    validate: () => null,
    encodeRequest: (): Extract<MaintainOp, { type: 'archiveCleanup' }> => ({ type: 'archiveCleanup' }),
    decodeResponse: (response) => ({ removed: response.removed as string[] }),
    backendArgs: () => [],
    depsArgs: () => [],
    project: (raw) => ({ removed: (raw as { removed: string[] }).removed }),
  }),
  defineArchiveOp({
    op: 'archiveExport',
    subtype: 'archive_export',
    messageType: 'SQLITE_ARCHIVE_EXPORT',
    workerType: 'ARCHIVE_EXPORT',
    noRetry: false,
    backendMethod: 'archiveExportChunk',
    depsMethod: 'archiveExportChunk',
    projectFields: ['chunk', 'nextOffset', 'total', 'done'],
    emptyError: 'Archive export returned no data',
    defaultError: 'Archive export failed',
    validate: (p) => {
      if (typeof p.offset !== 'number' || !Number.isInteger(p.offset) || p.offset < 0) {
        return 'archive_export: offset must be a non-negative integer';
      }
      if (typeof p.length !== 'number' || !Number.isFinite(p.length) || p.length < 1) {
        return 'archive_export: length must be a positive number';
      }
      return null;
    },
    encodeRequest: (
      stagingName: string,
      offset: number,
      length: number,
    ): Extract<MaintainOp, { type: 'archiveExport' }> => ({ type: 'archiveExport', stagingName, offset, length }),
    decodeResponse: (response) => ({
      chunk: response.chunk as number[],
      nextOffset: response.nextOffset as number,
      total: response.total as number,
      done: response.done as boolean,
    }),
    backendArgs: (p) => [p.stagingName as string, p.offset as number, p.length as number],
    depsArgs: (p) => [p.stagingName as string, p.offset as number, p.length as number],
    project: (raw) => {
      const r = raw as ArchiveExportData;
      return { chunk: r.chunk, nextOffset: r.nextOffset, total: r.total, done: r.done };
    },
  }),
  defineArchiveOp({
    op: 'archivePrepareIncoming',
    subtype: 'archive_prepare_incoming',
    messageType: 'SQLITE_ARCHIVE_PREPARE_INCOMING',
    workerType: 'ARCHIVE_PREPARE_INCOMING',
    noRetry: false,
    backendMethod: 'archivePrepareIncoming',
    depsMethod: 'archivePrepareIncoming',
    projectFields: ['stagingName'],
    emptyError: 'Archive prepare returned no staging name',
    defaultError: 'Archive preparation failed',
    validate: () => null,
    encodeRequest: (): Extract<MaintainOp, { type: 'archivePrepareIncoming' }> => ({ type: 'archivePrepareIncoming' }),
    decodeResponse: (response) => {
      const stagingName = response.stagingName as string | undefined;
      if (!stagingName) throw new Error('Archive prepare returned no staging name');
      return stagingName;
    },
    backendArgs: () => [],
    depsArgs: () => [],
    project: (raw) => ({ stagingName: (raw as { stagingName: string }).stagingName }),
    projectDeps: (data) => ({ stagingName: data as string }),
  }),
  defineArchiveOp({
    op: 'archiveRestorePreview',
    subtype: 'archive_restore_preview',
    messageType: 'SQLITE_ARCHIVE_RESTORE_PREVIEW',
    workerType: 'ARCHIVE_RESTORE_PREVIEW',
    noRetry: false,
    backendMethod: 'archiveRestorePreview',
    depsMethod: 'archiveRestorePreview',
    projectFields: ['preview'],
    emptyError: 'Archive restore preview returned no data',
    defaultError: 'Archive restore preview failed',
    validate: () => null,
    encodeRequest: (stagingName: string): Extract<MaintainOp, { type: 'archiveRestorePreview' }> => ({
      type: 'archiveRestorePreview',
      stagingName,
    }),
    decodeResponse: (response) => {
      const preview = response.preview as ArchiveRestorePreviewData | undefined;
      if (!preview) throw new Error('Archive restore preview returned no data');
      return preview;
    },
    backendArgs: (p) => [p.stagingName as string],
    depsArgs: (p) => [p.stagingName as string],
    project: (raw) => ({ preview: raw as ArchiveRestorePreviewData }),
  }),
  defineArchiveOp({
    op: 'archiveRestore',
    subtype: 'archive_restore',
    messageType: 'SQLITE_ARCHIVE_RESTORE',
    workerType: 'ARCHIVE_RESTORE',
    noRetry: true,
    backendMethod: 'archiveRestore',
    depsMethod: 'archiveRestore',
    projectFields: ['restored', 'restoredDeleted', 'skipped', 'skippedInvalid'],
    emptyError: 'Archive restore returned no data',
    defaultError: 'Archive restore failed',
    validate: () => null,
    encodeRequest: (stagingName: string): Extract<MaintainOp, { type: 'archiveRestore' }> => ({
      type: 'archiveRestore',
      stagingName,
    }),
    decodeResponse: (response) => ({
      restored: response.restored as number,
      restoredDeleted: response.restoredDeleted as number,
      skipped: response.skipped as number,
      skippedInvalid: response.skippedInvalid as number,
    }),
    backendArgs: (p) => [p.stagingName as string],
    depsArgs: (p) => [p.stagingName as string],
    project: (raw) => {
      const r = raw as ArchiveRestoreData;
      return { restored: r.restored, restoredDeleted: r.restoredDeleted, skipped: r.skipped, skippedInvalid: r.skippedInvalid };
    },
  }),
  defineArchiveOp({
    op: 'archiveDeleteByStaging',
    subtype: 'archive_delete_by_staging',
    messageType: 'SQLITE_ARCHIVE_DELETE_BY_STAGING',
    workerType: 'ARCHIVE_DELETE_BY_STAGING',
    noRetry: true,
    backendMethod: 'archiveDeleteByStaging',
    depsMethod: 'archiveDeleteByStaging',
    projectFields: ['deleted', 'remaining', 'freelistBefore', 'freelistAfter', 'vacuumOk'],
    emptyError: 'Archive purge returned no data',
    defaultError: 'Archive purge failed',
    validate: () => null,
    encodeRequest: (stagingName: string): Extract<MaintainOp, { type: 'archiveDeleteByStaging' }> => ({
      type: 'archiveDeleteByStaging',
      stagingName,
    }),
    decodeResponse: (response) => ({
      deleted: response.deleted as number,
      remaining: response.remaining as number,
      freelistBefore: response.freelistBefore as number,
      freelistAfter: response.freelistAfter as number,
      vacuumOk: response.vacuumOk as boolean,
    }),
    backendArgs: (p) => [p.stagingName as string],
    depsArgs: (p) => [p.stagingName as string],
    project: (raw) => {
      const r = raw as ArchivePurgeData;
      return {
        deleted: r.deleted,
        remaining: r.remaining,
        freelistBefore: r.freelistBefore,
        freelistAfter: r.freelistAfter,
        vacuumOk: r.vacuumOk,
      };
    },
  }),
  defineArchiveOp({
    op: 'archiveOpen',
    subtype: 'archive_open',
    messageType: 'SQLITE_ARCHIVE_OPEN',
    workerType: 'ARCHIVE_OPEN',
    noRetry: true,
    backendMethod: 'archiveOpen',
    depsMethod: 'archiveOpen',
    projectFields: [],
    emptyError: 'Archive open returned no data',
    defaultError: 'Archive open failed',
    validate: () => null,
    encodeRequest: (stagingName: string): Extract<MaintainOp, { type: 'archiveOpen' }> => ({
      type: 'archiveOpen',
      stagingName,
    }),
    decodeResponse: () => undefined,
    backendArgs: (p) => [p.stagingName as string],
    depsArgs: (p) => [p.stagingName as string],
    project: () => ({}),
  }),
  defineArchiveOp({
    op: 'archiveQuery',
    subtype: 'archive_query',
    messageType: 'SQLITE_ARCHIVE_QUERY',
    workerType: 'ARCHIVE_QUERY',
    noRetry: false,
    backendMethod: 'archiveQuery',
    depsMethod: 'archiveQuery',
    projectFields: ['rows', 'total'],
    emptyError: 'Archive query returned no data',
    defaultError: 'Archive query failed',
    validate: (p) => {
      if (typeof p.query !== 'string') return 'archive_query: query must be string';
      if (typeof p.limit !== 'number' || !Number.isInteger(p.limit) || p.limit < 1 || p.limit > 500) {
        return 'archive_query: limit must be 1..500';
      }
      if (typeof p.offset !== 'number' || !Number.isInteger(p.offset) || p.offset < 0) {
        return 'archive_query: offset must be a non-negative integer';
      }
      return null;
    },
    encodeRequest: (
      stagingName: string,
      query: string,
      limit: number,
      offset: number,
    ): Extract<MaintainOp, { type: 'archiveQuery' }> => ({ type: 'archiveQuery', stagingName, query, limit, offset }),
    decodeResponse: (response) => ({
      rows: response.rows as ArchiveSessionRow[],
      total: response.total as number,
    }),
    backendArgs: (p) => [p.stagingName as string, p.query as string, p.limit as number, p.offset as number],
    depsArgs: (p) => [p.stagingName as string, p.query as string, p.limit as number, p.offset as number],
    project: (raw) => {
      const r = raw as { rows: ArchiveSessionRow[]; total: number };
      return { rows: r.rows, total: r.total };
    },
  }),
  defineArchiveOp({
    op: 'archiveUpdate',
    subtype: 'archive_update',
    messageType: 'SQLITE_ARCHIVE_UPDATE',
    workerType: 'ARCHIVE_UPDATE',
    noRetry: false,
    backendMethod: 'archiveUpdate',
    depsMethod: 'archiveUpdate',
    projectFields: ['dirty'],
    emptyError: 'Archive update returned no data',
    defaultError: 'Archive update failed',
    validate: (p) => {
      if (typeof p.id !== 'number' || !Number.isInteger(p.id) || p.id <= 0) {
        return 'archive_update: id must be a positive integer';
      }
      if (!p.changes || typeof p.changes !== 'object' || Array.isArray(p.changes)) {
        return 'archive_update: changes must be an object';
      }
      return null;
    },
    encodeRequest: (
      stagingName: string,
      id: number,
      changes: Record<string, unknown>,
    ): Extract<MaintainOp, { type: 'archiveUpdate' }> => ({ type: 'archiveUpdate', stagingName, id, changes }),
    decodeResponse: (response) => ({ dirty: response.dirty as boolean }),
    backendArgs: (p) => [p.stagingName as string, p.id as number, p.changes as Record<string, unknown>],
    depsArgs: (p) => [p.stagingName as string, p.id as number, p.changes as Record<string, unknown>],
    project: (raw) => ({ dirty: (raw as { dirty: boolean }).dirty }),
  }),
  defineArchiveOp({
    op: 'archiveSave',
    subtype: 'archive_save',
    messageType: 'SQLITE_ARCHIVE_SAVE',
    workerType: 'ARCHIVE_SAVE',
    noRetry: true,
    backendMethod: 'archiveSave',
    depsMethod: 'archiveSave',
    projectFields: ['dirty'],
    emptyError: 'Archive save returned no data',
    defaultError: 'Archive save failed',
    validate: () => null,
    encodeRequest: (stagingName: string): Extract<MaintainOp, { type: 'archiveSave' }> => ({
      type: 'archiveSave',
      stagingName,
    }),
    decodeResponse: (response) => ({ dirty: response.dirty as boolean }),
    backendArgs: (p) => [p.stagingName as string],
    depsArgs: (p) => [p.stagingName as string],
    project: (raw) => ({ dirty: (raw as { dirty: boolean }).dirty }),
  }),
  defineArchiveOp({
    op: 'archiveClose',
    subtype: 'archive_close',
    messageType: 'SQLITE_ARCHIVE_CLOSE',
    workerType: 'ARCHIVE_CLOSE',
    noRetry: true,
    backendMethod: 'archiveClose',
    depsMethod: 'archiveClose',
    projectFields: ['dirty'],
    emptyError: 'Archive close returned no data',
    defaultError: 'Archive close failed',
    validate: () => null,
    encodeRequest: (stagingName: string): Extract<MaintainOp, { type: 'archiveClose' }> => ({
      type: 'archiveClose',
      stagingName,
    }),
    decodeResponse: (response) => ({ dirty: response.dirty as boolean }),
    backendArgs: (p) => [p.stagingName as string],
    depsArgs: (p) => [p.stagingName as string],
    project: (raw) => ({ dirty: (raw as { dirty: boolean }).dirty }),
  }),
  defineArchiveOp({
    op: 'archiveStatus',
    subtype: 'archive_status',
    messageType: 'SQLITE_ARCHIVE_STATUS',
    workerType: 'ARCHIVE_STATUS',
    noRetry: false,
    backendMethod: 'archiveStatus',
    depsMethod: 'archiveStatus',
    projectFields: ['status'],
    emptyError: 'Archive status returned no data',
    defaultError: 'Archive status failed',
    validate: () => null,
    encodeRequest: (): Extract<MaintainOp, { type: 'archiveStatus' }> => ({ type: 'archiveStatus' }),
    decodeResponse: (response) => response.status as ArchiveSessionStatusData,
    backendArgs: () => [],
    depsArgs: () => [],
    project: (raw) => ({ status: raw as ArchiveSessionStatusData }),
  }),
];

export type ArchiveDescriptor = (typeof ARCHIVE_WIRE_TABLE)[number];

export type ArchiveOpType = ArchiveDescriptor['op'];
export type ArchiveWireMessageType = ArchiveDescriptor['messageType'];

/** Wire field set a descriptor projects (backend/protocol success payload). */
export type DescriptorWire<D> = D extends { project: (...args: never[]) => infer W } ? W : never;

/** `{ success: true }` plus the descriptor's wire fields — the hop response. */
export type DescriptorResponse<D> = { success: true } & DescriptorWire<D>;

/** Dashboard public value a descriptor decodes to. */
export type DescriptorPublic<D> = D extends { decodeResponse: (...args: never[]) => infer P } ? P : never;

/** Precise per-op view over the table; indexing never yields undefined. */
export type ArchiveDescriptorMap = {
  readonly [O in ArchiveOpType]: Extract<ArchiveDescriptor, { op: O }>;
};

export const ARCHIVE_DESCRIPTORS: ArchiveDescriptorMap = Object.fromEntries(
  ARCHIVE_WIRE_TABLE.map((entry) => [entry.op, entry]),
) as ArchiveDescriptorMap;

// Compile-time two-way sync with the MaintainOp union: adding an
// `archive*` op without a table row (or vice versa) is a type error.
type ArchiveMaintainOpType = Extract<MaintainOp, { type: `archive${string}` }>['type'];
type MissingFromTable = Exclude<ArchiveMaintainOpType, ArchiveOpType>;
type MissingFromUnion = Exclude<ArchiveOpType, ArchiveMaintainOpType>;
const _tableCoversUnion: MissingFromTable extends never ? true : never = true;
const _unionCoversTable: MissingFromUnion extends never ? true : never = true;
void _tableCoversUnion;
void _unionCoversTable;

// Compile-time sync with the SqliteMessage union: every table messageType
// must be a real archive message, and every archive message must be tabled.
type ArchiveSqliteMessageType = Extract<SqliteMessage, { type: `SQLITE_ARCHIVE_${string}` }>['type'];
type UnmappedMessage = Exclude<ArchiveSqliteMessageType, ArchiveWireMessageType>;
type StaleTableMessage = Exclude<ArchiveWireMessageType, ArchiveSqliteMessageType>;
const _messagesCovered: UnmappedMessage extends never ? true : never = true;
const _tableMessagesLive: StaleTableMessage extends never ? true : never = true;
void _messagesCovered;
void _tableMessagesLive;

// Compile-time sync with the dashboard subtypes: every `archive_*` subtype
// must have a descriptor row carrying its codecs, and every row must name a
// real subtype — otherwise the dashboard and background disagree on routing.
type TableSubtype = ArchiveDescriptor['subtype'];
type MissingSubtype = Exclude<DashboardArchiveSubtype, TableSubtype>;
type StaleSubtype = Exclude<TableSubtype, DashboardArchiveSubtype>;
const _subtypesCovered: MissingSubtype extends never ? true : never = true;
const _subtypesLive: StaleSubtype extends never ? true : never = true;
void _subtypesCovered;
void _subtypesLive;

const BY_OP: ReadonlyMap<string, ArchiveDescriptor> = new Map(
  ARCHIVE_WIRE_TABLE.map((entry) => [entry.op, entry]),
);

const BY_MESSAGE: ReadonlyMap<string, ArchiveDescriptor> = new Map(
  ARCHIVE_WIRE_TABLE.map((entry) => [entry.messageType, entry]),
);

export function archiveWireFor(op: string): ArchiveDescriptor | undefined {
  return BY_OP.get(op);
}

export function archiveWireForMessage(messageType: string): ArchiveDescriptor | undefined {
  return BY_MESSAGE.get(messageType);
}

export function isArchiveOpType(op: string): op is ArchiveOpType {
  return BY_OP.has(op);
}

/** Whether the op must never be blind-retried (timeout does not mean failure). */
export function archiveNoRetry(op: ArchiveOpType): boolean {
  return BY_OP.get(op)?.noRetry === true;
}

/** Ops that must never be blind-retried (timeout does not mean failure). */
export const ARCHIVE_NO_RETRY_OPS: ReadonlySet<ArchiveOpType> = new Set(
  ARCHIVE_WIRE_TABLE.filter((entry) => entry.noRetry === true).map((entry) => entry.op),
);

/**
 * Shared success-field projection for the background/offscreen hops.
 *
 * Every hop used to re-derive the same "pick these fields or fail with the
 * historical message" shape with a per-op sentinel (`'x' in result`). The
 * sentinel is always the first projectField; an empty field list (archive
 * open) projects to no data unconditionally.
 */
export function pickProjectedFields(
  result: Record<string, unknown>,
  descriptor: Pick<ArchiveOpDescriptor, 'projectFields'>,
): Record<string, unknown> | null {
  const fields = descriptor.projectFields;
  if (fields.length === 0) return {};
  const first = fields[0];
  if (first === undefined || !(first in result)) return null;
  const out: Record<string, unknown> = {};
  for (const field of fields) out[field] = result[field];
  return out;
}
