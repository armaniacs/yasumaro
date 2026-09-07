/**
 * archiveWireTable.test.ts (PBI 2026-09-07-22)
 *
 * The table is the single source of op -> wire-type -> noRetry routing.
 * These tests fail closed in both directions: a new MaintainOp / message /
 * worker type without a table row fails here, and a stale table row fails
 * here too. Compile-time asserts in archiveWireTable.ts cover the
 * type level; this file covers the runtime constants.
 */
import { describe, it, expect } from 'vitest';
import {
  ARCHIVE_WIRE_TABLE,
  ARCHIVE_NO_RETRY_OPS,
  archiveWireFor,
  archiveWireForMessage,
  isArchiveOpType,
} from '../archiveWireTable.js';
import { SQLITE_MESSAGE_TYPES } from '../sqliteMessages.js';
import { WORKER_MESSAGE_TYPES } from '../../offscreen/opfsWorker/types.js';

// Worker types outside the 14-op table: lifecycle ops with no MaintainOp.
const NON_TABLE_WORKER_TYPES = new Set(['ARCHIVE_DISCARD', 'ARCHIVE_SWEEP']);

describe('messaging/archiveWireTable: shape', () => {
  it('has exactly 14 archive ops', () => {
    expect(ARCHIVE_WIRE_TABLE).toHaveLength(14);
  });

  it('ops, message types, and worker types are each unique', () => {
    const ops = ARCHIVE_WIRE_TABLE.map((e) => e.op);
    const messages = ARCHIVE_WIRE_TABLE.map((e) => e.messageType);
    const workers = ARCHIVE_WIRE_TABLE.map((e) => e.workerType);
    expect(new Set(ops).size).toBe(14);
    expect(new Set(messages).size).toBe(14);
    expect(new Set(workers).size).toBe(14);
  });

  it('declares the noRetry ops (bulk/state-changing: timeout != failure)', () => {
    expect([...ARCHIVE_NO_RETRY_OPS].sort()).toEqual(
      ['archiveClose', 'archiveCreate', 'archiveDeleteByStaging', 'archiveOpen', 'archiveRestore', 'archiveSave'].sort(),
    );
  });

  it('lookups resolve in both directions', () => {
    expect(archiveWireFor('archiveQuery')?.messageType).toBe('SQLITE_ARCHIVE_QUERY');
    expect(archiveWireFor('archiveQuery')?.workerType).toBe('ARCHIVE_QUERY');
    expect(archiveWireForMessage('SQLITE_ARCHIVE_SAVE')?.op).toBe('archiveSave');
    expect(archiveWireFor('nope')).toBeUndefined();
    expect(archiveWireForMessage('SQLITE_QUERY')).toBeUndefined();
    expect(isArchiveOpType('archiveStatus')).toBe(true);
    expect(isArchiveOpType('backup')).toBe(false);
  });
});

describe('messaging/archiveWireTable: exhaustive sync', () => {
  it('covers every SQLITE_ARCHIVE_* message type exactly once', () => {
    const tabled = new Set(ARCHIVE_WIRE_TABLE.map((e) => e.messageType));
    const archiveMessages = SQLITE_MESSAGE_TYPES.filter((t) => t.startsWith('SQLITE_ARCHIVE_'));
    expect(archiveMessages).toHaveLength(14);
    for (const t of archiveMessages) expect(tabled.has(t)).toBe(true);
  });

  it('covers every ARCHIVE_* worker type except DISCARD/SWEEP', () => {
    const tabled = new Set(ARCHIVE_WIRE_TABLE.map((e) => e.workerType));
    const archiveWorkers = WORKER_MESSAGE_TYPES.filter((t) => t.startsWith('ARCHIVE_'));
    for (const t of archiveWorkers) {
      if (NON_TABLE_WORKER_TYPES.has(t)) continue;
      expect(tabled.has(t)).toBe(true);
    }
    expect(tabled.size).toBe(archiveWorkers.length - NON_TABLE_WORKER_TYPES.size);
  });
});
