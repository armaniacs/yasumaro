// @vitest-environment jsdom
/**
 * query-backends-parametric.test.ts
 * PBI-34: backend-parameterized difference-revealing test for the query path.
 *
 * Strategy per the PBI: visualize drift FIRST (same QuerySpec against the
 * idb / opfs-worker / fallback query paths), then unify the SQL assembly in
 * queryPlan.ts. Cases where backends intentionally diverge are asserted as
 * documented-divergence (marked INTENTIONAL) so a future silent unification
 * attempt fails loudly instead of changing search results.
 *
 * Backend access:
 * - idb: IdbVfsBackend over a stub engine capturing SQL text + params.
 * - opfs: opfsWorker search/crud handlers over a stub engine via
 *   __setEngineForTesting (captures the same SQL strings the Worker builds).
 * - fallback: real FallbackStorage (chrome.storage.local is mocked globally).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IdbVfsBackend } from '../IdbVfsBackend.js';
import { handleSearchFts, handleSearchLike, __setEngineForTesting } from '../opfsWorker.js';
import { handleQuery } from '../opfsWorker/crudHandlers.js';
import { handlePurgeOldRecords } from '../opfsWorker/purgeHandlers.js';
import { FallbackStorage } from '../storageFallback.js';
import { buildQuerySpec, QUERY_CAPS } from '../queryPlan.js';

function makeIdbStub(fts5Available = true, countResult = 0) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const engine = {
    fts5Available,
    execWithCache: vi.fn(async (sql: string, params: unknown[] = [], callback?: (row: unknown[]) => void) => {
      calls.push({ sql, params });
      if (callback && /SELECT COUNT|SELECT changes|last_insert_rowid/i.test(sql)) callback([countResult]);
    }),
  };
  const backend = new IdbVfsBackend(engine as never);
  (backend as unknown as { ensureDb: () => void }).ensureDb = () => {};
  return { backend, calls };
}

function makeOpfsStub(countResult = 0) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const engine = {
    exec: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
    }),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (/SELECT COUNT|SELECT changes/i.test(sql)) return [{ c: countResult }];
      return [];
    }),
    queryValue: vi.fn(async () => null),
    close: vi.fn(async () => undefined),
  };
  __setEngineForTesting(engine as never, true);
  return { engine, calls };
}

const rowSql = (calls: { sql: string }[]) =>
  calls.find((c) => /ORDER BY/i.test(c.sql) && !/COUNT/i.test(c.sql))?.sql ?? '';

describe('PBI-34 parametric: same logical search, SQL ORDER parity (idb vs opfs)', () => {
  beforeEach(() => {
    __setEngineForTesting(null, false);
  });

  const ftsCases = [
    { label: 'default relevance', orderBy: undefined, orderDir: undefined, expect: /ORDER BY rank/ },
    { label: 'created_at DESC', orderBy: 'created_at', orderDir: 'DESC', expect: /ORDER BY b\.created_at DESC, b\.id DESC/ },
    { label: 'created_at ASC', orderBy: 'created_at', orderDir: 'ASC', expect: /ORDER BY b\.created_at ASC, b\.id ASC/ },
  ] as const;

  it.each(ftsCases)('FTS path $label: idb and opfs emit the same ORDER BY', async ({ orderBy, orderDir, expect: re }) => {
    const idb = makeIdbStub(true);
    await idb.backend.query({ text: 'example query text', limit: 20, ...(orderBy ? { orderBy, orderDir } : {}) });
    const opfs = makeOpfsStub();
    await handleSearchFts('"example"', 20, 0, orderBy as 'created_at' | undefined, orderDir as 'ASC' | 'DESC' | undefined);
    expect(rowSql(idb.calls)).toMatch(re);
    expect(rowSql(opfs.calls)).toMatch(re);
  });

  it.each([
    { label: 'created_at ASC', orderBy: 'created_at', orderDir: 'ASC', expect: /ORDER BY created_at ASC/ },
    { label: 'default (DESC)', orderBy: undefined, orderDir: undefined, expect: /ORDER BY created_at DESC/ },
  ])('LIKE path $label: idb and opfs emit the same ORDER BY', async ({ orderBy, orderDir, expect: re }) => {
    const idb = makeIdbStub(false);
    await idb.backend.query({ text: 'ai', limit: 20, ...(orderBy ? { orderBy, orderDir } : {}) });
    const opfs = makeOpfsStub();
    await handleSearchLike('ai', 20, 0, orderBy as 'created_at' | undefined, orderDir as 'ASC' | 'DESC' | undefined);
    expect(rowSql(idb.calls)).toMatch(re);
    expect(rowSql(opfs.calls)).toMatch(re);
  });

  it('plain listing: idb.query and opfs handleQuery emit the same WHERE/ORDER/LIMIT shape', async () => {
    const idb = makeIdbStub(true);
    await idb.backend.query({ domain: 'example.com', starred: true, limit: 10, offset: 5, orderBy: 'created_at', orderDir: 'ASC' });
    const opfs = makeOpfsStub();
    await handleQuery({ engine: opfs.engine as never }, { domain: 'example.com', starred: true, limit: 10, offset: 5, orderBy: 'created_at', orderDir: 'ASC' });
    const idbRows = rowSql(idb.calls);
    const opfsRows = rowSql(opfs.calls);
    for (const sql of [idbRows, opfsRows]) {
      expect(sql).toMatch(/WHERE is_deleted = 0/);
      expect(sql).toMatch(/domain = \?/);
      expect(sql).toMatch(/is_starred = \?/);
      expect(sql).toMatch(/ORDER BY created_at ASC/);
      expect(sql).toMatch(/LIMIT \? OFFSET \?/);
    }
  });

  it('purge cap-delete: idb and opfs both preserve starred rows (same condition)', async () => {
    const idb = makeIdbStub(true, 1005);
    await idb.backend.purgeOldRecords(90, 1000);
    const opfs = makeOpfsStub(1005);
    await handlePurgeOldRecords({ engine: opfs.engine as never }, { retentionDays: 90, maxRecords: 1000 }, { postLog: () => {} });
    const excessSql = (calls: { sql: string }[]) =>
      calls.find((c) => /ORDER BY created_at ASC LIMIT/i.test(c.sql))?.sql ?? '';
    for (const sql of [excessSql(idb.calls), excessSql(opfs.calls)]) {
      expect(sql).toContain('is_starred = 0');
      expect(sql).toContain('is_deleted = 0');
    }
  });
});

describe('PBI-34 parametric: documented intentional divergences (do NOT unify silently)', () => {
  beforeEach(() => {
    __setEngineForTesting(null, false);
  });

  it('INTENTIONAL: invalid orderDir fails closed on idb but coerces to DESC on opfs', async () => {
    // IdbVfsBackend.query returns success:false so untrusted input arriving
    // over chrome.runtime.sendMessage can never reach string interpolation.
    const idb = makeIdbStub(true);
    const malicious = 'DESC; DROP TABLE browsing_logs; --';
    const res = await idb.backend.query({
      text: 'example query text', limit: 20, orderBy: 'created_at',
      orderDir: malicious as unknown as 'ASC' | 'DESC',
    });
    expect(res.success).toBe(false);
    expect(rowSql(idb.calls)).toBe('');

    // opfs search handlers predate the strict builder and normalize any
    // out-of-whitelist direction to DESC. Preserved as-is by PBI-34.
    const opfs = makeOpfsStub();
    await handleSearchFts('"example"', 20, 0, 'created_at', malicious as unknown as 'ASC' | 'DESC');
    const sql = rowSql(opfs.calls);
    expect(sql).toMatch(/ORDER BY b\.created_at DESC, b\.id DESC/);
    expect(sql).not.toContain('DROP TABLE');
  });

  it('INTENTIONAL: fallback search without orderBy keeps insertion order (no FTS5 rank)', async () => {
    // FallbackStorage has no FTS5, so rank is always 0 and there is nothing
    // relevance-ordered to sort by. SQL backends ORDER BY rank instead.
    const storage = new FallbackStorage();
    await storage.insert({ url: 'https://a.example.com', created_at: 100 });
    await storage.insert({ url: 'https://b.example.com', created_at: 300 });
    await storage.insert({ url: 'https://c.example.com', created_at: 200 });
    const result = await storage.search('example', 10, 0);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows.map((r) => r.created_at)).toEqual([100, 300, 200]);
      expect(result.rows.every((r) => r.rank === 0)).toBe(true);
    }
  });

  it('INTENTIONAL: fallback purge cap-delete can remove starred rows, SQL backends never do', async () => {
    // FallbackStorage.purgeOldRecords counts active rows (including starred)
    // and evicts the oldest regardless of is_starred, while the SQL
    // implementations restrict the excess-delete to is_starred = 0.
    // Same-condition unification would change fallback eviction behaviour,
    // so PBI-34 preserves both and documents the gap here.
    const now = Date.now();
    const storage = new FallbackStorage();
    await storage.insert({ url: 'https://old-starred.example.com', created_at: now - 2000, is_starred: 1 });
    await storage.insert({ url: 'https://new.example.com', created_at: now - 1000 });
    // retentionDays huge so the age-based phase is a no-op; only the cap
    // eviction fires (2 active > maxRecords 1) and takes the oldest row
    // even though it is starred.
    const result = await storage.purgeOldRecords(3650, 1);
    expect(result.success).toBe(true);
    if (result.success) expect(result.purged).toBe(1);
    const remaining = await storage.getAllRecords();
    expect(remaining.map((r) => r.url)).toEqual(['https://new.example.com']);

    const spec = buildQuerySpec({ limit: 10 }, { caps: QUERY_CAPS, fts5Available: true });
    expect(spec.limit).toBe(10);
  });
});

describe('PBI-34 parametric: shared LIMIT clamp across backends', () => {
  beforeEach(() => {
    __setEngineForTesting(null, false);
  });

  it.each([
    ['negative', -1, 100],
    ['zero', 0, 100],
    ['non-integer', 0.5, 100],
    ['huge', 1e9, 100000],
    ['normal', 50, 50],
  ])('idb queryAuditLog clamps limit=%s to %s in the LIMIT param', async (_label, raw, expected) => {
    const idb = makeIdbStub(true);
    await idb.backend.queryAuditLog({ limit: raw as number });
    const rowQuery = idb.calls.find((c) => /FROM audit_log ORDER BY/i.test(c.sql));
    expect(rowQuery?.params[0]).toBe(expected);
  });
});
