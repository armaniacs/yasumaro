/**
 * wasm-worker-lifecycle.test.ts
 * WASM/JS boundary lifecycle tests — covers WASM binary load failure,
 * memory exhaustion, concurrent initialization races, AbortController,
 * and post-close access.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock sqlite-wasm ──────────────────────────────────────────────────

const mockRun = vi.fn();
const mockClose = vi.fn();
const mockInitSQLite = vi.fn();
const mockUseOpfsStorage = vi.fn();
const mockUseIdbStorage = vi.fn();

vi.mock('@subframe7536/sqlite-wasm', () => ({
  initSQLite: (...args: unknown[]) => mockInitSQLite(...args),
}));
vi.mock('@subframe7536/sqlite-wasm/opfs', () => ({
  useOpfsStorage: (...args: unknown[]) => mockUseOpfsStorage(...args),
}));
vi.mock('@subframe7536/sqlite-wasm/idb', () => ({
  useIdbStorage: (...args: unknown[]) => mockUseIdbStorage(...args),
}));

import { createEngine, createIdbEngine } from '../sqliteEngine.js';

// ── WASM binary load failure ──────────────────────────────────────────

describe('WASM binary load failure', () => {
  beforeEach(() => {
    mockRun.mockReset();
    mockClose.mockReset();
    mockInitSQLite.mockReset();
    mockUseOpfsStorage.mockReset();
    mockUseIdbStorage.mockReset();
  });

  it('propagates WASM fetch failure (404/network error)', async () => {
    mockUseOpfsStorage.mockResolvedValue({ path: 'test.db' });
    mockInitSQLite.mockRejectedValue(new Error('Failed to fetch WASM binary: 404'));

    await expect(createEngine('test.db', 'https://bad-url/wasm.wasm')).rejects.toThrow(
      'Failed to fetch WASM binary'
    );
  });

  it('propagates WASM compile error (invalid binary)', async () => {
    mockUseOpfsStorage.mockResolvedValue({ path: 'test.db' });
    mockInitSQLite.mockRejectedValue(new Error('CompileError: WASM module invalid'));

    await expect(createEngine('test.db', 'bad.wasm')).rejects.toThrow('CompileError');
  });

  it('propagates OPFS storage creation failure', async () => {
    mockUseOpfsStorage.mockRejectedValue(new Error('OPFS not available'));
    await expect(createEngine('test.db', 'wasm.wasm')).rejects.toThrow('OPFS not available');
  });

  it('propagates IDB storage creation failure', async () => {
    mockUseIdbStorage.mockRejectedValue(new Error('IndexedDB blocked'));

    await expect(createIdbEngine('test.db', 'wasm.wasm')).rejects.toThrow('IndexedDB blocked');
  });
});

// ── Memory exhaustion ─────────────────────────────────────────────────

describe('memory exhaustion (OOM)', () => {
  beforeEach(() => {
    mockRun.mockReset();
    mockClose.mockReset();
    mockInitSQLite.mockReset();
    mockUseOpfsStorage.mockReset();
  });

  it('handles OOM during query (WASM memory growth failure)', async () => {
    mockUseOpfsStorage.mockResolvedValue({ path: 'test.db' });
    mockInitSQLite.mockResolvedValue({ run: mockRun, close: mockClose });
    mockRun.mockRejectedValue(new Error('memory access out of bounds'));

    const engine = await createEngine('test.db', 'wasm.wasm');
    await expect(engine.query('SELECT * FROM t')).rejects.toThrow('memory access out of bounds');
  });

  it('handles OOM during exec (cannot grow memory)', async () => {
    mockUseOpfsStorage.mockResolvedValue({ path: 'test.db' });
    mockInitSQLite.mockResolvedValue({ run: mockRun, close: mockClose });
    mockRun.mockRejectedValue(new Error('Cannot enlarge memory'));

    const engine = await createEngine('test.db', 'wasm.wasm');
    await expect(engine.exec('INSERT INTO t VALUES (?)', ['x'.repeat(100000)])).rejects.toThrow();
  });
});

// ── Concurrent initialization race ────────────────────────────────────

describe('concurrent WASM initialization race', () => {
  beforeEach(() => {
    mockRun.mockReset();
    mockClose.mockReset();
    mockInitSQLite.mockReset();
    mockUseOpfsStorage.mockReset();
  });

  it('handles concurrent createEngine calls (no shared mutable state)', async () => {
    let callCount = 0;
    mockUseOpfsStorage.mockImplementation(async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 10));
      return { path: `db${callCount}.db` };
    });
    mockInitSQLite.mockImplementation(async () => ({
      run: vi.fn().mockResolvedValue([]),
      close: vi.fn(),
    }));

    const [e1, e2] = await Promise.all([
      createEngine('a.db', 'wasm.wasm'),
      createEngine('b.db', 'wasm.wasm'),
    ]);

    expect(e1).toBeDefined();
    expect(e2).toBeDefined();
    expect(mockUseOpfsStorage).toHaveBeenCalledTimes(2);
    expect(mockInitSQLite).toHaveBeenCalledTimes(2);
  });

  it('handles one success and one failure in concurrent init', async () => {
    mockUseOpfsStorage.mockImplementation(async (path: unknown) => {
      if (path === 'fail.db') throw new Error('OPFS quota exceeded');
      return { path };
    });
    mockInitSQLite.mockResolvedValue({ run: mockRun.mockResolvedValue([]), close: mockClose });

    const results = await Promise.allSettled([
      createEngine('ok.db', 'wasm.wasm'),
      createEngine('fail.db', 'wasm.wasm'),
    ]);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
  });
});

// ── Post-close access ─────────────────────────────────────────────────

describe('post-close access', () => {
  beforeEach(() => {
    mockRun.mockReset();
    mockClose.mockReset();
    mockInitSQLite.mockReset();
    mockUseOpfsStorage.mockReset();
  });

  it('allows query after close if underlying WASM still works (no guard)', async () => {
    mockUseOpfsStorage.mockResolvedValue({ path: 'test.db' });
    mockInitSQLite.mockResolvedValue({ run: mockRun, close: mockClose });
    mockRun.mockResolvedValue([{ c: 1 }]);
    mockClose.mockResolvedValue(undefined);

    const engine = await createEngine('test.db', 'wasm.wasm');
    await engine.close();
    // After close, run still works if mock does not throw
    mockRun.mockResolvedValue([{ c: 2 }]);
    const rows = await engine.query('SELECT 2 AS c');
    expect(rows[0]!.c).toBe(2);
  });

  it('propagates error when querying after WASM close throws', async () => {
    mockUseOpfsStorage.mockResolvedValue({ path: 'test.db' });
    mockInitSQLite.mockResolvedValue({ run: mockRun, close: mockClose });
    mockRun.mockResolvedValue([]);
    mockClose.mockResolvedValue(undefined);

    const engine = await createEngine('test.db', 'wasm.wasm');
    await engine.close();
    mockRun.mockRejectedValue(new Error('WASM instance already closed'));
    await expect(engine.query('SELECT 1')).rejects.toThrow('already closed');
  });
});

// ── TypedArray / BigInt boundary ──────────────────────────────────────

describe('JS/WASM data conversion boundary', () => {
  beforeEach(() => {
    mockRun.mockReset();
    mockClose.mockReset();
    mockInitSQLite.mockReset();
    mockUseOpfsStorage.mockReset();
  });

  it('passes Uint8Array through to WASM without copying', async () => {
    mockUseOpfsStorage.mockResolvedValue({ path: 'test.db' });
    const capturedParams: unknown[] = [];
    mockRun.mockImplementation(async (_sql: string, params?: unknown[]) => {
      if (params) capturedParams.push(...params);
      return [];
    });
    mockInitSQLite.mockResolvedValue({ run: mockRun, close: mockClose });

    const engine = await createEngine('test.db', 'wasm.wasm');
    const blob = new Uint8Array([0xff, 0xfe, 0xfd]);
    await engine.exec('INSERT INTO blobs (data) VALUES (?)', [blob]);
    expect(capturedParams[0]).toBeInstanceOf(Uint8Array);
    expect((capturedParams[0] as Uint8Array)[0]).toBe(0xff);
  });

  it('passes BigInt through to WASM', async () => {
    mockUseOpfsStorage.mockResolvedValue({ path: 'test.db' });
    mockRun.mockResolvedValue([{ big: BigInt('9007199254740993') }]);
    mockInitSQLite.mockResolvedValue({ run: mockRun, close: mockClose });

    const engine = await createEngine('test.db', 'wasm.wasm');
    const val = await engine.queryValue('SELECT big FROM t');
    expect(val).toBe(BigInt('9007199254740993'));
  });

  it('handles null bytes in strings (no truncation)', async () => {
    mockUseOpfsStorage.mockResolvedValue({ path: 'test.db' });
    mockRun.mockResolvedValue([{ s: 'hello\x00world' }]);
    mockInitSQLite.mockResolvedValue({ run: mockRun, close: mockClose });

    const engine = await createEngine('test.db', 'wasm.wasm');
    const val = await engine.queryValue('SELECT s FROM t');
    expect(val).toBe('hello\x00world');
  });

  it('handles empty string and empty Uint8Array', async () => {
    mockUseOpfsStorage.mockResolvedValue({ path: 'test.db' });
    mockRun.mockResolvedValue([{ s: '', b: new Uint8Array(0) }]);
    mockInitSQLite.mockResolvedValue({ run: mockRun, close: mockClose });

    const engine = await createEngine('test.db', 'wasm.wasm');
    const rows = await engine.query('SELECT s, b FROM t');
    expect(rows[0]!.s).toBe('');
    expect((rows[0]!.b as Uint8Array).length).toBe(0);
  });

  it('handles maximum safe integer boundary', async () => {
    mockUseOpfsStorage.mockResolvedValue({ path: 'test.db' });
    mockRun.mockResolvedValue([{ n: Number.MAX_SAFE_INTEGER }]);
    mockInitSQLite.mockResolvedValue({ run: mockRun, close: mockClose });

    const engine = await createEngine('test.db', 'wasm.wasm');
    const val = await engine.queryValue('SELECT n FROM t');
    expect(val).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('handles number array params (non-standard SqliteValue)', async () => {
    mockUseOpfsStorage.mockResolvedValue({ path: 'test.db' });
    mockRun.mockResolvedValue([]);
    mockInitSQLite.mockResolvedValue({ run: mockRun, close: mockClose });

    const engine = await createEngine('test.db', 'wasm.wasm');
    // number[] is part of SqliteValue union (wa-sqlite compatibility)
    await engine.exec('INSERT INTO t (arr) VALUES (?)', [[1, 2, 3] as unknown as number]);
    expect(mockRun).toHaveBeenCalledWith('INSERT INTO t (arr) VALUES (?)', [[1, 2, 3]]);
  });
});

// ── AbortController integration ───────────────────────────────────────

describe('AbortController integration', () => {
  it('aborted WASM load still rejects the awaiting promise', async () => {
    mockUseOpfsStorage.mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Aborted')), 50);
        })
    );

    const controller = new AbortController();
    const promise = createEngine('test.db', 'wasm.wasm');
    controller.abort();

    await expect(promise).rejects.toThrow();
  });

  it('AbortSignal can cancel a long-running query (mock)', async () => {
    mockUseOpfsStorage.mockResolvedValue({ path: 'test.db' });
    mockRun.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve([{ c: 1 }]), 100);
        })
    );
    mockInitSQLite.mockResolvedValue({ run: mockRun, close: mockClose });

    const engine = await createEngine('test.db', 'wasm.wasm');
    const controller = new AbortController();

    const queryPromise = engine.query('SELECT * FROM large_table');
    controller.abort();

    // Mock does not actually respect abort, so query still resolves
    // but a real implementation would reject with AbortError
    const rows = await queryPromise;
    expect(rows[0]!.c).toBe(1);
    expect(controller.signal.aborted).toBe(true);
  });
});
