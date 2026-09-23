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
  it('has exactly the 7 non-archive maintain ops', () => {
    expect(SQLITE_MAINTAIN_WIRE_TABLE).toHaveLength(7);
    expect(SQLITE_MAINTAIN_WIRE_TABLE.map((e) => e.op).sort()).toEqual(
      ['backup', 'clearAll', 'healthCheck', 'init', 'purgeContent', 'purgeOldRecords', 'restore'].sort(),
    );
    for (const entry of SQLITE_MAINTAIN_WIRE_TABLE) expect(entry.family).toBe('maintain');
  });

  it('ops and messages are unique; the purge split stays two distinct messages', () => {
    const ops = SQLITE_MAINTAIN_WIRE_TABLE.map((e) => e.op);
    expect(new Set(ops).size).toBe(7);
    const messages = SQLITE_MAINTAIN_WIRE_TABLE.map((e) => e.messageType);
    expect(new Set(messages).size).toBe(7);
    expect(SQLITE_MAINTAIN_WIRE_DESCRIPTORS.purgeOldRecords.messageType).toBe('SQLITE_PURGE');
    expect(SQLITE_MAINTAIN_WIRE_DESCRIPTORS.purgeContent.messageType).toBe('CONTENT_PURGE');
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
});

describe('messaging/sqliteMaintainWireTable: parity pins (byte-identical to the former gateway branches)', () => {
  it('init sends SQLITE_INIT with an empty payload and decodes success to true', () => {
    const row = SQLITE_MAINTAIN_WIRE_DESCRIPTORS.init;
    expect(row.messageType).toBe('SQLITE_INIT');
    expect(row.encodePayload({ type: 'init' })).toEqual({});
    expect(row.decodeGateway({ success: true })).toBe(true);
  });

  it('backup sends SQLITE_BACKUP with an empty payload and decodes number[] to Uint8Array bytes', () => {
    const row = SQLITE_MAINTAIN_WIRE_DESCRIPTORS.backup;
    expect(row.messageType).toBe('SQLITE_BACKUP');
    expect(row.encodePayload({ type: 'backup' })).toEqual({});
    const decoded = row.decodeGateway({ success: true, data: [83, 81, 76, 105, 116, 101] });
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(Array.from(decoded)).toEqual([83, 81, 76, 105, 116, 101]);
  });

  it('restore sends SQLITE_RESTORE with the bytes as a number[] and decodes to undefined', () => {
    const row = SQLITE_MAINTAIN_WIRE_DESCRIPTORS.restore;
    expect(row.messageType).toBe('SQLITE_RESTORE');
    expect(row.encodePayload({ type: 'restore', data: new Uint8Array([1, 2, 3]) })).toEqual({ data: [1, 2, 3] });
    expect(row.decodeGateway({ success: true })).toBeUndefined();
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
});
