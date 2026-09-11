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

import { createEngine } from '../sqliteEngine.js';

describe('sqliteEngine', () => {
  beforeEach(() => {
    mockRun.mockReset();
    mockClose.mockReset();
  });

  it('executes DDL via exec()', async () => {
    mockRun.mockResolvedValue([]);
    const engine = await createEngine('test.db', 'wasm-url');
    await engine.exec('CREATE TABLE t (id INTEGER)');
    expect(mockRun).toHaveBeenCalledWith('CREATE TABLE t (id INTEGER)', undefined);
  });

  it('passes a { url } object to useOpfsStorage', async () => {
    const { useOpfsStorage } = await import('@subframe7536/sqlite-wasm/opfs');
    mockRun.mockResolvedValue([]);
    await createEngine('mydb.db', 'http://example/wa.wasm');
    expect(useOpfsStorage).toHaveBeenCalledWith('mydb.db', { url: 'http://example/wa.wasm' });
  });

  it('query() returns an array of rows with named columns', async () => {
    mockRun.mockResolvedValue([{ id: 1, title: 'a' }, { id: 2, title: 'b' }]);
    const engine = await createEngine('test.db', 'wasm-url');
    const rows = await engine.query('SELECT id, title FROM t WHERE id > ?', [0]);
    expect(rows).toEqual([{ id: 1, title: 'a' }, { id: 2, title: 'b' }]);
    expect(mockRun).toHaveBeenCalledWith('SELECT id, title FROM t WHERE id > ?', [0]);
  });

  it('queryValue() returns the first column of the first row', async () => {
    mockRun.mockResolvedValue([{ c: 42 }]);
    const engine = await createEngine('test.db', 'wasm-url');
    const v = await engine.queryValue('SELECT COUNT(*) AS c FROM t');
    expect(v).toBe(42);
  });

  it('queryValue() returns null when there are no rows', async () => {
    mockRun.mockResolvedValue([]);
    const engine = await createEngine('test.db', 'wasm-url');
    const v = await engine.queryValue('SELECT COUNT(*) AS c FROM t');
    expect(v).toBeNull();
  });

  it('can call close()', async () => {
    mockRun.mockResolvedValue([]);
    const engine = await createEngine('test.db', 'wasm-url');
    await engine.close();
    expect(mockClose).toHaveBeenCalled();
  });

  it('queryValue() returns null when a row is an empty object (firstKey undefined)', async () => {
    mockRun.mockResolvedValue([{}] as any);
    const engine = await createEngine('test.db', 'wasm-url');
    const v = await engine.queryValue('SELECT COUNT(*) AS c FROM t');
    expect(v).toBeNull();
  });

  it('queryValue() returns null when the value is null (nullish coalescing fallback)', async () => {
    mockRun.mockResolvedValue([{ c: null }] as any);
    const engine = await createEngine('test.db', 'wasm-url');
    const v = await engine.queryValue('SELECT COUNT(*) AS c FROM t');
    expect(v).toBeNull();
  });

  it('queryValue() returns null when the value is undefined', async () => {
    mockRun.mockResolvedValue([{ c: undefined }] as any);
    const engine = await createEngine('test.db', 'wasm-url');
    const v = await engine.queryValue('SELECT COUNT(*) AS c FROM t');
    expect(v).toBeNull();
  });

  it('queryValue() returns null when firstRow is falsy', async () => {
    mockRun.mockResolvedValue([undefined] as any);
    const engine = await createEngine('test.db', 'wasm-url');
    const v = await engine.queryValue('SELECT COUNT(*) AS c FROM t');
    expect(v).toBeNull();
  });
});
