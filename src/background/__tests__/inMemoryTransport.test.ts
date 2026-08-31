/**
 * inMemoryTransport.test.ts
 * InMemoryTransport is a real (stateful) OffscreenTransport for tests:
 * SqliteGateway round-trips through it without an offscreen document or
 * any chrome.* API (PBI 2026-08-31-05, Scenario 5).
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logError: vi.fn(),
  ErrorCode: { STORAGE_READ_FAILURE: 'STRG_RD_001' },
}));
vi.mock('../sqliteAlert.js', () => ({
  recordSqliteSuccess: vi.fn(),
  recordSqliteFailure: vi.fn(),
}));

import { InMemoryTransport } from '../inMemoryTransport.js';
import { SqliteGateway } from '../sqliteGateway.js';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';

function rec(over: Partial<BrowsingLogRecord> = {}): BrowsingLogRecord {
  return { url: 'https://example.com/', domain: 'example.com', created_at: 1000, ...over };
}

describe('InMemoryTransport + SqliteGateway', () => {
  let transport: InMemoryTransport;
  let gateway: SqliteGateway;

  beforeEach(() => {
    transport = new InMemoryTransport();
    gateway = new SqliteGateway(transport);
  });

  it('status() returns without touching chrome APIs', async () => {
    const res = await gateway.status();
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.initialized).toBe(true);
      expect(res.data.path).toBe(':memory:');
    }
  });

  it('insert then query round-trips the record', async () => {
    const inserted = await gateway.mutate({ type: 'insert', record: rec({ title: 'Hello' }) });
    expect(inserted.success).toBe(true);

    const q = await gateway.query({});
    expect(q.success).toBe(true);
    if (q.success) {
      expect(q.data.total).toBe(1);
      expect(q.data.rows[0]?.title).toBe('Hello');
    }
  });

  it('query filters by domain', async () => {
    await gateway.mutate({ type: 'insert', record: rec({ domain: 'a.com', url: 'https://a.com/' }) });
    await gateway.mutate({ type: 'insert', record: rec({ domain: 'b.com', url: 'https://b.com/' }) });

    const q = await gateway.query({ domain: 'b.com' });
    expect(q.success && q.data.total).toBe(1);
    expect(q.success && q.data.rows[0]?.domain).toBe('b.com');
  });

  it('count reflects inserts and soft-deletes', async () => {
    const a = await gateway.mutate({ type: 'insert', record: rec() });
    await gateway.mutate({ type: 'insert', record: rec() });
    const beforeDelete = await gateway.query({ kind: 'count' });
    expect(beforeDelete.success && beforeDelete.data).toBe(2);

    if (a.success) await gateway.mutate({ type: 'delete', id: a.data.id });
    const afterDelete = await gateway.query({ kind: 'count' });
    expect(afterDelete.success && afterDelete.data).toBe(1);
  });

  it('toggleStar flips is_starred', async () => {
    const ins = await gateway.mutate({ type: 'insert', record: rec() });
    const id = ins.success ? ins.data.id : 0;

    const first = await gateway.mutate({ type: 'toggleStar', id });
    expect(first.success && first.data.is_starred).toBe(1);
    const second = await gateway.mutate({ type: 'toggleStar', id });
    expect(second.success && second.data.is_starred).toBe(0);
  });

  it('seeded records are queryable immediately', async () => {
    transport = new InMemoryTransport({ records: [rec({ title: 'seed-1' }), rec({ title: 'seed-2' })] });
    gateway = new SqliteGateway(transport);

    const q = await gateway.query({});
    expect(q.success && q.data.total).toBe(2);
  });

  it('text search matches title substring', async () => {
    await gateway.mutate({ type: 'insert', record: rec({ title: 'unique-token-here' }) });
    await gateway.mutate({ type: 'insert', record: rec({ title: 'something else' }) });

    const q = await gateway.query({ kind: 'search', text: 'unique-token' });
    expect(q.success && q.data.total).toBe(1);
  });

  it('clearAll empties the store', async () => {
    await gateway.mutate({ type: 'insert', record: rec() });
    await gateway.maintain({ type: 'clearAll' });
    expect(transport.wasCleared()).toBe(true);

    const q = await gateway.query({ kind: 'count' });
    expect(q.success && q.data).toBe(0);
  });
});
