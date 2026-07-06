// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { SearchResult } from '../../utils/sqlite-types.js';

interface WorkerMessage {
  id: number;
  type: string;
  payload?: unknown;
}

interface AuditLogRecord {
  provider: string;
  url: string;
  created_at: number;
}

const fakeWorkerMessages: WorkerMessage[] = [];
const auditLogRecords: (AuditLogRecord & { id: number })[] = [];
let nextAuditLogId = 1;

class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;

  postMessage(msg: WorkerMessage): void {
    fakeWorkerMessages.push(msg);
    const { id, type, payload } = msg;
    let result: unknown;

    if (type === 'INIT') {
      result = { initialized: true };
    } else if (type === 'STATUS') {
      result = { initialized: true, path: 'yasumaro.db', fallback: false, fts5: true, count: 0 };
    } else if (type === 'AUDIT_LOG_INSERT') {
      const record = payload as AuditLogRecord;
      const auditId = nextAuditLogId++;
      auditLogRecords.push({ ...record, id: auditId });
      result = { id: auditId };
    } else if (type === 'AUDIT_LOG_QUERY') {
      const options = payload as { limit?: number; offset?: number };
      const limit = options.limit ?? 100;
      const offset = options.offset ?? 0;
      const sorted = [...auditLogRecords].sort((a, b) => b.created_at - a.created_at);
      const paginated = sorted.slice(offset, offset + limit);
      result = { rows: paginated, total: auditLogRecords.length };
    } else {
      result = {};
    }

    Promise.resolve().then(() => {
      if (this.onmessage) {
        this.onmessage({ data: { id, success: true, result } });
      }
    });
  }

  terminate(): void {
    // no-op
  }
}

let resetForTesting: () => void;

beforeEach(async () => {
  vi.resetModules();
  fakeWorkerMessages.length = 0;
  auditLogRecords.length = 0;
  nextAuditLogId = 1;

  Object.defineProperty(globalThis.navigator, 'storage', {
    value: { getDirectory: vi.fn() },
    writable: true,
    configurable: true,
  });

  vi.stubGlobal('Worker', FakeWorker);

  const mod = await import('../sqlite.js');
  resetForTesting = mod._resetForTesting;
});

afterEach(() => {
  if (resetForTesting) resetForTesting();
  vi.unstubAllGlobals();
});

describe('audit_log', () => {
  it('inserts an audit log entry and returns its id', async () => {
    const mod = await import('../sqlite.js');

    await mod.init();
    const result = await mod.insertAuditLog({ provider: 'gemini', url: 'https://example.com/page', created_at: 1700000000000 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.id).toBeGreaterThan(0);
    }
  });

  it('queries audit log entries ordered by created_at DESC', async () => {
    const mod = await import('../sqlite.js');

    await mod.init();
    await mod.insertAuditLog({ provider: 'gemini', url: 'https://example.com/a', created_at: 1000 });
    await mod.insertAuditLog({ provider: 'openai', url: 'https://example.com/b', created_at: 2000 });

    const result = await mod.queryAuditLog({ limit: 10, offset: 0 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].url).toBe('https://example.com/b');
      expect(result.rows[1].url).toBe('https://example.com/a');
    }
  });

  it('respects limit and offset', async () => {
    const mod = await import('../sqlite.js');

    await mod.init();
    await mod.insertAuditLog({ provider: 'gemini', url: 'https://example.com/a', created_at: 1000 });
    await mod.insertAuditLog({ provider: 'openai', url: 'https://example.com/b', created_at: 2000 });
    await mod.insertAuditLog({ provider: 'gemini', url: 'https://example.com/c', created_at: 3000 });

    const result = await mod.queryAuditLog({ limit: 1, offset: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].url).toBe('https://example.com/b');
    }
  });
});
