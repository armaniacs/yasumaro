// @vitest-environment jsdom
/**
 * opfsWorker-search-sort.test.ts
 * Verifies handleSearchFts/handleSearchLike switch their ORDER BY clause
 * based on orderBy/orderDir instead of always sorting by FTS5 rank.
 * Uses __setEngineForTesting to inject a fake engine directly, bypassing
 * initSqlite() (schema creation, migrations, chrome.storage) entirely —
 * this test only cares about the SQL string sqlQuery() builds.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSearchFts, handleSearchLike, __setEngineForTesting } from '../opfsWorker.js';

function makeStubEngine() {
  const calls: { sql: string; params: unknown[] }[] = [];
  // Matches the real SqliteEngine interface (src/offscreen/sqliteEngine.ts:9-14):
  // exec/query/queryValue/close — confirmed by reading that file directly.
  const engine = {
    exec: vi.fn(async () => undefined),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/SELECT COUNT/i.test(sql)) return [{ c: 0 }];
      return [];
    }),
    queryValue: vi.fn(async () => null),
    close: vi.fn(async () => undefined),
  };
  return { engine, calls };
}

describe('opfsWorker handleSearchFts/handleSearchLike — ORDER BY branch', () => {
  beforeEach(() => {
    __setEngineForTesting(null, false);
  });

  it('handleSearchFts orders by rank when orderBy is omitted', async () => {
    const { engine, calls } = makeStubEngine();
    __setEngineForTesting(engine as never, true);
    await handleSearchFts('"example"', 20, 0);
    const rowQuery = calls.find(c => /ORDER BY/i.test(c.sql) && !/COUNT/i.test(c.sql));
    expect(rowQuery?.sql).toMatch(/ORDER BY rank/);
  });

  it('handleSearchFts orders by created_at DESC when orderBy=created_at, orderDir=DESC', async () => {
    const { engine, calls } = makeStubEngine();
    __setEngineForTesting(engine as never, true);
    await handleSearchFts('"example"', 20, 0, 'created_at', 'DESC');
    const rowQuery = calls.find(c => /ORDER BY/i.test(c.sql) && !/COUNT/i.test(c.sql));
    expect(rowQuery?.sql).toMatch(/ORDER BY b\.created_at DESC, b\.id DESC/);
  });

  it('handleSearchFts orders by created_at ASC when orderBy=created_at, orderDir=ASC', async () => {
    const { engine, calls } = makeStubEngine();
    __setEngineForTesting(engine as never, true);
    await handleSearchFts('"example"', 20, 0, 'created_at', 'ASC');
    const rowQuery = calls.find(c => /ORDER BY/i.test(c.sql) && !/COUNT/i.test(c.sql));
    expect(rowQuery?.sql).toMatch(/ORDER BY b\.created_at ASC, b\.id ASC/);
  });

  it('handleSearchLike (short-query fallback) orders by created_at when requested', async () => {
    const { engine, calls } = makeStubEngine();
    __setEngineForTesting(engine as never, false);
    await handleSearchLike('ai', 20, 0, 'created_at', 'ASC');
    const rowQuery = calls.find(c => /ORDER BY/i.test(c.sql) && !/COUNT/i.test(c.sql));
    expect(rowQuery?.sql).toMatch(/ORDER BY created_at ASC/);
  });

  it('handleSearchLike defaults to created_at DESC when orderBy is omitted', async () => {
    const { engine, calls } = makeStubEngine();
    __setEngineForTesting(engine as never, false);
    await handleSearchLike('ai', 20, 0);
    const rowQuery = calls.find(c => /ORDER BY/i.test(c.sql) && !/COUNT/i.test(c.sql));
    expect(rowQuery?.sql).toMatch(/ORDER BY created_at DESC/);
  });

  it('handleSearchFts normalizes an out-of-whitelist orderDir to DESC instead of interpolating it', async () => {
    const { engine, calls } = makeStubEngine();
    __setEngineForTesting(engine as never, true);
    const malicious = 'DESC; DROP TABLE browsing_logs; --';
    await handleSearchFts('"example"', 20, 0, 'created_at', malicious as unknown as 'ASC' | 'DESC');
    const rowQuery = calls.find(c => /ORDER BY/i.test(c.sql) && !/COUNT/i.test(c.sql));
    expect(rowQuery?.sql).toMatch(/ORDER BY b\.created_at DESC, b\.id DESC/);
    expect(rowQuery?.sql).not.toContain('DROP TABLE');
  });

  it('handleSearchLike normalizes an out-of-whitelist orderDir to DESC instead of interpolating it', async () => {
    const { engine, calls } = makeStubEngine();
    __setEngineForTesting(engine as never, false);
    const malicious = 'DESC; DROP TABLE browsing_logs; --';
    await handleSearchLike('ai', 20, 0, 'created_at', malicious as unknown as 'ASC' | 'DESC');
    const rowQuery = calls.find(c => /ORDER BY/i.test(c.sql) && !/COUNT/i.test(c.sql));
    expect(rowQuery?.sql).toMatch(/ORDER BY created_at DESC/);
    expect(rowQuery?.sql).not.toContain('DROP TABLE');
  });
});
