/**
 * wireOpEnumerationDerived.test.ts (PBI 2026-10-20-23)
 *
 * Table-driven pinning tests for the query/mutate registry fold: every
 * SQLITE_WIRE_TABLE row (except the gateway-folded search row) reaches its
 * offscreen registry entry and dispatches to its own repo runner WITHOUT
 * naming any message type, op, or count in the assertions.
 *
 * Adding a wire-table row extends these loops automatically; a row missing
 * its registry entry, or an entry routing to another row's runner, fails
 * here (and at the compile-time sync asserts next to the tables). Per-op
 * payload shapes stay pinned by sqliteMessageHandlers-coverage.test.ts —
 * this file pins derivation, not shapes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLITE_WIRE_TABLE } from '../../messaging/sqliteWireTable.js';
import { ARCHIVE_WIRE_TABLE } from '../../messaging/archiveWireTable.js';
import { SQLITE_MESSAGE_TYPES } from '../../messaging/sqliteMessages.js';
import type { SqliteMessage } from '../../messaging/sqliteMessages.js';

// ── Hoisted fakes (same seams as sqliteMessageHandlers-coverage.test.ts) ──
const engineMock = vi.hoisted(() => ({
  init: vi.fn().mockResolvedValue(true),
}));

const recordsRepoMock = vi.hoisted(() => ({
  insert: vi.fn().mockResolvedValue({ success: true, id: 1 }),
  insertBatch: vi.fn().mockResolvedValue({ success: true, count: 1 }),
  query: vi.fn().mockResolvedValue({ success: true, rows: [], total: 0 }),
  update: vi.fn().mockResolvedValue({ success: true }),
  hardDelete: vi.fn().mockResolvedValue({ success: true }),
  toggleStar: vi.fn().mockResolvedValue({ success: true, is_starred: 1 }),
  getCount: vi.fn().mockResolvedValue({ success: true, count: 1 }),
  getStatus: vi.fn().mockResolvedValue({ success: true, initialized: true, path: 'test.db', fallback: false, fts5: true }),
  clearAll: vi.fn().mockResolvedValue({ success: true }),
}));

const dbMaintenanceMock = vi.hoisted(() => ({
  sqliteHealthCheck: vi.fn().mockResolvedValue(true),
  backupDb: vi.fn().mockResolvedValue({ success: true, data: new Uint8Array([1]) }),
  restoreDb: vi.fn().mockResolvedValue({ success: true }),
  purgeOldRecords: vi.fn().mockResolvedValue({ success: true, purged: 1 }),
  purgeContent: vi.fn().mockResolvedValue({ success: true, purged: 1 }),
}));

const auditLogRepoMock = vi.hoisted(() => ({
  insertAuditLog: vi.fn().mockResolvedValue({ success: true, id: 1 }),
  queryAuditLog: vi.fn().mockResolvedValue({ success: true, rows: [], total: 0 }),
  purgeAuditLog: vi.fn().mockResolvedValue({ success: true, purged: 1 }),
}));

vi.mock('../sqliteEngineHost.js', () => ({
  engine: engineMock,
}));

vi.mock('../recordsRepo.js', () => ({
  insert: recordsRepoMock.insert,
  insertBatch: recordsRepoMock.insertBatch,
  query: recordsRepoMock.query,
  update: recordsRepoMock.update,
  hardDelete: recordsRepoMock.hardDelete,
  toggleStar: recordsRepoMock.toggleStar,
  getCount: recordsRepoMock.getCount,
  getStatus: recordsRepoMock.getStatus,
  clearAll: recordsRepoMock.clearAll,
}));

vi.mock('../dbMaintenance.js', () => ({
  sqliteHealthCheck: dbMaintenanceMock.sqliteHealthCheck,
  backupDb: dbMaintenanceMock.backupDb,
  restoreDb: dbMaintenanceMock.restoreDb,
  purgeOldRecords: dbMaintenanceMock.purgeOldRecords,
  purgeContent: dbMaintenanceMock.purgeContent,
}));

vi.mock('../auditLogRepo.js', () => ({
  insertAuditLog: auditLogRepoMock.insertAuditLog,
  queryAuditLog: auditLogRepoMock.queryAuditLog,
  purgeAuditLog: auditLogRepoMock.purgeAuditLog,
}));

import { sqliteMessageHandlers, type SqliteRepoMethod } from '../sqliteMessageHandlers.js';

// repoMethod -> the repo mock the offscreen runner for that method drives.
// Record<> over SqliteRepoMethod: a new runner key fails to compile here too.
const RUNNER_MOCKS: Record<SqliteRepoMethod, ReturnType<typeof vi.fn>> = {
  insert: recordsRepoMock.insert,
  insertBatch: recordsRepoMock.insertBatch,
  query: recordsRepoMock.query,
  search: recordsRepoMock.query,
  count: recordsRepoMock.getCount,
  update: recordsRepoMock.update,
  delete: recordsRepoMock.hardDelete,
  toggleStar: recordsRepoMock.toggleStar,
  insertAuditLog: auditLogRepoMock.insertAuditLog,
  auditLogQuery: auditLogRepoMock.queryAuditLog,
};

// helper — call handler via Map and collect the response
async function callHandler(type: string, payload?: unknown): Promise<unknown> {
  const handler = sqliteMessageHandlers.get(type as never);
  if (!handler) throw new Error(`No handler for ${type}`);
  const msg = { type, payload, traceId: 't' } as SqliteMessage;
  let response: unknown;
  await handler(msg, (r) => { response = r; });
  return response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('derived wire registry: one entry per gateway wire-table row', () => {
  // The search row is excluded on purpose: its messageType is SQLITE_QUERY,
  // shared with 'records', and the SQLITE_QUERY handler must stay the records
  // runner (sqliteMessageHandlers.ts + sqliteWireTable.ts header notes).
  const gatewayRows = SQLITE_WIRE_TABLE.filter((row) => row.op !== 'search');

  it('registers every gateway row message type', () => {
    const keys = new Set([...sqliteMessageHandlers.keys()]);
    for (const row of gatewayRows) {
      expect(keys.has(row.messageType)).toBe(true);
    }
  });

  it('registry = table-derived messages + exactly the hand-written remainder', () => {
    // Everything derived from a table (query/mutate gateway rows + archive
    // rows) plus the deliberate hand-written handlers must cover the message
    // union exactly once — no stale hand entry can shadow a derived one.
    const tableDerived = new Set<string>([
      ...gatewayRows.map((row) => row.messageType),
      ...ARCHIVE_WIRE_TABLE.map((row) => row.messageType),
    ]);
    const handWritten = SQLITE_MESSAGE_TYPES.filter((t) => !tableDerived.has(t));

    const keys = new Set([...sqliteMessageHandlers.keys()]);
    expect(keys.size).toBe(tableDerived.size + handWritten.length);
    for (const t of tableDerived) expect(keys.has(t)).toBe(true);
    for (const t of handWritten) expect(keys.has(t)).toBe(true);
  });

  // Per-row dispatch loop: each message routes to the descriptor's own
  // repoMethod runner and to no other. Payload {} keeps the loop
  // fixture-free — shapes are pinned by the coverage tests.
  for (const row of gatewayRows) {
    it(`${row.op}: ${row.messageType} dispatches to the ${row.repoMethod} runner`, async () => {
      const response = await callHandler(row.messageType, {});

      const own = RUNNER_MOCKS[row.repoMethod as SqliteRepoMethod];
      expect(own).toHaveBeenCalledTimes(1);
      for (const mock of Object.values(RUNNER_MOCKS)) {
        if (mock !== own) expect(mock).not.toHaveBeenCalled();
      }
      // The runner always answers through the descriptor's decode-free
      // passthrough — the mock's resolved value rides through unchanged.
      expect(response).toEqual(await own.mock.results[0]!.value);
    });
  }

  it('SQLITE_QUERY stays the records runner (the search row does not shadow it)', async () => {
    // Both runners drive the same repo mock, so the listing default is what
    // distinguishes them: planQueryOrSearch's 100, not planSearch's 50.
    await callHandler('SQLITE_QUERY', {});
    const opts = recordsRepoMock.query.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.limit).toBe(100);
  });
});
