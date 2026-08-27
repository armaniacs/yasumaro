/**
 * sqliteEngine-comprehensive.test.ts
 * WASM/JS boundary tests for sqliteEngine.wrapDb — covers edge cases
 * that the basic sqliteEngine.test.ts does not: empty result shapes,
 * bigint handling, Uint8Array pass-through, exec with params, and
 * close() error propagation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRun = vi.fn();
const mockClose = vi.fn();
vi.mock('@subframe7536/sqlite-wasm', () => ({
  initSQLite: vi.fn(async () => ({
    run: mockRun,
    changes: vi.fn(() => 0),
    lastInsertRowId: vi.fn(() => 0),
    close: mockClose,
  })),
}));
vi.mock('@subframe7536/sqlite-wasm/opfs', () => ({
  useOpfsStorage: vi.fn((path: string, opts: { url: string }) => ({ path, url: opts.url })),
}));
vi.mock('@subframe7536/sqlite-wasm/idb', () => ({
  useIdbStorage: vi.fn((path: string, opts: { url: string }) => ({ path, url: opts.url })),
}));

import { createEngine, createIdbEngine } from '../sqliteEngine.js';

describe('sqliteEngine wrapDb edge cases', () => {
  beforeEach(() => {
    mockRun.mockReset();
    mockClose.mockReset();
  });

  // ── queryValue edge cases ───────────────────────────────────────────────

  it('queryValue() returns null when row exists but has no keys', async () => {
    mockRun.mockResolvedValue([{}]);
    const engine = await createEngine('test.db', 'wasm-url');
    const v = await engine.queryValue('SELECT * FROM t WHERE 1=0');
    expect(v).toBeNull();
  });

  it('queryValue() returns the value when row has a single key', async () => {
    mockRun.mockResolvedValue([{ total: BigInt(999999999999999) }]);
    const engine = await createEngine('test.db', 'wasm-url');
    const v = await engine.queryValue('SELECT total FROM counter');
    expect(v).toBe(BigInt(999999999999999));
  });

  it('queryValue() returns Uint8Array as-is from first row first column', async () => {
    const blob = new Uint8Array([0x01, 0x02, 0x03]);
    mockRun.mockResolvedValue([{ data: blob }]);
    const engine = await createEngine('test.db', 'wasm-url');
    const v = await engine.queryValue('SELECT data FROM blobs LIMIT 1');
    expect(v).toBeInstanceOf(Uint8Array);
    expect((v as Uint8Array)[0]).toBe(1);
  });

  it('queryValue() returns null when first row first column value is null', async () => {
    mockRun.mockResolvedValue([{ col: null }]);
    const engine = await createEngine('test.db', 'wasm-url');
    const v = await engine.queryValue('SELECT NULL AS col');
    expect(v).toBeNull();
  });

  it('queryValue() returns the value even if it is 0 (falsy but not null)', async () => {
    mockRun.mockResolvedValue([{ count: 0 }]);
    const engine = await createEngine('test.db', 'wasm-url');
    const v = await engine.queryValue('SELECT 0 AS count');
    expect(v).toBe(0);
  });

  it('queryValue() returns empty string as-is (falsy but not null)', async () => {
    mockRun.mockResolvedValue([{ name: '' }]);
    const engine = await createEngine('test.db', 'wasm-url');
    const v = await engine.queryValue("SELECT '' AS name");
    expect(v).toBe('');
  });

  // ── exec with parameters ────────────────────────────────────────────────

  it('exec() forwards parameters to the underlying run function', async () => {
    mockRun.mockResolvedValue([]);
    const engine = await createEngine('test.db', 'wasm-url');
    await engine.exec('INSERT INTO t (a, b) VALUES (?, ?)', ['hello', 42]);
    expect(mockRun).toHaveBeenCalledWith('INSERT INTO t (a, b) VALUES (?, ?)', ['hello', 42]);
  });

  it('exec() forwards Uint8Array params without transformation', async () => {
    mockRun.mockResolvedValue([]);
    const engine = await createEngine('test.db', 'wasm-url');
    const blob = new Uint8Array([0xff, 0xfe]);
    await engine.exec('INSERT INTO blobs (data) VALUES (?)', [blob]);
    expect(mockRun).toHaveBeenCalledWith('INSERT INTO blobs (data) VALUES (?)', [blob]);
  });

  it('exec() forwards null param', async () => {
    mockRun.mockResolvedValue([]);
    const engine = await createEngine('test.db', 'wasm-url');
    await engine.exec('INSERT INTO t (a) VALUES (?)', [null]);
    expect(mockRun).toHaveBeenCalledWith('INSERT INTO t (a) VALUES (?)', [null]);
  });

  // ── query with various SqliteValue types ────────────────────────────────

  it('query() handles rows with mixed value types', async () => {
    mockRun.mockResolvedValue([
      { id: 1, name: 'test', blob: new Uint8Array([1]), big: BigInt(42), nothing: null },
    ]);
    const engine = await createEngine('test.db', 'wasm-url');
    const rows = await engine.query('SELECT * FROM t');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(1);
    expect(rows[0]!.name).toBe('test');
    expect(rows[0]!.nothing).toBeNull();
  });

  it('query() returns empty array for zero-result queries', async () => {
    mockRun.mockResolvedValue([]);
    const engine = await createEngine('test.db', 'wasm-url');
    const rows = await engine.query('SELECT * FROM t WHERE 1=0');
    expect(rows).toEqual([]);
  });

  it('query() returns large result sets without truncation', async () => {
    const bigResult = Array.from({ length: 10000 }, (_, i) => ({ id: i, val: `v${i}` }));
    mockRun.mockResolvedValue(bigResult);
    const engine = await createEngine('test.db', 'wasm-url');
    const rows = await engine.query('SELECT * FROM t');
    expect(rows).toHaveLength(10000);
    expect(rows[0]!.id).toBe(0);
    expect(rows[9999]!.id).toBe(9999);
  });

  // ── close() error propagation ───────────────────────────────────────────

  it('close() propagates errors from the underlying WASM close', async () => {
    mockRun.mockResolvedValue([]);
    mockClose.mockRejectedValue(new Error('WASM memory already freed'));
    const engine = await createEngine('test.db', 'wasm-url');
    await expect(engine.close()).rejects.toThrow('WASM memory already freed');
  });

  // ── createIdbEngine ─────────────────────────────────────────────────────

  it('createIdbEngine() uses useIdbStorage with exclusive lock policy', async () => {
    const { useIdbStorage } = await import('@subframe7536/sqlite-wasm/idb');
    mockRun.mockResolvedValue([]);
    await createIdbEngine('test-idb.db', 'http://wasm/test.wasm');
    expect(useIdbStorage).toHaveBeenCalledWith('test-idb.db', {
      url: 'http://wasm/test.wasm',
      lockPolicy: 'exclusive',
    });
  });

  it('createIdbEngine() returns a working SqliteEngine', async () => {
    mockRun.mockResolvedValue([{ count: 5 }]);
    const engine = await createIdbEngine('test.db', 'wasm-url');
    const val = await engine.queryValue('SELECT COUNT(*) AS count');
    expect(val).toBe(5);
  });
});
