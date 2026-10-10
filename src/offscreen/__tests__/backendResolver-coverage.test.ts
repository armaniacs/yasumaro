// @vitest-environment jsdom
/**
 * backendResolver-coverage.test.ts
 * PBI 10: backendResolver の 4パターン (OPFS/IDB/Fallback/None) を
 * テーブル駆動テスト。
 * createBackend も 90% ゲートまでカバー。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// The rung factories moved into the host (PBI-05), so the boot seams they
// touch are mocked per rung instead of a fake context object.
const mockInitOpfsWorker = vi.hoisted(() => vi.fn());
const mockInitIdbEngine = vi.hoisted(() => vi.fn());

vi.mock('../sqliteEngineContext/opfsWorkerProxy.js', () => ({
  initOpfsWorker: (...args: unknown[]) => mockInitOpfsWorker(...args),
  sendToOpfsWorker: vi.fn(),
  tryOpfsProxy: vi.fn().mockResolvedValue(null),
  terminateOpfsWorker: vi.fn(),
}));
vi.mock('../sqliteEngineContext/idbEngineLifecycle.js', () => ({
  DB_FILENAME: 'yasumaro.db',
  initIdbEngine: (...args: unknown[]) => mockInitIdbEngine(...args),
  execWithCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../sqliteEngineContext/migrationBackup.js', () => ({
  runMigrationBackup: vi.fn().mockResolvedValue(undefined),
  runMigrationRestore: vi.fn().mockResolvedValue(undefined),
  extractDomain: (url: string) => url,
}));
vi.mock('../sqliteEngineContext/fallbackMigration.js', () => ({
  tryMigrateFallbackToSqlite: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../storageFallback.js', () => ({
  FallbackStorage: class {},
}));

// Must import after mocks
import { resolveBackend } from '../backendResolver.js';
import { SqliteEngineHost } from '../sqliteEngineHost.js';

describe('backendResolver — coverage 90% (PBI 10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    it.each(table)('$name: returns $expected', ({ state, expected }) => {
      expect(resolveBackend(state)).toBe(expected);
    });
  });

  // ── createBackend: the adapter registry moved into the host (PBI-05) ──
  // The factories are the host's private createBackendFor now, exercised
  // through the public getBackend() seam with the engine boot mocked per
  // rung. The Noop fallback for unresolvable states is unreachable through
  // the seam (init always ends on a rung) — resolveBackend's 'none' is
  // covered by the pure decision tests above.
  describe('createBackend (host seam) — rung factories', () => {
    beforeEach(() => {
      mockInitOpfsWorker.mockImplementation(async (state: { opfsWorker: unknown }) => {
        state.opfsWorker = { worker: true };
        return true;
      });
      mockInitIdbEngine.mockImplementation(async (state: { idbEngine: unknown; fts5Available: boolean }) => {
        state.idbEngine = { engine: true };
        state.fts5Available = true;
        return true;
      });
    });

    it('opfs rung: returns OpfsWorkerBackend', async () => {
      const host = new SqliteEngineHost();
      const backend = await host.getBackend();
      expect(backend).toBe(mockOpfsBackend);
    });

    it('idb rung: returns IdbVfsBackend when the engine comes up', async () => {
      mockInitOpfsWorker.mockResolvedValue(false);
      const host = new SqliteEngineHost();
      const backend = await host.getBackend();
      expect(backend).toBe(mockIdbBackend);
    });

    it('fallback rung: returns FallbackStorageAdapter when both engines fail', async () => {
      mockInitOpfsWorker.mockResolvedValue(false);
      mockInitIdbEngine.mockResolvedValue(false);
      const host = new SqliteEngineHost();
      const backend = await host.getBackend();
      expect(backend).toBe(mockFallbackBackend);
    });
  });
});
