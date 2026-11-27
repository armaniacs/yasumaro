/**
 * sqliteMaintainWireTable.test.ts (PBI 2026-09-23-13)
 *
 * The 7 non-archive maintain rows own the wire triple the offscreen gateway
 * used to hand-wire per branch (messageType + payload shape + decoder). This
 * is a definition-site move only, so each test below pins the frozen triple
 * byte-identical to the former inline call: same message type, same payload
 * keys (including keys carried with undefined values), same decode result.
 * Any change here is a wire break. Compile-time two-way sync with the
 * non-archive MaintainOp remainder lives in sqliteWireTable.ts next to the
 * table (a new op without a row, or a stale row, is a type error).
 */
import { describe, it, expect } from 'vitest';
import {
  SQLITE_MAINTAIN_WIRE_TABLE,
  SQLITE_MAINTAIN_WIRE_DESCRIPTORS,
  sqliteMaintainWireFor,
} from '../sqliteWireTable.js';
import { SQLITE_MESSAGE_TYPES } from '../sqliteMessages.js';

describe('messaging/sqliteMaintainWireTable: shape', () => {
  it('has exactly the 11 non-archive maintain ops', () => {
    expect(SQLITE_MAINTAIN_WIRE_TABLE).toHaveLength(11);
    expect(SQLITE_MAINTAIN_WIRE_TABLE.map((e) => e.op).sort()).toEqual(
      [
        'backup', 'clearAll', 'healthCheck', 'init',
        'restoreAbort', 'restoreAppend', 'restoreCommit', 'restorePrepareIncoming',
        'purgeAuditLog', 'purgeContent', 'purgeOldRecords',
      ].sort(),
    );
    for (const entry of SQLITE_MAINTAIN_WIRE_TABLE) expect(entry.family).toBe('maintain');
  });

  it('ops and messages are unique; the purge split stays three distinct messages', () => {
    const ops = SQLITE_MAINTAIN_WIRE_TABLE.map((e) => e.op);
    expect(new Set(ops).size).toBe(11);
    const messages = SQLITE_MAINTAIN_WIRE_TABLE.map((e) => e.messageType);
    expect(new Set(messages).size).toBe(11);
    expect(SQLITE_MAINTAIN_WIRE_DESCRIPTORS.purgeOldRecords.messageType).toBe('SQLITE_PURGE');
    expect(SQLITE_MAINTAIN_WIRE_DESCRIPTORS.purgeContent.messageType).toBe('CONTENT_PURGE');
    expect(SQLITE_MAINTAIN_WIRE_DESCRIPTORS.purgeAuditLog.messageType).toBe('SQLITE_AUDIT_LOG_PURGE');
  });

  it('every message is a real message type and no archive message leaks in', () => {
    for (const entry of SQLITE_MAINTAIN_WIRE_TABLE) {
      expect((SQLITE_MESSAGE_TYPES as readonly string[]).includes(entry.messageType)).toBe(true);
      expect(entry.messageType.startsWith('SQLITE_ARCHIVE_')).toBe(false);
    }
  });

  it('lookups resolve by op and fail closed on unknown ops', () => {
    expect(sqliteMaintainWireFor('init')?.messageType).toBe('SQLITE_INIT');
    expect(sqliteMaintainWireFor('backup')?.messageType).toBe('SQLITE_BACKUP');
    expect(sqliteMaintainWireFor('archivePreview')).toBeUndefined();
    expect(sqliteMaintainWireFor('nope')).toBeUndefined();
  });

  it('every row names a unique offscreen runner (the MAINTAIN_RUNNERS key)', () => {
    // PBI 2026-11-26-13: the row owns the messageType AND the offscreen
    // runner name, so adding a maintain op is one row plus one runner. The
    // names must be unique — a shared name would silently drop a row from
    // the runner record's key union. Offscreen-side resolution is pinned by
    // wireOpEnumerationDerived.test.ts (this layer must not import it).
    const names = SQLITE_MAINTAIN_WIRE_TABLE.map((e) => e.offscreenRunner);
    for (const name of names) expect(name.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('messaging/sqliteMaintainWireTable: parity pins (byte-identical to the former gateway branches)', () => {
  it('init sends SQLITE_INIT with an empty payload and decodes success to true', () => {
    const row = SQLITE_MAINTAIN_WIRE_DESCRIPTORS.init;
    expect(row.messageType).toBe('SQLITE_INIT');
    expect(row.encodePayload({ type: 'init' })).toEqual({});
    expect(row.decodeGateway({ success: true })).toBe(true);
  });

  it('backup sends SQLITE_BACKUP with an empty payload and decodes the base64 bytes', () => {
    const row = SQLITE_MAINTAIN_WIRE_DESCRIPTORS.backup;
    expect(row.messageType).toBe('SQLITE_BACKUP');
    expect(row.encodePayload({ type: 'backup' })).toEqual({});
    // PBI 2026-11-27-04: the offscreen runner ships the backup as base64 —
    // the gateway decodes it to bytes without materializing a number[] array.
    const decoded = row.decodeGateway({ success: true, data: 'U1FMaXRl' });
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(Array.from(decoded)).toEqual([83, 81, 76, 105, 116, 101]);
  });

  it('restorePrepareIncoming sends SQLITE_RESTORE_BEGIN with the session declaration and decodes the staging name', () => {
    const row = SQLITE_MAINTAIN_WIRE_DESCRIPTORS.restorePrepareIncoming;
    expect(row.messageType).toBe('SQLITE_RESTORE_BEGIN');
    expect(row.encodePayload({ type: 'restorePrepareIncoming', totalBytes: 7, totalChunks: 2 }))
      .toEqual({ totalBytes: 7, totalChunks: 2 });
    expect(row.decodeGateway({ success: true, stagingName: 'restore_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db' }))
      .toBe('restore_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db');
  });

  it('restoreAppend sends SQLITE_RESTORE_APPEND with base64 passthrough and decodes the written count', () => {
    const row = SQLITE_MAINTAIN_WIRE_DESCRIPTORS.restoreAppend;
    expect(row.messageType).toBe('SQLITE_RESTORE_APPEND');
    // The base64 string rides untouched (single decode happens offscreen).
    expect(row.encodePayload({ type: 'restoreAppend', stagingName: 'restore_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db', offset: 4096, dataBase64: 'ChQ=' }))
      .toEqual({ stagingName: 'restore_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db', offset: 4096, data: 'ChQ=' });
    // Scalar projection: the gateway's data IS the written count. Wrapping it
    // in an object here would nest { written } into the SW reply and break
    // the dashboard serviceDecode's requiredNonNegativeNumber(response.written).
    expect(row.decodeGateway({ success: true, written: 2 })).toBe(2);
  });

  it('restoreCommit sends SQLITE_RESTORE_COMMIT and decodes to undefined', () => {
    const row = SQLITE_MAINTAIN_WIRE_DESCRIPTORS.restoreCommit;
    expect(row.messageType).toBe('SQLITE_RESTORE_COMMIT');
    expect(row.encodePayload({ type: 'restoreCommit', stagingName: 's.db', totalBytes: 8 }))
      .toEqual({ stagingName: 's.db', totalBytes: 8 });
    expect(row.decodeGateway()).toBeUndefined();
  });

  it('restoreAbort sends SQLITE_RESTORE_ABORT and decodes to undefined', () => {
    const row = SQLITE_MAINTAIN_WIRE_DESCRIPTORS.restoreAbort;
    expect(row.messageType).toBe('SQLITE_RESTORE_ABORT');
    expect(row.encodePayload({ type: 'restoreAbort', stagingName: 's.db' })).toEqual({ stagingName: 's.db' });
    expect(row.decodeGateway()).toBeUndefined();
  });

  it('clearAll sends SQLITE_CLEAR_ALL with an empty payload and decodes to undefined', () => {
    const row = SQLITE_MAINTAIN_WIRE_DESCRIPTORS.clearAll;
    expect(row.messageType).toBe('SQLITE_CLEAR_ALL');
    expect(row.encodePayload({ type: 'clearAll' })).toEqual({});
    expect(row.decodeGateway({ success: true })).toBeUndefined();
  });

  it('purgeOldRecords sends SQLITE_PURGE with literal keys and projects purged', () => {
    const row = SQLITE_MAINTAIN_WIRE_DESCRIPTORS.purgeOldRecords;
    expect(row.messageType).toBe('SQLITE_PURGE');
    const payload = row.encodePayload({ type: 'purgeOldRecords', retentionDays: 30, maxRecords: 1000 });
    expect(payload).toStrictEqual({ retentionDays: 30, maxRecords: 1000 });
    // Undefined values still ride as present keys (no pickDefined) — matches
    // the former `{ retentionDays: rest.retentionDays, ... }` literal.
    const empty = row.encodePayload({ type: 'purgeOldRecords' });
    expect(Object.keys(empty).sort()).toEqual(['maxRecords', 'retentionDays']);
    expect(empty).toStrictEqual({ retentionDays: undefined, maxRecords: undefined });
    expect(row.decodeGateway({ success: true, purged: 10 })).toEqual({ purged: 10 });
  });

  it('purgeContent sends CONTENT_PURGE with literal keys including includeStarred and projects purged', () => {
    const row = SQLITE_MAINTAIN_WIRE_DESCRIPTORS.purgeContent;
    expect(row.messageType).toBe('CONTENT_PURGE');
    const payload = row.encodePayload({ type: 'purgeContent', retentionDays: 7, includeStarred: true });
    expect(payload).toStrictEqual({ retentionDays: 7, maxRecords: undefined, includeStarred: true });
    expect(Object.keys(payload).sort()).toEqual(['includeStarred', 'maxRecords', 'retentionDays']);
    expect(row.decodeGateway({ success: true, purged: 5 })).toEqual({ purged: 5 });
  });

  it('healthCheck sends SQLITE_HEALTH_CHECK with an empty payload and decodes success to true', () => {
    const row = SQLITE_MAINTAIN_WIRE_DESCRIPTORS.healthCheck;
    expect(row.messageType).toBe('SQLITE_HEALTH_CHECK');
    expect(row.encodePayload({ type: 'healthCheck' })).toEqual({});
    expect(row.decodeGateway({ success: true })).toBe(true);
  });

  it('purgeAuditLog sends SQLITE_AUDIT_LOG_PURGE with a literal retentionDays key and projects purged', () => {
    const row = SQLITE_MAINTAIN_WIRE_DESCRIPTORS.purgeAuditLog;
    expect(row.messageType).toBe('SQLITE_AUDIT_LOG_PURGE');
    expect(row.encodePayload({ type: 'purgeAuditLog', retentionDays: 7 })).toStrictEqual({ retentionDays: 7 });
    // Absent stays a present-but-undefined key, the same arity rule the two
    // record purges follow: the handler reads "no window" off the key.
    const empty = row.encodePayload({ type: 'purgeAuditLog' });
    expect(Object.keys(empty)).toEqual(['retentionDays']);
    expect(row.decodeGateway({ success: true, purged: 3 })).toEqual({ purged: 3 });
  });
});
