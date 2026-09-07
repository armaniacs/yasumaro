/**
 * archiveWireTable.ts
 *
 * Single routing table for the 14 archive ops (PBI 2026-09-07-22).
 *
 * Each archive subtype used to be mapped 1:1 by hand in every hop
 * (gateway switch, dbMaintenance forwarders, backend methods, worker
 * dispatch), so adding a subtype required editing 7 files and copy-paste
 * drift already produced three duplicated declaration blocks. This table is
 * the only place that pairs a MaintainOp with its wire names and retry
 * policy; every hop derives its mapping from here.
 *
 * Neutral placement: both background (gateway) and offscreen (handlers)
 * already depend on messaging, while background -> offscreen imports are
 * forbidden — so this file must not import from offscreen or background.
 * Worker type strings are kept as literals and synced to
 * WORKER_MESSAGE_TYPES by test (no offscreen import in production code).
 */

import type { MaintainOp } from './sqliteRpcClient.js';
import type { SqliteMessage, SqliteMessageType } from './sqliteMessages.js';

export interface ArchiveWireEntry {
  /** MaintainOp discriminator (source of truth is the MaintainOp union). */
  op: string;
  /** background -> offscreen message type. */
  messageType: SqliteMessageType;
  /** offscreen -> OPFS worker type. */
  workerType: string;
  /** Bulk or state-changing ops where a blind retry would double-execute. */
  noRetry?: boolean;
}

export const ARCHIVE_WIRE_TABLE = [
  { op: 'archivePreview', messageType: 'SQLITE_ARCHIVE_PREVIEW', workerType: 'ARCHIVE_PREVIEW' },
  { op: 'archiveCreate', messageType: 'SQLITE_ARCHIVE_CREATE', workerType: 'ARCHIVE_CREATE', noRetry: true },
  { op: 'archiveCleanup', messageType: 'SQLITE_ARCHIVE_CLEANUP', workerType: 'ARCHIVE_CLEANUP' },
  { op: 'archiveExport', messageType: 'SQLITE_ARCHIVE_EXPORT', workerType: 'ARCHIVE_EXPORT' },
  { op: 'archivePrepareIncoming', messageType: 'SQLITE_ARCHIVE_PREPARE_INCOMING', workerType: 'ARCHIVE_PREPARE_INCOMING' },
  { op: 'archiveRestorePreview', messageType: 'SQLITE_ARCHIVE_RESTORE_PREVIEW', workerType: 'ARCHIVE_RESTORE_PREVIEW' },
  { op: 'archiveRestore', messageType: 'SQLITE_ARCHIVE_RESTORE', workerType: 'ARCHIVE_RESTORE', noRetry: true },
  { op: 'archiveDeleteByStaging', messageType: 'SQLITE_ARCHIVE_DELETE_BY_STAGING', workerType: 'ARCHIVE_DELETE_BY_STAGING', noRetry: true },
  { op: 'archiveOpen', messageType: 'SQLITE_ARCHIVE_OPEN', workerType: 'ARCHIVE_OPEN', noRetry: true },
  { op: 'archiveQuery', messageType: 'SQLITE_ARCHIVE_QUERY', workerType: 'ARCHIVE_QUERY' },
  { op: 'archiveUpdate', messageType: 'SQLITE_ARCHIVE_UPDATE', workerType: 'ARCHIVE_UPDATE' },
  { op: 'archiveSave', messageType: 'SQLITE_ARCHIVE_SAVE', workerType: 'ARCHIVE_SAVE', noRetry: true },
  { op: 'archiveClose', messageType: 'SQLITE_ARCHIVE_CLOSE', workerType: 'ARCHIVE_CLOSE', noRetry: true },
  { op: 'archiveStatus', messageType: 'SQLITE_ARCHIVE_STATUS', workerType: 'ARCHIVE_STATUS' },
] as const;

export type ArchiveWireRow = (typeof ARCHIVE_WIRE_TABLE)[number];

export type ArchiveOpType = (typeof ARCHIVE_WIRE_TABLE)[number]['op'];
export type ArchiveWireMessageType = (typeof ARCHIVE_WIRE_TABLE)[number]['messageType'];

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

const BY_OP: ReadonlyMap<string, ArchiveWireRow> = new Map(
  ARCHIVE_WIRE_TABLE.map((entry) => [entry.op, entry]),
);

const BY_MESSAGE: ReadonlyMap<string, ArchiveWireRow> = new Map(
  ARCHIVE_WIRE_TABLE.map((entry) => [entry.messageType, entry]),
);

export function archiveWireFor(op: string): ArchiveWireRow | undefined {
  return BY_OP.get(op);
}

export function archiveWireForMessage(messageType: string): ArchiveWireRow | undefined {
  return BY_MESSAGE.get(messageType);
}

export function isArchiveOpType(op: string): op is ArchiveOpType {
  return BY_OP.has(op);
}

/** Whether the op must never be blind-retried (timeout does not mean failure). */
export function archiveNoRetry(op: ArchiveOpType): boolean {
  return (BY_OP.get(op) as ArchiveWireEntry | undefined)?.noRetry === true;
}

/** Ops that must never be blind-retried (timeout does not mean failure). */
export const ARCHIVE_NO_RETRY_OPS: ReadonlySet<ArchiveOpType> = new Set(
  ARCHIVE_WIRE_TABLE.filter((entry) => (entry as ArchiveWireEntry).noRetry === true).map((entry) => entry.op),
);
