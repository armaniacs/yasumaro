/**
 * archiveOpEnumerationDerived.test.ts (PBI 2026-10-16-08)
 *
 * Table-driven pinning tests for the op-enumeration fold: every
 * ARCHIVE_WIRE_TABLE row reaches its offscreen registry entry and its
 * backend proxy WITHOUT naming any op, message type, or count.
 *
 * Adding a table row extends these loops automatically; a row missing its
 * registry entry or proxy pack fails here (and at the compile-time sync
 * asserts next to the tables). Per-op payload shapes stay pinned by
 * archiveWireDispatch.test.ts — this file pins derivation, not shapes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ARCHIVE_WIRE_TABLE, archiveWireForMessage } from '../../messaging/archiveWireTable.js';
import type { SqliteMessage } from '../../messaging/sqliteMessages.js';

// ── Hoisted fakes (same seams as archiveWireDispatch.test.ts) ────────────────
// The backend is a Proxy that auto-stubs any method: no method name is
// hard-coded, so a new table row gets its stub for free.
const proxyBackendState = vi.hoisted(() => ({
  fns: new Map<string, ReturnType<typeof vi.fn>>(),
}));

const getBackendMock = vi.hoisted(() => vi.fn());

vi.mock('../sqliteEngineHost.js', () => ({
  engine: { getBackend: getBackendMock },
}));

vi.mock('../recordsRepo.js', () => ({
  insert: vi.fn(),
  insertBatch: vi.fn(),
  query: vi.fn(),
  update: vi.fn(),
  hardDelete: vi.fn(),
  toggleStar: vi.fn(),
  getCount: vi.fn(),
  getStatus: vi.fn(),
  serialize: vi.fn(),
  clearAll: vi.fn(),
}));

vi.mock('../auditLogRepo.js', () => ({
  insertAuditLog: vi.fn(),
  queryAuditLog: vi.fn(),
}));

vi.mock('../dbMaintenance.js', () => ({
  sqliteHealthCheck: vi.fn(),
  backupDb: vi.fn(),
  restoreDb: vi.fn(),
  purgeOldRecords: vi.fn(),
  purgeContent: vi.fn(),
}));

function backendFn(method: string): ReturnType<typeof vi.fn> {
  let fn = proxyBackendState.fns.get(method);
  if (!fn) {
    fn = vi.fn();
    proxyBackendState.fns.set(method, fn);
  }
  return fn;
}

function autoStubBackend(): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') return undefined;
        return backendFn(prop);
      },
    },
  );
}

import { sqliteMessageHandlers, archiveMessageHandlers } from '../sqliteMessageHandlers.js';
import {
  OpfsWorkerBackend,
  ARCHIVE_BACKEND_PACKS,
  OPFS_WORKER_UNAVAILABLE_ERROR,
} from '../OpfsWorkerBackend.js';

beforeEach(() => {
  vi.clearAllMocks();
  proxyBackendState.fns.clear();
  getBackendMock.mockResolvedValue(autoStubBackend());
});

describe('derived registry: one entry per wire-table row (BY_MESSAGE)', () => {
  it('exposes exactly the table message types (no hand list, no count)', () => {
    const keys = new Set(Object.keys(archiveMessageHandlers));
    for (const row of ARCHIVE_WIRE_TABLE) {
      expect(keys.has(row.messageType)).toBe(true);
    }
    expect(keys.size).toBe(ARCHIVE_WIRE_TABLE.length);
  });

  it('every table row resolves through BY_MESSAGE to its own op', () => {
    for (const row of ARCHIVE_WIRE_TABLE) {
      expect(archiveWireForMessage(row.messageType)?.op).toBe(row.op);
    }
  });

  it('registers no archive message outside the table', () => {
    const tabled = new Set(ARCHIVE_WIRE_TABLE.map((row) => row.messageType));
    for (const key of sqliteMessageHandlers.keys()) {
      if (key.startsWith('SQLITE_ARCHIVE_')) {
        expect(tabled.has(key)).toBe(true);
      }
    }
  });

  // The per-row dispatch loop: each message routes to the descriptor's own
  // backend method with the descriptor's own backendArgs, and the response
  // carries exactly the projected fields. Payload `{}` keeps the loop
  // fixture-free — shapes are pinned by archiveWireDispatch.test.ts.
  for (const row of ARCHIVE_WIRE_TABLE) {
    it(`${row.op}: ${row.messageType} delegates to ${row.backendMethod} and projects`, async () => {
      const handler = sqliteMessageHandlers.get(row.messageType as never);
      expect(handler).toBeDefined();
      const wire = Object.fromEntries(row.projectFields.map((field) => [field, `v-${field}`]));
      const fn = backendFn(row.backendMethod);
      fn.mockResolvedValue({ success: true, ...wire });
      let response: unknown;
      await handler!(
        { type: row.messageType, payload: {}, traceId: 't' } as SqliteMessage,
        (r) => {
          response = r;
        },
      );
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(...row.backendArgs({}));
      expect(response).toEqual({ success: true, ...wire });
    });
  }
});

describe('derived backend proxies: one proxy per wire-table row', () => {
  it('every row backendMethod has a pack and a prototype method', () => {
    const packs = ARCHIVE_BACKEND_PACKS as Record<string, unknown>;
    const proto = OpfsWorkerBackend.prototype as unknown as Record<string, unknown>;
    for (const row of ARCHIVE_WIRE_TABLE) {
      expect(typeof packs[row.backendMethod]).toBe('function');
      expect(typeof proto[row.backendMethod]).toBe('function');
    }
  });

  // Zero-arg invocation keeps the loop fixture-free: the pack still builds a
  // payload (possibly undefined-valued) and the worker type routing plus the
  // descriptor-composed response are what this loop pins. `raw` is the WORKER
  // raw value (note archivePreview/archiveStatus wrap it via project — the
  // offscreen dispatch layer, not the backend, sees the field shape), and the
  // expected response is composed through the descriptor exactly like
  // proxyArchive does; per-op shape correctness stays pinned by
  // archiveWireDispatch.test.ts and wireLambdaFactories.test.ts.
  for (const row of ARCHIVE_WIRE_TABLE) {
    it(`${row.op}: proxy routes ${row.workerType} and composes the descriptor response`, async () => {
      const seen: Array<{ type: string; payload: unknown }> = [];
      const raw = `w-${row.op}`;
      const backend = new OpfsWorkerBackend(
        {
          tryOpfsProxy: (async (type: string, payload: unknown) => {
            seen.push({ type, payload });
            return raw;
          }) as never,
        } as never,
      );
      const method = (backend as unknown as Record<string, (...args: never[]) => Promise<unknown>>)[
        row.backendMethod
      ];
      expect(typeof method).toBe('function');
      // Member-call contract: production dispatch binds before invoking
      // (see the `this`-binding regression test in archiveWireDispatch).
      const result = await method.call(backend);
      expect(seen).toHaveLength(1);
      expect(seen[0]!.type).toBe(row.workerType);
      expect(result).toEqual({ success: true, ...row.project(raw) });
    });

    it(`${row.op}: null worker folds to the shared reason`, async () => {
      const backend = new OpfsWorkerBackend({ tryOpfsProxy: async () => null } as never);
      const method = (backend as unknown as Record<string, (...args: never[]) => Promise<unknown>>)[
        row.backendMethod
      ];
      await expect(method.call(backend)).resolves.toEqual({
        success: false,
        error: OPFS_WORKER_UNAVAILABLE_ERROR,
      });
    });
  }

  // Representative payload shapes (documentation, not coverage — the loops
  // above cover all ops; shapes per op stay in archiveWireDispatch.test.ts).
  it('packs the multi-arg query payload positionally', async () => {
    let captured: unknown;
    const backend = new OpfsWorkerBackend(
      {
        tryOpfsProxy: (async (_type: string, payload: unknown) => {
          captured = payload;
          return { rows: [], total: 0 };
        }) as never,
      } as never,
    );
    await backend.archiveQuery('s', 'q', 10, 5);
    expect(captured).toEqual({ stagingName: 's', query: 'q', limit: 10, offset: 5 });
  });

  it('passes create params through untouched', async () => {
    let captured: unknown;
    const backend = new OpfsWorkerBackend(
      {
        tryOpfsProxy: (async (_type: string, payload: unknown) => {
          captured = payload;
          return { stagingName: 's', recordCount: 1 };
        }) as never,
      } as never,
    );
    const params = { cutoffDate: '2026-01-01', cutoffMs: 1, includeDeleted: false, yasumaroVersion: 'v' };
    await backend.archiveCreate(params);
    expect(captured).toBe(params);
  });
});
