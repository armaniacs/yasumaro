/**
 * sqliteWireTable.test.ts (PBI 2026-09-20-16)
 *
 * The table is the single source of op -> message-type -> codec routing for
 * the 10 query/mutate ops. These tests fail closed in both directions: a new
 * MutateOp / QueryOp without a table row fails here, and a stale table row
 * fails here too. Compile-time asserts in sqliteWireTable.ts cover the type
 * level; this file covers the runtime constants and the codec shapes (wire
 * shapes and error modes are frozen — any change here is a wire break).
 */
import { describe, it, expect } from 'vitest';
import {
  SQLITE_WIRE_TABLE,
  SQLITE_WIRE_DESCRIPTORS,
  sqliteWireFor,
  isSqliteWireOp,
} from '../sqliteWireTable.js';
import { SQLITE_MESSAGE_TYPES } from '../sqliteMessages.js';
import { ALL_DASHBOARD_SQLITE_SUBTYPES } from '../sqliteOperationSecurity.js';

// Messages owned by the query/mutate subset. SQLITE_SEARCH is intentionally
// absent: no QueryOp reaches it through the gateway (kind:'search' folds into
// SQLITE_QUERY), so it stays a hand-written offscreen handler.
const TABLED_MESSAGES = new Set([
  'SQLITE_INSERT',
  'SQLITE_INSERT_BATCH',
  'SQLITE_UPDATE',
  'SQLITE_DELETE',
  'SQLITE_TOGGLE_STAR',
  'SQLITE_AUDIT_LOG_INSERT',
  'SQLITE_QUERY',
  'SQLITE_AUDIT_LOG_QUERY',
  'SQLITE_COUNT',
]);

describe('messaging/sqliteWireTable: shape', () => {
  it('has exactly 10 query/mutate ops (6 mutate + 4 query)', () => {
    expect(SQLITE_WIRE_TABLE).toHaveLength(10);
    expect(SQLITE_WIRE_TABLE.filter((e) => e.family === 'mutate')).toHaveLength(6);
    expect(SQLITE_WIRE_TABLE.filter((e) => e.family === 'query')).toHaveLength(4);
  });

  it('ops are unique; messages are unique except records/search sharing SQLITE_QUERY', () => {
    const ops = SQLITE_WIRE_TABLE.map((e) => e.op);
    expect(new Set(ops).size).toBe(10);
    const messages = SQLITE_WIRE_TABLE.map((e) => e.messageType);
    expect(new Set(messages).size).toBe(9);
    expect(SQLITE_WIRE_DESCRIPTORS.records.messageType).toBe('SQLITE_QUERY');
    expect(SQLITE_WIRE_DESCRIPTORS.search.messageType).toBe('SQLITE_QUERY');
  });

  it('covers every expected query/mutate message and no archive message', () => {
    const tabled = new Set(SQLITE_WIRE_TABLE.map((e) => e.messageType));
    for (const t of TABLED_MESSAGES) expect(tabled.has(t as never)).toBe(true);
    expect(tabled.has('SQLITE_SEARCH' as never)).toBe(false);
    for (const t of tabled) {
      expect(t.startsWith('SQLITE_ARCHIVE_')).toBe(false);
      expect((SQLITE_MESSAGE_TYPES as readonly string[]).includes(t)).toBe(true);
    }
  });

  it('dashboard subtypes are real subtypes', () => {
    for (const entry of SQLITE_WIRE_TABLE) {
      if (!entry.dashboard) continue;
      expect((ALL_DASHBOARD_SQLITE_SUBTYPES as readonly string[]).includes(entry.dashboard.subtype)).toBe(true);
    }
  });

  it('lookups resolve by op', () => {
    expect(sqliteWireFor('toggleStar')?.messageType).toBe('SQLITE_TOGGLE_STAR');
    expect(sqliteWireFor('records')?.messageType).toBe('SQLITE_QUERY');
    expect(sqliteWireFor('count')?.messageType).toBe('SQLITE_COUNT');
    expect(sqliteWireFor('nope')).toBeUndefined();
    expect(isSqliteWireOp('delete')).toBe(true);
    expect(isSqliteWireOp('archivePreview')).toBe(false);
  });

  it('depsMethod is null only for insertAuditLog (direct SqliteClient caller, no dashboard path)', () => {
    const nullDeps = SQLITE_WIRE_TABLE.filter((e) => e.depsMethod === null).map((e) => e.op);
    expect(nullDeps).toEqual(['insertAuditLog']);
    const nullDashboard = SQLITE_WIRE_TABLE.filter((e) => e.dashboard === null).map((e) => e.op);
    expect(nullDashboard.sort()).toEqual(['insert', 'insertAuditLog', 'insertBatch'].sort());
  });
});

describe('messaging/sqliteWireTable: gateway codec pins the frozen wire shapes', () => {
  it('insert passes the record through as the payload', () => {
    const record = { url: 'https://x.com', title: 't' };
    const op = SQLITE_WIRE_DESCRIPTORS.insert.encodeOp(record as never);
    expect(op).toEqual({ type: 'insert', record });
    expect(SQLITE_WIRE_DESCRIPTORS.insert.encodePayload(op)).toBe(record);
  });

  it('update flattens changes onto the payload (never nested under `changes`)', () => {
    const op = SQLITE_WIRE_DESCRIPTORS.update.encodeOp(7, { title: 'n' });
    const payload = SQLITE_WIRE_DESCRIPTORS.update.encodePayload(op);
    expect(payload).toEqual({ id: 7, title: 'n' });
    expect('changes' in payload).toBe(false);
  });

  it('search folds the QueryOp into a StorageQuery payload', () => {
    const op = SQLITE_WIRE_DESCRIPTORS.search.encodeOp('hello', 50, 0, { orderBy: 'rank', orderDir: 'ASC' });
    expect(op).toEqual({ kind: 'search', text: 'hello', limit: 50, offset: 0, orderBy: 'rank', orderDir: 'ASC' });
    expect(SQLITE_WIRE_DESCRIPTORS.search.encodePayload(op)).toEqual({
      text: 'hello', limit: 50, offset: 0, orderBy: 'rank', orderDir: 'ASC',
    });
  });

  it('auditLog passes undefined limit/offset through (no pickDefined)', () => {
    const op = SQLITE_WIRE_DESCRIPTORS.auditLog.encodeOp({});
    expect(SQLITE_WIRE_DESCRIPTORS.auditLog.encodePayload(op)).toEqual({ limit: undefined, offset: undefined });
  });

  it('insertBatch prefers inserted over count and defaults skipped to 0', () => {
    const decode = SQLITE_WIRE_DESCRIPTORS.insertBatch.decodeGateway;
    expect(decode({ success: true, count: 2, inserted: 1, skipped: 1 })).toEqual({ count: 1, skipped: 1 });
    expect(decode({ success: true, count: 2 })).toEqual({ count: 2, skipped: 0 });
  });

  it('count throws the historical error on a missing numeric count', () => {
    expect(() => SQLITE_WIRE_DESCRIPTORS.count.decodeGateway({ success: true })).toThrow(
      'SQLite count response was missing a numeric count',
    );
    expect(SQLITE_WIRE_DESCRIPTORS.count.decodeGateway({ success: true, count: 5 })).toBe(5);
  });

  it('toggleStar picks is_starred; update/delete decode to undefined', () => {
    expect(SQLITE_WIRE_DESCRIPTORS.toggleStar.decodeGateway({ success: true, is_starred: 1 })).toEqual({ is_starred: 1 });
    expect(SQLITE_WIRE_DESCRIPTORS.update.decodeGateway({ success: true })).toBeUndefined();
    expect(SQLITE_WIRE_DESCRIPTORS.delete.decodeGateway({ success: true })).toBeUndefined();
  });
});

describe('messaging/sqliteWireTable: dashboard codec pins the frozen service shapes', () => {
  it('toggleStar serviceDecode validates is_starred', () => {
    const decode = SQLITE_WIRE_DESCRIPTORS.toggleStar.dashboard?.serviceDecode;
    expect(decode?.({ success: true, is_starred: 0 })).toEqual({ is_starred: 0 });
    expect(() => decode?.({ success: true })).toThrow();
  });

  it('update/delete project to no data; toggleStar projects is_starred', () => {
    expect(SQLITE_WIRE_DESCRIPTORS.update.dashboard?.projectDeps?.({})).toEqual({});
    expect(SQLITE_WIRE_DESCRIPTORS.delete.dashboard?.projectDeps?.({})).toEqual({});
    expect(SQLITE_WIRE_DESCRIPTORS.toggleStar.dashboard?.projectDeps?.({ is_starred: 1 })).toEqual({ is_starred: 1 });
  });

  it('update depsArgs defaults missing changes to {}', () => {
    expect(SQLITE_WIRE_DESCRIPTORS.update.dashboard?.depsArgs?.({ id: 3 })).toEqual([3, {}]);
    expect(SQLITE_WIRE_DESCRIPTORS.toggleStar.dashboard?.depsArgs?.({ id: 3 })).toEqual([3]);
  });
});
