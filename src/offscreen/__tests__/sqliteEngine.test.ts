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

  it('exec() で DDL を実行する', async () => {
    mockRun.mockResolvedValue([]);
    const engine = await createEngine('test.db', 'wasm-url');
    await engine.exec('CREATE TABLE t (id INTEGER)');
    expect(mockRun).toHaveBeenCalledWith('CREATE TABLE t (id INTEGER)', undefined);
  });

  it('useOpfsStorage には { url } オブジェクトを渡す', async () => {
    const { useOpfsStorage } = await import('@subframe7536/sqlite-wasm/opfs');
    mockRun.mockResolvedValue([]);
    await createEngine('mydb.db', 'http://example/wa.wasm');
    expect(useOpfsStorage).toHaveBeenCalledWith('mydb.db', { url: 'http://example/wa.wasm' });
  });

  it('query() は名前付きカラムの行配列を返す', async () => {
    mockRun.mockResolvedValue([{ id: 1, title: 'a' }, { id: 2, title: 'b' }]);
    const engine = await createEngine('test.db', 'wasm-url');
    const rows = await engine.query('SELECT id, title FROM t WHERE id > ?', [0]);
    expect(rows).toEqual([{ id: 1, title: 'a' }, { id: 2, title: 'b' }]);
    expect(mockRun).toHaveBeenCalledWith('SELECT id, title FROM t WHERE id > ?', [0]);
  });

  it('queryValue() は最初の行の最初の列を返す', async () => {
    mockRun.mockResolvedValue([{ c: 42 }]);
    const engine = await createEngine('test.db', 'wasm-url');
    const v = await engine.queryValue('SELECT COUNT(*) AS c FROM t');
    expect(v).toBe(42);
  });

  it('queryValue() は行が無ければ null を返す', async () => {
    mockRun.mockResolvedValue([]);
    const engine = await createEngine('test.db', 'wasm-url');
    const v = await engine.queryValue('SELECT COUNT(*) AS c FROM t');
    expect(v).toBeNull();
  });

  it('close() を呼べる', async () => {
    mockRun.mockResolvedValue([]);
    const engine = await createEngine('test.db', 'wasm-url');
    await engine.close();
    expect(mockClose).toHaveBeenCalled();
  });
});
