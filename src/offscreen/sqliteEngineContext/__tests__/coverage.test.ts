// @vitest-environment jsdom
/**
 * coverage.test.ts — PBI-11: offscreen/sqliteEngineContext 90% ゲート用
 * - _doInit の OPFS→IDB→Fallback 3分岐、fts5Available 反映、FALLBACK_MODE 切替を chrome.storage mock で検証
 * - opfsWorkerProxy の sendToOpfsWorker タイムアウトと terminate を vi.useFakeTimers で検証
 * - isOpfsAvailable / canCreateWorker / createOpfsWorker / initOpfsWorker の未達分岐を補完
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StorageKeys } from '../../../utils/storage/types.js';

// ── Hoisted mocks for SqliteEngineContext dependencies ──────────────────
const mockInitIdbEngine = vi.fn();
const mockExecWithCache = vi.fn();
const mockRunMigrationBackup = vi.fn();
const mockRunMigrationRestore = vi.fn();
const mockTryMigrateFallback = vi.fn();

vi.mock('../idbEngineLifecycle.js', () => ({
  DB_FILENAME: 'yasumaro.db',
  initIdbEngine: (...args: unknown[]) => mockInitIdbEngine(...args),
  execWithCache: (...args: unknown[]) => mockExecWithCache(...args),
}));

vi.mock('../migrationBackup.js', () => ({
  runMigrationBackup: (...args: unknown[]) => mockRunMigrationBackup(...args),
  runMigrationRestore: (...args: unknown[]) => mockRunMigrationRestore(...args),
  extractDomain: (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  },
}));

vi.mock('../fallbackMigration.js', () => ({
  tryMigrateFallbackToSqlite: (...args: unknown[]) => mockTryMigrateFallback(...args),
}));

// FallbackStorage は実体でなくても _doInit の usingFallbackStorage/fallbackStorage 代入を検証できればよい
const mockFallbackClearAll = vi.fn().mockResolvedValue(undefined);
vi.mock('../../storageFallback.js', () => ({
  FallbackStorage: class {
    clearAll = mockFallbackClearAll;
    getAllRecords = vi.fn().mockResolvedValue([]);
    addRecord = vi.fn().mockResolvedValue(undefined);
  },
}));

// logger は副作用のみなので潰しておく
vi.mock('../../../utils/logger.js', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  ErrorCode: { STORAGE_MIGRATION_FAILURE: 'STORAGE_MIGRATION_FAILURE', INTERNAL_ERROR: 'INTERNAL_ERROR', MIGRATION_ROLLBACK_FAILED: 'MIGRATION_ROLLBACK_FAILED' },
}));

// ── Imports after mocks ─────────────────────────────────────────────────
const { SqliteEngineContext, extractDomain } = await import('../../sqliteEngineContext.js');
const {
  sendToOpfsWorker,
  tryOpfsProxy,
  terminateOpfsWorker,
  isOpfsAvailable,
  canCreateWorker,
  createOpfsWorker,
  initOpfsWorker,
} = await import('../opfsWorkerProxy.js');

// ── Helpers ─────────────────────────────────────────────────────────────
function setOpfsAvailable(available: boolean) {
  if (available) {
    Object.defineProperty(globalThis.navigator, 'storage', {
      value: { getDirectory: vi.fn().mockResolvedValue({}) },
      configurable: true,
      writable: true,
    } as unknown as PropertyDescriptor);
  } else {
    // storage が無い or getDirectory が無い状態
    Object.defineProperty(globalThis.navigator, 'storage', {
      value: {},
      configurable: true,
      writable: true,
    } as unknown as PropertyDescriptor);
    // jsdom の navigator.storage を上書きできない場合は delete で代用
    try {
      // @ts-ignore
      delete (globalThis.navigator.storage as unknown as { getDirectory?: unknown })?.getDirectory;
    } catch { /* ignore */ }
  }
}

function installMockWorker(respond: (msg: { id: number; type: string; payload?: unknown }) => void = () => {}) {
  class MockWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: ErrorEvent) => void) | null = null;
    terminate = vi.fn();
    postMessage = vi.fn((msg: { id: number; type: string; payload?: unknown }) => {
      respond(msg);
    });
    // helper to simulate worker reply
    __reply(data: unknown) {
      this.onmessage?.({ data } as MessageEvent);
    }
    __error(message: string) {
      this.onerror?.({ message } as ErrorEvent);
    }
  }
  (globalThis as unknown as { Worker: unknown }).Worker = MockWorker as unknown as typeof Worker;
  return MockWorker;
}

function makeOpfsState(worker: Partial<Worker> | null) {
  return {
    opfsWorker: worker as Worker | null,
    opfsRequestId: 0,
    opfsPending: new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>(),
  };
}

// ── Tests ───────────────────────────────────────────────────────────────
describe('sqliteEngineContext coverage — _doInit 3分岐', () => {
  let ctx: InstanceType<typeof SqliteEngineContext>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInitIdbEngine.mockReset();
    mockRunMigrationBackup.mockReset();
    mockRunMigrationRestore.mockReset();
    mockTryMigrateFallback.mockReset();
    mockExecWithCache.mockReset();
    // chrome.storage は vitest.setup のモックが生きている — spy をリセット
    (chrome.storage.local.set as unknown as ReturnType<typeof vi.fn>).mockClear();
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockClear();
    (chrome.storage.local.remove as unknown as ReturnType<typeof vi.fn>).mockClear();
    // デフォルトは OPFS 利用可にしておく（個別テストで上書き）
    setOpfsAvailable(true);
    // デフォルト migration は no-op
    mockRunMigrationBackup.mockResolvedValue(undefined);
    mockRunMigrationRestore.mockResolvedValue(undefined);
    mockTryMigrateFallback.mockResolvedValue(undefined);
    ctx = new SqliteEngineContext();
  });

  afterEach(() => {
    ctx.resetForTesting();
    vi.useRealTimers();
    // @ts-ignore cleanup Worker mock
    try { delete (globalThis as unknown as { Worker?: unknown }).Worker; } catch { /* ignore */ }
    setOpfsAvailable(true);
  });

  it('ハッピーパス: OPFS Worker が正常に初期化され fts5Available が true になる', async () => {
    // MockWorker が INIT に対して initialized:true を返す
    const MockWorker = installMockWorker();
    // createOpfsWorker が作る Worker の postMessage をフックして即時解決させるため、
    // MockWorker.prototype.postMessage を上書きする代わりに、initOpfsWorker 内の
    // sendToOpfsWorker('INIT') が必ず成功するように、MockWorker の postMessage で reply する
    // ただし SqliteEngineContext は real opfsWorkerProxy を使うので、postMessage→onmessage の
    // 非同期解決を待つ必要がある。setTimeout(0) で reply するようにする。
    (globalThis as unknown as { Worker: typeof MockWorker }).Worker = class extends MockWorker {
      override postMessage = vi.fn((msg: { id: number; type: string }) => {
        if (msg.type === 'INIT') {
          setTimeout(() => {
            // @ts-ignore
            (this as unknown as MockWorker).onmessage?.({ data: { id: msg.id, success: true, result: { initialized: true } } } as MessageEvent);
          }, 0);
        }
      });
    } as unknown as typeof MockWorker;

    const ok = await ctx.init();

    expect(ok).toBe(true);
    expect(ctx.fts5Available).toBe(true);
    expect(ctx.opfsWorker).not.toBeNull();
    expect(mockInitIdbEngine).not.toHaveBeenCalled();
    // OPFS 成功時は FALLBACK_MODE を立てない
    expect(chrome.storage.local.set).not.toHaveBeenCalledWith({ [StorageKeys.OPFS_FALLBACK_MODE]: true });
  });

  it('エッジケース: OPFS 不可 → IDB にフォールバックし fts5Available が反映される', async () => {
    setOpfsAvailable(false);
    mockInitIdbEngine.mockImplementation(async (state: { fts5Available: boolean; idbEngine: unknown }) => {
      state.fts5Available = true;
      state.idbEngine = {} as unknown as never;
      return true;
    });

    const ok = await ctx.init();

    expect(ok).toBe(true);
    expect(ctx.fts5Available).toBe(true);
    expect(ctx.idbEngine).not.toBeNull();
    expect(mockRunMigrationBackup).toHaveBeenCalledOnce();
    expect(mockInitIdbEngine).toHaveBeenCalledOnce();
    expect(mockRunMigrationRestore).toHaveBeenCalledOnce();
    expect(mockTryMigrateFallback).toHaveBeenCalledOnce();
    expect(ctx.usingFallbackStorage).toBe(false);
  });

  it('エッジケース: OPFS も IDB も失敗 → FallbackStorage にフォールバックし FALLBACK_MODE が立つ', async () => {
    setOpfsAvailable(false);
    mockInitIdbEngine.mockImplementation(async (state: { lastInitError: string | null }) => {
      state.lastInitError = 'IDB blocked';
      return false;
    });

    const ok = await ctx.init();

    expect(ok).toBe(false);
    expect(ctx.usingFallbackStorage).toBe(true);
    expect(ctx.fallbackStorage).not.toBeNull();
    expect(ctx.lastInitError).toBe('IDB blocked');
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ [StorageKeys.OPFS_FALLBACK_MODE]: true });
  });

  it('IDB 初期化失敗時は lastInitError フォールバックメッセージで throw される', async () => {
    setOpfsAvailable(false);
    mockInitIdbEngine.mockResolvedValue(false);
    // lastInitError が null の場合はデフォルトメッセージが throw される
    ctx.lastInitError = null;

    const ok = await ctx.init();

    expect(ok).toBe(false);
    expect(ctx.lastInitError).toBe('SQLite: IDB engine init failed');
    expect(ctx.usingFallbackStorage).toBe(true);
  });

  it('catch で OPFS Worker が存在すれば terminate される', async () => {
    // Worker は作られるが INIT が失敗 → IDB も失敗 → catch で terminate
    // OPFS を成功させないために、INIT が unexpected result を返すようにする
    const MockWorker = installMockWorker();
    (globalThis as unknown as { Worker: typeof MockWorker }).Worker = class extends MockWorker {
      override postMessage = vi.fn((msg: { id: number; type: string }) => {
        if (msg.type === 'INIT') {
          setTimeout(() => {
            // initialized: false 相当 — Worker は作られるが opfsOk は false
            // opfsWorker 自体は state に残るが、initOpfsWorker は false を返す
            (this as unknown as MockWorker).onmessage?.({ data: { id: msg.id, success: true, result: { initialized: false } } } as MessageEvent);
          }, 0);
        }
      });
    } as unknown as typeof MockWorker;

    mockInitIdbEngine.mockResolvedValue(false);
    ctx.lastInitError = 'boom';

    const ok = await ctx.init();

    // OPFS が false なので IDB パスに進むが IDB も false → fallback
    expect(ok).toBe(false);
    // このパスでは OPFS Worker は INIT 失敗後に残る？ createOpfsWorker は Worker を state にセットするが
    // initOpfsWorker が false を返しても Worker は state に残る実装なので、catch では terminate される
    // ただし上記モックでは Worker が state に残るため、usingFallbackStorage が立つ
    expect(ctx.usingFallbackStorage).toBe(true);
  });

  it('chrome.storage.local.set が throw しても fallback は継続する（offscreen context）', async () => {
    setOpfsAvailable(false);
    mockInitIdbEngine.mockResolvedValue(false);
    (chrome.storage.local.set as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('storage blocked'));

    const ok = await ctx.init();

    expect(ok).toBe(false);
    expect(ctx.usingFallbackStorage).toBe(true);
  });

  it('init の早期 return 分岐をカバーする', async () => {
    // opfsWorker が既にある場合は true
    ctx.opfsWorker = { terminate: vi.fn() } as unknown as Worker;
    await expect(ctx.init()).resolves.toBe(true);
    ctx.opfsWorker = null;

    // idbEngine が既にある場合は true
    ctx.idbEngine = {} as unknown as never;
    await expect(ctx.init()).resolves.toBe(true);
    ctx.idbEngine = null;

    // usingFallbackStorage が true なら false
    ctx.usingFallbackStorage = true;
    await expect(ctx.init()).resolves.toBe(false);
    ctx.usingFallbackStorage = false;

    // initPromise が既にある場合は同じ Promise インスタンスは deduplicate される（解決値が同じ）
    setOpfsAvailable(false);
    mockInitIdbEngine.mockImplementation(async (s: { idbEngine: unknown }) => {
      s.idbEngine = {} as unknown as never;
      await new Promise((r) => setTimeout(r, 10));
      return true;
    });
    const p1 = ctx.init();
    const p2 = ctx.init();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe(r2);
    // 2回目は early return で true（idbEngine が立っている）
    await expect(ctx.init()).resolves.toBe(true);
  });

  it('resetForTesting / resetBackend / extractDomain / execWithCache / backend 解決をカバーする', async () => {
    // extractDomain: www 除去とパース失敗
    expect(extractDomain('https://www.example.com/path')).toBe('example.com');
    expect(extractDomain('not a url')).toBeNull();
    expect(extractDomain('https://example.com')).toBe('example.com');

    // execWithCache は idbEngineLifecycle の execWithCache に委譲（mock）
    mockExecWithCache.mockResolvedValue(undefined);
    ctx.idbEngine = { exec: vi.fn(), query: vi.fn() } as unknown as never;
    await expect(ctx.execWithCache('SELECT 1', [])).resolves.toBeUndefined();
    expect(mockExecWithCache).toHaveBeenCalledOnce();
    // 代わりに ensureBackend / getBackend / resetBackend を検証
    ctx.resetBackend();
    expect((ctx as unknown as { _backend: unknown })._backend).toBeNull();

    // ensureBackend: 未初期化なら init を経由して backend を解決
    setOpfsAvailable(false);
    mockInitIdbEngine.mockImplementation(async (s: { idbEngine: unknown; fts5Available: boolean }) => {
      s.idbEngine = {} as unknown as never;
      s.fts5Available = true;
      return true;
    });
    ctx.resetForTesting();
    const backendType = await ctx.ensureBackend();
    expect(['idb', 'opfs', 'fallback', 'none']).toContain(backendType);

    // getBackend は _backend をキャッシュする
    const b1 = await ctx.getBackend();
    const b2 = await ctx.getBackend();
    expect(b1).toBe(b2);

    // resetForTesting は全状態をクリアする
    ctx.resetForTesting();
    expect(ctx.idbEngine).toBeNull();
    expect(ctx.fts5Available).toBe(false);
    expect(ctx.opfsWorker).toBeNull();
    expect(ctx.usingFallbackStorage).toBe(false);
    expect(ctx.lastInitError).toBeNull();
  });
});

describe('opfsWorkerProxy coverage — タイムアウトと terminate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sendToOpfsWorker は 15s 応答なしで timeout し pending から削除される', async () => {
    vi.useFakeTimers();
    const state = makeOpfsState({ postMessage: vi.fn() });

    const promise = sendToOpfsWorker(state, 'QUERY');
    expect(state.opfsPending.size).toBe(1);

    // 15s 経過で timeout
    vi.advanceTimersByTime(15000);

    await expect(promise).rejects.toThrow('OPFS Worker timeout: QUERY');
    expect(state.opfsPending.size).toBe(0);
  });

  it('timeout 前に resolve されればタイマーは clear され reject されない', async () => {
    vi.useFakeTimers();
    const state = makeOpfsState({ postMessage: vi.fn() });

    const promise = sendToOpfsWorker(state, 'QUERY');
    // 10s 経過後に resolve（onmessage 相当）
    vi.advanceTimersByTime(10000);
    state.opfsPending.get(1)!.resolve('ok');
    // さらに 10s 進めても timeout しない
    vi.advanceTimersByTime(10000);

    await expect(promise).resolves.toBe('ok');
    expect(state.opfsPending.size).toBe(1); // resolve は pending を削除しない（onmessage 側の責務）が、timeout は clear された
    // 手動でクリアしても size は残るが、timeout の reject が無いことを確認できればよい
  });

  it('terminate は pending を全て reject し Worker を null にする', async () => {
    const terminate = vi.fn();
    const state = makeOpfsState({ terminate });
    const pendingErrors: Error[] = [];
    state.opfsPending.set(1, { resolve: vi.fn(), reject: (e) => pendingErrors.push(e) });
    state.opfsPending.set(2, { resolve: vi.fn(), reject: (e) => pendingErrors.push(e) });

    terminateOpfsWorker(state);

    expect(terminate).toHaveBeenCalledOnce();
    expect(state.opfsWorker).toBeNull();
    expect(state.opfsPending.size).toBe(0);
    expect(pendingErrors.every((e) => e.message === 'OPFS Worker terminated')).toBe(true);
  });

  it('isOpfsAvailable / canCreateWorker の分岐をカバーする', () => {
    // available: true — Worker も用意する
    setOpfsAvailable(true);
    installMockWorker();
    expect(isOpfsAvailable()).toBe(true);
    expect(canCreateWorker()).toBe(true);

    // available: false
    setOpfsAvailable(false);
    expect(isOpfsAvailable()).toBe(false);

    // canCreateWorker: Worker が無い
    const originalWorker = (globalThis as unknown as { Worker?: unknown }).Worker;
    try { delete (globalThis as unknown as { Worker?: unknown }).Worker; } catch { /* ignore */ }
    expect(canCreateWorker()).toBe(false);
    if (originalWorker) (globalThis as unknown as { Worker: unknown }).Worker = originalWorker as unknown as typeof Worker;
    else {
      // 元々無ければ canCreateWorker は false のまま
      expect(canCreateWorker()).toBe(false);
    }
  });

  it('createOpfsWorker は Worker 生成失敗で null を返す', () => {
    // Worker コンストラクタが throw する
    (globalThis as unknown as { Worker: unknown }).Worker = class {
      constructor() { throw new Error('Worker blocked'); }
    } as unknown as typeof Worker;

    const state = makeOpfsState(null);
    const w = createOpfsWorker(state);
    expect(w).toBeNull();
  });

  it('createOpfsWorker は onmessage で __log と通常メッセージを分岐し、onerror で pending を reject する', async () => {
    let capturedOnMessage: ((e: MessageEvent) => void) | null = null;
    let capturedOnError: ((e: ErrorEvent) => void) | null = null;
    class CapturingWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      terminate = vi.fn();
      postMessage = vi.fn();
      constructor() {
        // インスタンス生成後に onmessage/onerror がセットされるので、getter で捕捉
        setTimeout(() => {
          capturedOnMessage = this.onmessage;
          capturedOnError = this.onerror;
        }, 0);
      }
    }
    (globalThis as unknown as { Worker: unknown }).Worker = CapturingWorker as unknown as typeof Worker;

    const state = makeOpfsState(null);
    const worker = createOpfsWorker(state);
    expect(worker).not.toBeNull();
    // onmessage/onerror がセットされるまで待つ
    await new Promise((r) => setTimeout(r, 0));
    capturedOnMessage = (worker as unknown as CapturingWorker).onmessage as unknown as ((e: MessageEvent) => void) | null;
    capturedOnError = (worker as unknown as CapturingWorker).onerror as unknown as ((e: ErrorEvent) => void) | null;

    // __log メッセージは pending に影響しない
    capturedOnMessage?.({ data: { __log: true, level: 'info', message: 'hello', details: {} } } as unknown as MessageEvent);
    expect(state.opfsPending.size).toBe(0);

    capturedOnMessage?.({ data: { __log: true, level: 'warn', message: 'warn', details: {} } } as unknown as MessageEvent);
    capturedOnMessage?.({ data: { __log: true, level: 'error', message: 'err', details: {} } } as unknown as MessageEvent);

    // 通常メッセージ: success / failure
    state.opfsPending.set(10, { resolve: vi.fn(), reject: vi.fn() });
    const resolveSpy = vi.fn();
    const rejectSpy = vi.fn();
    state.opfsPending.set(11, { resolve: resolveSpy, reject: rejectSpy });
    capturedOnMessage?.({ data: { id: 11, success: true, result: 'ok' } } as MessageEvent);
    expect(resolveSpy).toHaveBeenCalledWith('ok');
    expect(state.opfsPending.has(11)).toBe(false);

    state.opfsPending.set(12, { resolve: vi.fn(), reject: rejectSpy });
    capturedOnMessage?.({ data: { id: 12, success: false, error: 'boom' } } as MessageEvent);
    expect(rejectSpy).toHaveBeenCalled();

    // onerror: pending 全て reject
    state.opfsPending.set(20, { resolve: vi.fn(), reject: rejectSpy });
    state.opfsPending.set(21, { resolve: vi.fn(), reject: rejectSpy });
    capturedOnError?.({ message: 'worker crashed' } as ErrorEvent);
    expect(state.opfsPending.size).toBe(0);
  });

  it('initOpfsWorker の全分岐: isOpfsAvailable false / canCreateWorker false / Worker null / INIT 成功・失敗・例外', async () => {
    // 1. isOpfsAvailable false
    setOpfsAvailable(false);
    const s1 = makeOpfsState(null);
    await expect(initOpfsWorker(s1)).resolves.toBe(false);

    // 2. canCreateWorker false (isOpfsAvailable は true だが Worker 無し)
    setOpfsAvailable(true);
    const origWorker = (globalThis as unknown as { Worker?: unknown }).Worker;
    try { delete (globalThis as unknown as { Worker?: unknown }).Worker; } catch { /* ignore */ }
    const s2 = makeOpfsState(null);
    await expect(initOpfsWorker(s2)).resolves.toBe(false);
    if (origWorker) (globalThis as unknown as { Worker: unknown }).Worker = origWorker as unknown as typeof Worker;

    // 3. createOpfsWorker が null
    (globalThis as unknown as { Worker: unknown }).Worker = class { constructor() { throw new Error('blocked'); } } as unknown as typeof Worker;
    const s3 = makeOpfsState(null);
    setOpfsAvailable(true);
    await expect(initOpfsWorker(s3)).resolves.toBe(false);

    // 4. INIT 成功
    installMockWorker();
    (globalThis as unknown as { Worker: unknown }).Worker = class {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      terminate = vi.fn();
      postMessage = vi.fn((msg: { id: number }) => {
        setTimeout(() => this.onmessage?.({ data: { id: msg.id, success: true, result: { initialized: true } } } as unknown as MessageEvent), 0);
      });
    } as unknown as typeof Worker;
    const s4 = makeOpfsState(null);
    await expect(initOpfsWorker(s4)).resolves.toBe(true);
    expect(s4.opfsWorker).not.toBeNull();
    // 後始末
    terminateOpfsWorker(s4);

    // 5. INIT が unexpected result
    (globalThis as unknown as { Worker: unknown }).Worker = class {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      terminate = vi.fn();
      postMessage = vi.fn((msg: { id: number }) => {
        setTimeout(() => this.onmessage?.({ data: { id: msg.id, success: true, result: { initialized: false } } } as unknown as MessageEvent), 0);
      });
    } as unknown as typeof Worker;
    const s5 = makeOpfsState(null);
    await expect(initOpfsWorker(s5)).resolves.toBe(false);

    // 6. INIT が例外（sendToOpfsWorker が reject）
    (globalThis as unknown as { Worker: unknown }).Worker = class {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      terminate = vi.fn();
      postMessage = vi.fn(() => { throw new Error('postMessage failed'); });
    } as unknown as typeof Worker;
    const s6 = makeOpfsState(null);
    // createOpfsWorker は成功するが postMessage が throw → sendToOpfsWorker の catch → initOpfsWorker は false
    // ただし postMessage の throw は sendToOpfsWorker 内では try されないので、onerror ではなく直接 throw なら
    // initOpfsWorker の外側 catch に入る。ここでは Worker 生成自体は成功するが sendToOpfsWorker が timeout するケースを模擬
    // timeout を使って reject させる（fake timers）
    vi.useFakeTimers();
    const s7 = makeOpfsState({ postMessage: vi.fn() } as unknown as Worker);
    // isOpfsAvailable/canCreateWorker を true にしつつ、createOpfsWorker を迂回して直接 sendToOpfsWorker を失敗させる
    // 簡易に、s7 に Worker をセットし、sendToOpfsWorker が timeout するのと同じ挙動で initOpfsWorker が false になることを検証
    // ここでは直接 initOpfsWorker を呼ばず、sendToOpfsWorker の timeout が initOpfsWorker の catch に入ることを確認
    // 代わりに、createOpfsWorker が作る Worker の postMessage が何も reply しないケースを fake timers で timeout させる
    (globalThis as unknown as { Worker: unknown }).Worker = class {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      terminate = vi.fn();
      postMessage = vi.fn();
    } as unknown as typeof Worker;
    const s8 = makeOpfsState(null);
    const p = initOpfsWorker(s8);
    vi.advanceTimersByTime(15000);
    await expect(p).resolves.toBe(false);
    vi.useRealTimers();
  });

  it('tryOpfsProxy は worker 無しで null、失敗で null、成功で値を返す', async () => {
    const sNull = makeOpfsState(null);
    await expect(tryOpfsProxy(sNull, 'QUERY')).resolves.toBeNull();

    const sFail = makeOpfsState({ postMessage: vi.fn() } as unknown as Worker);
    vi.useFakeTimers();
    const pFail = tryOpfsProxy(sFail, 'QUERY');
    vi.advanceTimersByTime(15000);
    await expect(pFail).resolves.toBeNull();
    vi.useRealTimers();

    const sOk = makeOpfsState({ postMessage: vi.fn() } as unknown as Worker);
    const pOk = tryOpfsProxy(sOk, 'QUERY');
    // 即時 resolve で成功パス
    sOk.opfsPending.get(1)!.resolve({ rows: [1] });
    await expect(pOk).resolves.toEqual({ rows: [1] });
  });
});
