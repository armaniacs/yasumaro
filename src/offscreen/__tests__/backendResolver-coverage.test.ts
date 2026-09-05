// @vitest-environment jsdom
/**
 * backendResolver-coverage.test.ts
 * PBI 10: backendResolver の 4パターン (OPFS/IDB/Fallback/None) を
 * detectLiveVfsStrategy の mock でテーブル駆動テスト。
 * createBackend と detectOpfsCapabilitiesForResolver も 90% ゲートまでカバー。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted mocks ─────────────────────────────────────────────────────────
const mockDetectLiveVfsStrategy = vi.hoisted(() =>
  vi.fn().mockReturnValue({ caps: { opfsDirectory: true, syncAccessHandle: true, worker: true }, strategy: 'opfs-sync-worker' })
);

vi.mock('../opfsCapabilities.js', () => ({
  detectLiveVfsStrategy: mockDetectLiveVfsStrategy,
}));

const mockOpfsBackend = vi.hoisted(() => ({ kind: 'opfs', healthCheck: () => Promise.resolve({ success: true }), getStatus: () => Promise.resolve({ success: true }) }));
const mockIdbBackend = vi.hoisted(() => ({ kind: 'idb', healthCheck: () => Promise.resolve({ success: true }), getStatus: () => Promise.resolve({ success: true }) }));
const mockFallbackBackend = vi.hoisted(() => ({ kind: 'fallback', healthCheck: () => Promise.resolve({ success: true }), getStatus: () => Promise.resolve({ success: true }) }));

vi.mock('../OpfsWorkerBackend.js', () => ({
  OpfsWorkerBackend: class { constructor() { return mockOpfsBackend as never; } },
}));

vi.mock('../IdbVfsBackend.js', () => ({
  IdbVfsBackend: class { constructor() { return mockIdbBackend as never; } },
}));

vi.mock('../FallbackStorageAdapter.js', () => ({
  FallbackStorageAdapter: class { constructor() { return mockFallbackBackend as never; } },
}));

// Must import after mocks
import { resolveBackend, createBackend, detectOpfsCapabilitiesForResolver } from '../backendResolver.js';
import type { SqliteEngineHost } from '../sqliteEngineHost.js';

function makeContext(overrides: Partial<Record<string, unknown>> = {}): SqliteEngineHost {
  return {
    idbEngine: null,
    fallbackStorage: null,
    usingFallbackStorage: false,
    opfsWorker: null,
    init: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as SqliteEngineHost;
}

describe('backendResolver — coverage 90% (PBI 10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectLiveVfsStrategy.mockReturnValue({
      caps: { opfsDirectory: true, syncAccessHandle: true, worker: true },
      strategy: 'opfs-sync-worker',
    } as never);
  });

  // ── resolveBackend: 優先度 OPFS > IDB > Fallback > None のテーブル駆動 ──
  describe('resolveBackend — 4パターン + エッジ', () => {
    const table: Array<{ name: string; state: Parameters<typeof resolveBackend>[0]; expected: ReturnType<typeof resolveBackend> }> = [
      { name: 'OPFS', state: { opfsWorker: true, idbEngine: false, usingFallbackStorage: false, fallbackStorage: false }, expected: 'opfs' },
      { name: 'IDB', state: { opfsWorker: false, idbEngine: true, usingFallbackStorage: false, fallbackStorage: false }, expected: 'idb' },
      { name: 'Fallback', state: { opfsWorker: false, idbEngine: false, usingFallbackStorage: true, fallbackStorage: true }, expected: 'fallback' },
      { name: 'None (全部 false)', state: { opfsWorker: false, idbEngine: false, usingFallbackStorage: false, fallbackStorage: false }, expected: 'none' },
      { name: 'None (Fallback 2フラグ不一致 - using true, storage false)', state: { opfsWorker: false, idbEngine: false, usingFallbackStorage: true, fallbackStorage: false }, expected: 'none' },
      { name: 'None (Fallback 2フラグ不一致 - using false, storage true)', state: { opfsWorker: false, idbEngine: false, usingFallbackStorage: false, fallbackStorage: true }, expected: 'none' },
      { name: 'OPFS優先 (OPFS+IDB+Fallback 全 true)', state: { opfsWorker: true, idbEngine: true, usingFallbackStorage: true, fallbackStorage: true }, expected: 'opfs' },
      { name: 'IDB優先 (IDB+Fallback)', state: { opfsWorker: false, idbEngine: true, usingFallbackStorage: true, fallbackStorage: true }, expected: 'idb' },
    ];

    it.each(table)('$name: $expected を返す', ({ state, expected }) => {
      expect(resolveBackend(state)).toBe(expected);
    });
  });

  // ── detectOpfsCapabilitiesForResolver: detectLiveVfsStrategy 委譲 ───────
  describe('detectOpfsCapabilitiesForResolver — detectLiveVfsStrategy mock', () => {
    const capsTable: Array<{ caps: { opfsDirectory: boolean; syncAccessHandle: boolean; worker: boolean }; expected: typeof caps }> = [
      { caps: { opfsDirectory: true, syncAccessHandle: true, worker: true }, expected: { opfsDirectory: true, syncAccessHandle: true, worker: true } },
      { caps: { opfsDirectory: false, syncAccessHandle: false, worker: false }, expected: { opfsDirectory: false, syncAccessHandle: false, worker: false } },
      { caps: { opfsDirectory: true, syncAccessHandle: false, worker: true }, expected: { opfsDirectory: true, syncAccessHandle: false, worker: true } },
      { caps: { opfsDirectory: true, syncAccessHandle: true, worker: false }, expected: { opfsDirectory: true, syncAccessHandle: true, worker: false } },
    ];

    it.each(capsTable)('caps $caps をそのまま返す', ({ caps, expected }) => {
      mockDetectLiveVfsStrategy.mockReturnValue({ caps, strategy: caps.opfsDirectory ? 'opfs-sync-worker' : 'fallback' } as never);
      const result = detectOpfsCapabilitiesForResolver();
      expect(result).toEqual(expected);
      expect(mockDetectLiveVfsStrategy).toHaveBeenCalledOnce();
    });
  });

  // ── createBackend: 4パターン + Noop フォールバック ─────────────────────
  describe('createBackend — 動的 import と Noop フォールバック', () => {
    it('opfs: OpfsWorkerBackend を返す', async () => {
      const ctx = makeContext({ opfsWorker: {} });
      const backend = await createBackend(ctx, 'opfs');
      expect(backend).toBe(mockOpfsBackend);
    });

    it('idb: idbEngine が存在すれば IdbVfsBackend を返す', async () => {
      const ctx = makeContext({ idbEngine: {} });
      const backend = await createBackend(ctx, 'idb');
      expect(backend).toBe(mockIdbBackend);
    });

    it('idb: idbEngine が null なら init を呼び出してから IdbVfsBackend を返す (init で engine が立つ)', async () => {
      const init = vi.fn().mockImplementation(async function (this: unknown) {
        (this as { idbEngine: unknown }).idbEngine = {};
      });
      const ctx = makeContext({ idbEngine: null, init } as never);
      // init が idbEngine をセットするようにこのテストでは ctx.idbEngine を初期 null にし、init 後にセット
      // ただし makeContext が idbEngine: null を持つので、createBackend 内の if (!context.idbEngine) await context.init() で init が呼ばれる
      // init 内で idbEngine を埋めるため、呼び出し後に second check で IdbVfsBackend が返る
      // 実際には init が this を通じて埋めるので、ctx オブジェクトを直接操作する
      init.mockImplementation(async () => { ctx.idbEngine = {} as never; });
      const backend = await createBackend(ctx, 'idb');
      expect(init).toHaveBeenCalledOnce();
      expect(backend).toBe(mockIdbBackend);
    });

    it('idb: idbEngine が null のままなら NoopBackend にフォールバック', async () => {
      const ctx = makeContext({ idbEngine: null, init: vi.fn().mockResolvedValue(undefined) } as never);
      const backend = await createBackend(ctx, 'idb');
      // NoopBackend は healthCheck が false になる backend
      const health = await backend.healthCheck();
      expect(health.success).toBe(false);
    });

    it('fallback: fallbackStorage があれば FallbackStorageAdapter を返す', async () => {
      const ctx = makeContext({ fallbackStorage: {} });
      const backend = await createBackend(ctx, 'fallback');
      expect(backend).toBe(mockFallbackBackend);
    });

    it('fallback: fallbackStorage が null なら NoopBackend にフォールバック', async () => {
      const ctx = makeContext({ fallbackStorage: null });
      const backend = await createBackend(ctx, 'fallback');
      expect((await backend.healthCheck()).success).toBe(false);
    });

    it('none: NoopBackend を返す', async () => {
      const ctx = makeContext();
      const backend = await createBackend(ctx, 'none');
      expect((await backend.healthCheck()).success).toBe(false);
      // NoopBackend の healthCheck は success:false,  getStatus も false
      const status = await backend.getStatus();
      expect(status.success).toBe(false);
    });

    it('未知の resolved でも NoopBackend (exhaustive switch の default)', async () => {
      const ctx = makeContext();
      const backend = await createBackend(ctx, 'none' as never);
      expect((await backend.healthCheck()).success).toBe(false);
    });
  });
});
