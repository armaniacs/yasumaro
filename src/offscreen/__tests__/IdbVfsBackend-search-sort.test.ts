/**
 * IdbVfsBackend-search-sort.test.ts
 * Verifies IdbVfsBackend.query() with text search switches its ORDER BY clause
 * based on the orderBy option instead of always sorting by FTS5 rank.
 */
import { describe, it, expect, vi } from 'vitest';
import { IdbVfsBackend } from '../IdbVfsBackend.js';

function makeStubEngine(overrides: { fts5Available?: boolean } = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const engine = {
    fts5Available: overrides.fts5Available ?? true,
    execWithCache: vi.fn(async (sql: string, params: unknown[] = [], callback?: (row: unknown[]) => void) => {
      calls.push({ sql, params });
      // COUNT queries: report 0 total. Row queries: report no rows.
      if (callback && /SELECT COUNT/i.test(sql)) {
        callback([0]);
      }
    }),
  };
  return { engine, calls };
}

describe('IdbVfsBackend.query — search ORDER BY branch', () => {
  it('orders by rank when orderBy is omitted (default relevance)', async () => {
    const { engine, calls } = makeStubEngine();
    const backend = new IdbVfsBackend(engine as never);
    (backend as unknown as { ensureDb: () => void }).ensureDb = () => {};
    await backend.query({ text: 'example query text', limit: 20 });
    const rowQuery = calls.find(c => /ORDER BY/i.test(c.sql) && !/COUNT/i.test(c.sql));
    expect(rowQuery?.sql).toMatch(/ORDER BY rank/);
  });

  it('orders by created_at DESC when orderBy=created_at, orderDir=DESC', async () => {
    const { engine, calls } = makeStubEngine();
    const backend = new IdbVfsBackend(engine as never);
    (backend as unknown as { ensureDb: () => void }).ensureDb = () => {};
    await backend.query({ text: 'example query text', limit: 20, orderBy: 'created_at', orderDir: 'DESC' });
    const rowQuery = calls.find(c => /ORDER BY/i.test(c.sql) && !/COUNT/i.test(c.sql));
    expect(rowQuery?.sql).toMatch(/ORDER BY b\.created_at DESC, b\.id DESC/);
  });

  it('orders by created_at ASC when orderBy=created_at, orderDir=ASC', async () => {
    const { engine, calls } = makeStubEngine();
    const backend = new IdbVfsBackend(engine as never);
    (backend as unknown as { ensureDb: () => void }).ensureDb = () => {};
    await backend.query({ text: 'example query text', limit: 20, orderBy: 'created_at', orderDir: 'ASC' });
    const rowQuery = calls.find(c => /ORDER BY/i.test(c.sql) && !/COUNT/i.test(c.sql));
    expect(rowQuery?.sql).toMatch(/ORDER BY b\.created_at ASC, b\.id ASC/);
  });

  it('LIKE fallback path (short query) orders by created_at when requested', async () => {
    const { engine, calls } = makeStubEngine({ fts5Available: false });
    const backend = new IdbVfsBackend(engine as never);
    (backend as unknown as { ensureDb: () => void }).ensureDb = () => {};
    await backend.query({ text: 'ai', limit: 20, orderBy: 'created_at', orderDir: 'ASC' });
    const rowQuery = calls.find(c => /ORDER BY/i.test(c.sql) && !/COUNT/i.test(c.sql));
    expect(rowQuery?.sql).toMatch(/ORDER BY created_at ASC/);
  });

  it('rejects an orderDir value outside the ASC/DESC whitelist instead of interpolating it', async () => {
    const { engine, calls } = makeStubEngine();
    const backend = new IdbVfsBackend(engine as never);
    (backend as unknown as { ensureDb: () => void }).ensureDb = () => {};
    // Simulates a value that bypassed the TypeScript type at a message-passing
    // boundary (chrome.runtime.sendMessage does not enforce it at runtime).
    const malicious = 'DESC; DROP TABLE browsing_logs; --';
    const result = await backend.query({
      text: 'example query text', limit: 20, orderBy: 'created_at',
      orderDir: malicious as unknown as 'ASC' | 'DESC',
    });
    expect(result.success).toBe(false);
    const rowQuery = calls.find(c => /ORDER BY/i.test(c.sql) && !/COUNT/i.test(c.sql));
    expect(rowQuery).toBeUndefined();
  });
});

describe('IdbVfsBackend.queryAuditLog — limit clamp', () => {
  it.each([
    ['negative', -1, 100],
    ['zero', 0, 100],
    ['non-integer', 0.5, 100],
    ['huge', 1e9, 100000],
    ['normal', 50, 50],
  ])('clamps limit=%s to %s in the LIMIT param', async (_label, raw, expected) => {
    const { engine, calls } = makeStubEngine();
    const backend = new IdbVfsBackend(engine as never);
    (backend as unknown as { ensureDb: () => void }).ensureDb = () => {};
    await backend.queryAuditLog({ limit: raw as number });
    const rowQuery = calls.find(c => /FROM audit_log ORDER BY/i.test(c.sql));
    expect(rowQuery?.params[0]).toBe(expected);
  });
});
