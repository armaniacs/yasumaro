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

  // PBI 07 regression: ORDER BY must be string-aware (localeCompare) not (??0)
  it('ORDER BY title ASC sorts strings via localeCompare', async () => {
    // InMemory previously used (a[key] ?? 0) which broke string columns
    await gateway.mutate({ type: 'insert', record: rec({ title: 'cherry', url: 'https://example.com/3', created_at: 3000 }) });
    await gateway.mutate({ type: 'insert', record: rec({ title: 'apple', url: 'https://example.com/1', created_at: 1000 }) });
    await gateway.mutate({ type: 'insert', record: rec({ title: 'Banana', url: 'https://example.com/2', created_at: 2000 }) });

    const q = await gateway.query({ orderBy: 'title', orderDir: 'ASC' } as unknown as Record<string, unknown> as Parameters<typeof gateway.query>[0]);
    expect(q.success).toBe(true);
    if (q.success) {
      const titles = (q.data as { rows: BrowsingLogRecord[] }).rows.map((r) => r.title);
      const expected = ['apple', 'Banana', 'cherry'].slice().sort((a, b) => a.localeCompare(b));
      expect(titles).toEqual(expected);
      // Explicitly assert it is NOT ASCII order where Banana < apple
      expect(titles).not.toEqual(['Banana', 'apple', 'cherry']);
    }
  });

  it('ORDER BY url ASC sorts strings correctly', async () => {
    await gateway.mutate({ type: 'insert', record: rec({ url: 'https://example.com/c', title: 'c', created_at: 3 }) });
    await gateway.mutate({ type: 'insert', record: rec({ url: 'https://example.com/a', title: 'a', created_at: 1 }) });
    await gateway.mutate({ type: 'insert', record: rec({ url: 'https://example.com/b', title: 'b', created_at: 2 }) });

    const q = await gateway.query({ orderBy: 'url', orderDir: 'ASC' } as unknown as Record<string, unknown> as Parameters<typeof gateway.query>[0]);
    expect(q.success).toBe(true);
    if (q.success) {
      const urls = (q.data as { rows: BrowsingLogRecord[] }).rows.map((r) => r.url);
      const expected = ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'].slice().sort((a, b) => a.localeCompare(b));
      expect(urls).toEqual(expected);
    }
  });

  it('ORDER BY title DESC is reverse of ASC', async () => {
    await gateway.mutate({ type: 'insert', record: rec({ title: 'cherry', url: 'https://example.com/3', created_at: 3000 }) });
    await gateway.mutate({ type: 'insert', record: rec({ title: 'apple', url: 'https://example.com/1', created_at: 1000 }) });
    await gateway.mutate({ type: 'insert', record: rec({ title: 'Banana', url: 'https://example.com/2', created_at: 2000 }) });

    const asc = await gateway.query({ orderBy: 'title', orderDir: 'ASC' } as unknown as Record<string, unknown> as Parameters<typeof gateway.query>[0]);
    const desc = await gateway.query({ orderBy: 'title', orderDir: 'DESC' } as unknown as Record<string, unknown> as Parameters<typeof gateway.query>[0]);
    expect(asc.success && desc.success).toBe(true);
    if (asc.success && desc.success) {
      const ascTitles = (asc.data as { rows: BrowsingLogRecord[] }).rows.map((r) => r.title);
      const descTitles = (desc.data as { rows: BrowsingLogRecord[] }).rows.map((r) => r.title);
      expect(descTitles).toEqual([...ascTitles].reverse());
    }
  });

  it('numeric ORDER BY created_at still sorts numerically', async () => {
    await gateway.mutate({ type: 'insert', record: rec({ created_at: 3000, title: 'c' }) });
    await gateway.mutate({ type: 'insert', record: rec({ created_at: 1000, title: 'a' }) });
    await gateway.mutate({ type: 'insert', record: rec({ created_at: 2000, title: 'b' }) });

    const q = await gateway.query({ orderBy: 'created_at', orderDir: 'ASC' } as unknown as Record<string, unknown> as Parameters<typeof gateway.query>[0]);
    expect(q.success).toBe(true);
    if (q.success) {
      const ats = (q.data as { rows: BrowsingLogRecord[] }).rows.map((r) => r.created_at);
      expect(ats).toEqual([1000, 2000, 3000]);
    }
  });

  it('FTS uses shared sanitizeFtsTerm: operator-only text yields no rows', async () => {
    await gateway.mutate({ type: 'insert', record: rec({ title: 'hello world', url: 'https://example.com/1', created_at: 1000 }) });
    // 'OR' is stripped by sanitizeFtsTerm to '' -> should return 0 rows (shared tokenizer)
    // Old substringIncludes would have searched for 'or' and matched 'world'
    const q = await gateway.query({ text: 'OR' } as unknown as Record<string, unknown> as Parameters<typeof gateway.query>[0]);
    expect(q.success).toBe(true);
    if (q.success) {
      expect((q.data as { rows: BrowsingLogRecord[] }).total).toBe(0);
    }
  });

  it('shares caps with QUERY_CAPS: plain cap is 1000, FTS cap is 100000', async () => {
    const { QUERY_CAPS } = await import('../../offscreen/queryPlan.js');
    expect(QUERY_CAPS.plain).toBe(1000);
    expect(QUERY_CAPS.fts).toBe(100000);
    // InMemory must clamp using those same caps — insert 5 and request huge limit
    for (let i = 0; i < 5; i++) await gateway.mutate({ type: 'insert', record: rec({ title: `t${i}`, url: `https://example.com/${i}`, created_at: 1000 + i }) });
    const qPlain = await gateway.query({ limit: 999999 } as unknown as Record<string, unknown> as Parameters<typeof gateway.query>[0]);
    expect(qPlain.success).toBe(true);
    if (qPlain.success) {
      // limit is capped at plain 1000, so still returns all 5
      expect((qPlain.data as { rows: BrowsingLogRecord[] }).rows.length).toBe(5);
    }
  });
});
