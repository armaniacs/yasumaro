// @vitest-environment jsdom
/**
 * opfsWorkerProxy-coverage.test.ts
 * PBI 10: opfsWorkerProxy の 15s タイムアウトを vi.useFakeTimers で検証、terminate パス追加。
 * さらに isOpfsAvailable / canCreateWorker / createOpfsWorker / initOpfsWorker / tryOpfsProxy で 90% 到達。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  ErrorCode: { INTERNAL_ERROR: 'INTERNAL_ERROR' },
}));

import {
  isOpfsAvailable,
  canCreateWorker,
  createOpfsWorker,
  sendToOpfsWorker,
  tryOpfsProxy,
  initOpfsWorker,
  terminateOpfsWorker,
  type OpfsProxyState,
} from '../sqliteEngineContext/opfsWorkerProxy.js';
import { logError, logInfo, logWarn } from '../../utils/logger.js';

function makeState(worker: Partial<Worker> | null): OpfsProxyState {
  return {
    opfsWorker: worker as Worker | null,
    opfsRequestId: 0,
    opfsPending: new Map(),
  };
}

describe('opfsWorkerProxy — coverage 90% (PBI 10)', () => {
  let originalNavigator: unknown;
  let originalWorker: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    originalNavigator = (globalThis as unknown as { navigator: unknown }).navigator;
    originalWorker = (globalThis as unknown as { Worker: unknown }).Worker;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    // restore navigator
    if (originalNavigator !== undefined) {
      (globalThis as unknown as { navigator: unknown }).navigator = originalNavigator as never;
    }
    if (originalWorker !== undefined) {
      (globalThis as unknown as { Worker: unknown }).Worker = originalWorker as never;
    }
  });

  // ── isOpfsAvailable ───────────────────────────────────────────────────
  describe('isOpfsAvailable', () => {
    it('navigator.storage.getDirectory が function なら true', () => {
      vi.stubGlobal('navigator', { storage: { getDirectory: () => {} } } as never);
      expect(isOpfsAvailable()).toBe(true);
    });

    it('getDirectory が無いなら false', () => {
      vi.stubGlobal('navigator', { storage: {} } as never);
      expect(isOpfsAvailable()).toBe(false);
    });

    it('navigator が undefined でも false (例外系)', () => {
      vi.stubGlobal('navigator', undefined as never);
      expect(isOpfsAvailable()).toBe(false);
    });

    it('getDirectory が function でないなら false', () => {
      vi.stubGlobal('navigator', { storage: { getDirectory: 'not-a-function' } } as never);
      expect(isOpfsAvailable()).toBe(false);
    });
  });

  // ── canCreateWorker ───────────────────────────────────────────────────
  describe('canCreateWorker', () => {
    it('Worker が globalThis にあれば true', () => {
      vi.stubGlobal('Worker', function FakeWorker() {} as never);
      expect(canCreateWorker()).toBe(true);
    });

    it('Worker が無ければ false', () => {
      // jsdom には Worker が無いが、明示的に削除
      const g = globalThis as unknown as Record<string, unknown>;
      const saved = g.Worker;
      delete g.Worker;
      expect(canCreateWorker()).toBe(false);
      g.Worker = saved;
    });
  });

  // ── createOpfsWorker ──────────────────────────────────────────────────
  describe('createOpfsWorker', () => {
    // Helper to create a Worker mock class that returns a controllable instance
    function stubWorkerWithInstance(instance: Record<string, unknown>) {
      class FakeWorker {
        onmessage: unknown = null;
        onerror: unknown = null;
        constructor() {
          Object.assign(this, instance);
          // Ensure the instance object is the same reference returned by `new`
          return instance as never;
        }
      }
      vi.stubGlobal('Worker', FakeWorker as never);
      return instance;
    }

    it('Worker 生成成功時は Worker を返し onmessage/onerror を設定', async () => {
      const mockWorker: Record<string, unknown> = {};
      stubWorkerWithInstance(mockWorker);

      const state = makeState(null);
      const worker = createOpfsWorker(state);

      expect(worker).toBe(mockWorker);
      expect(mockWorker.onmessage).toBeDefined();
      expect(mockWorker.onerror).toBeDefined();
    });

    it('Worker 生成で例外なら null を返し logWarn', () => {
      class ThrowingWorker { constructor() { throw new Error('no worker'); } }
      vi.stubGlobal('Worker', ThrowingWorker as never);
      const state = makeState(null);
      const worker = createOpfsWorker(state);
      expect(worker).toBeNull();
      expect(logWarn).toHaveBeenCalled();
    });

    it('onmessage: __log true で level=error は logError', () => {
      const mockWorker: Record<string, unknown> = {};
      stubWorkerWithInstance(mockWorker);
      const state = makeState(null);
      createOpfsWorker(state);
      const onmessage = mockWorker.onmessage as (e: MessageEvent<unknown>) => void;

      onmessage({ data: { __log: true, level: 'error', message: 'boom', details: { x: 1 } } } as MessageEvent<unknown>);
      expect(logError).toHaveBeenCalled();
    });

    it('onmessage: __log true で level=warn は logWarn', () => {
      const mockWorker: Record<string, unknown> = {};
      stubWorkerWithInstance(mockWorker);
      const state = makeState(null);
      createOpfsWorker(state);
      (mockWorker.onmessage as (e: MessageEvent<unknown>) => void)({ data: { __log: true, level: 'warn', message: 'w', details: {} } } as MessageEvent<unknown>);
      expect(logWarn).toHaveBeenCalled();
    });

    it('onmessage: __log true で level=info は logInfo', () => {
      const mockWorker: Record<string, unknown> = {};
      stubWorkerWithInstance(mockWorker);
      const state = makeState(null);
      createOpfsWorker(state);
      (mockWorker.onmessage as (e: MessageEvent<unknown>) => void)({ data: { __log: true, level: 'info', message: 'i', details: {} } } as MessageEvent<unknown>);
      expect(logInfo).toHaveBeenCalled();
    });

    it('onmessage: success=true で pending を resolve', () => {
      const mockWorker: Record<string, unknown> = {};
      stubWorkerWithInstance(mockWorker);
      const state = makeState(null);
      createOpfsWorker(state);
      const pending = { resolve: vi.fn(), reject: vi.fn() };
      state.opfsPending.set(1, pending);
      (mockWorker.onmessage as (e: MessageEvent<unknown>) => void)({ data: { id: 1, success: true, result: 'ok' } } as MessageEvent<unknown>);
      expect(pending.resolve).toHaveBeenCalledWith('ok');
      expect(state.opfsPending.has(1)).toBe(false);
    });

    it('onmessage: success=false で pending を reject', () => {
      const mockWorker: Record<string, unknown> = {};
      stubWorkerWithInstance(mockWorker);
      const state = makeState(null);
      createOpfsWorker(state);
      const pending = { resolve: vi.fn(), reject: vi.fn() };
      state.opfsPending.set(2, pending);
      (mockWorker.onmessage as (e: MessageEvent<unknown>) => void)({ data: { id: 2, success: false, error: 'fail' } } as MessageEvent<unknown>);
      expect(pending.reject).toHaveBeenCalled();
      expect((pending.reject.mock.calls[0][0] as Error).message).toBe('fail');
    });

    it('onmessage: pending が存在しない id は無視', () => {
      const mockWorker: Record<string, unknown> = {};
      stubWorkerWithInstance(mockWorker);
      const state = makeState(null);
      createOpfsWorker(state);
      expect(() => (mockWorker.onmessage as (e: MessageEvent<unknown>) => void)({ data: { id: 999, success: true, result: 'x' } } as MessageEvent<unknown>)).not.toThrow();
    });

    it('onerror: 全 pending を reject し logError', () => {
      const mockWorker: Record<string, unknown> = {};
      stubWorkerWithInstance(mockWorker);
      const state = makeState(null);
      createOpfsWorker(state);
      const p1 = { resolve: vi.fn(), reject: vi.fn() };
      const p2 = { resolve: vi.fn(), reject: vi.fn() };
      state.opfsPending.set(1, p1);
      state.opfsPending.set(2, p2);
      (mockWorker.onerror as (e: ErrorEvent) => void)({ message: 'worker boom' } as ErrorEvent);
      expect(logError).toHaveBeenCalled();
      expect(p1.reject).toHaveBeenCalled();
      expect(p2.reject).toHaveBeenCalled();
      expect(state.opfsPending.size).toBe(0);
    });
  });

  // ── sendToOpfsWorker: 15s timeout ─────────────────────────────────────
  describe('sendToOpfsWorker — 15s timeout (fake timers)', () => {
    it('worker が無い場合は即 reject', async () => {
      const state = makeState(null);
      await expect(sendToOpfsWorker(state, 'QUERY')).rejects.toThrow('OPFS Worker not available');
    });

    it('15s 経過で timeout reject し pending から削除', async () => {
      vi.useFakeTimers();
      const postMessage = vi.fn();
      const state = makeState({ postMessage });

      const promise = sendToOpfsWorker(state, 'QUERY', { sql: 'SELECT 1' });
      expect(state.opfsPending.size).toBe(1);
      expect(postMessage).toHaveBeenCalledWith({ id: 1, type: 'QUERY', payload: { sql: 'SELECT 1' } });

      // 15秒進める
      vi.advanceTimersByTime(15000);

      await expect(promise).rejects.toThrow('OPFS Worker timeout: QUERY');
      expect(state.opfsPending.has(1)).toBe(false);
    });

    it('成功したら timeout が clear され Promise が resolve', async () => {
      vi.useFakeTimers();
      const postMessage = vi.fn();
      const state = makeState({ postMessage });

      const promise = sendToOpfsWorker(state, 'PING');
      // pending の resolve を直接呼ぶ — これは sendToOpfsWorker 内で wrap された resolve (clearTimeout 付き)
      const wrapped = state.opfsPending.get(1)!;
      wrapped.resolve('pong');

      await expect(promise).resolves.toBe('pong');
      // タイマーがクリアされたので進めても reject しない — pending は wrap では削除されない (onmessage 側で削除)
      // ここでは timeout が発火しないことを確認
      vi.advanceTimersByTime(15000);
      await expect(promise).resolves.toBe('pong');
      // 手動で後片付け
      state.opfsPending.delete(1);
      expect(state.opfsPending.has(1)).toBe(false);
    });

    it('reject されたら timeout が clear され reject が伝播', async () => {
      vi.useFakeTimers();
      const postMessage = vi.fn();
      const state = makeState({ postMessage });

      const promise = sendToOpfsWorker(state, 'FAIL');
      const wrapped = state.opfsPending.get(1)!;
      wrapped.reject(new Error('worker error'));

      await expect(promise).rejects.toThrow('worker error');
      vi.advanceTimersByTime(15000);
      // timeout は clear されたので pending は wrap では削除されないまま
      // ここでは二重 reject が起きないことを確認
      await expect(promise).rejects.toThrow('worker error');
      state.opfsPending.delete(1);
      expect(state.opfsPending.has(1)).toBe(false);
    });

    it('timeout 後に後から resolve が来ても無視される (pending 削除済み)', async () => {
      vi.useFakeTimers();
      const postMessage = vi.fn();
      const state = makeState({ postMessage });

      const promise = sendToOpfsWorker(state, 'TIMEOUT_TEST');
      const id = 1;
      vi.advanceTimersByTime(15000);
      await expect(promise).rejects.toThrow('OPFS Worker timeout');

      // すでに pending 削除済みなので、Worker からの遅延レスポンスは無視される
      // state に再び同じ id で pending を作っても別 promise なので影響なし
      expect(state.opfsPending.has(id)).toBe(false);
    });

    it('複数の pending が独立して timeout する', async () => {
      vi.useFakeTimers();
      const postMessage = vi.fn();
      const state = makeState({ postMessage });

      const p1 = sendToOpfsWorker(state, 'Q1');
      const p2 = sendToOpfsWorker(state, 'Q2');
      expect(state.opfsPending.size).toBe(2);

      vi.advanceTimersByTime(15000);
      await expect(p1).rejects.toThrow('OPFS Worker timeout: Q1');
      await expect(p2).rejects.toThrow('OPFS Worker timeout: Q2');
      expect(state.opfsPending.size).toBe(0);
    });

    it('ID がインクリメントされ続ける', async () => {
      vi.useFakeTimers();
      const postMessage = vi.fn();
      const state = makeState({ postMessage });
      state.opfsRequestId = 5;

      const promise = sendToOpfsWorker(state, 'X');
      expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 6 }));
      // cleanup
      state.opfsPending.get(6)!.resolve('ok');
      await expect(promise).resolves.toBe('ok');
    });
  });

  // ── tryOpfsProxy ────────────────────────────────────────────────────────
  describe('tryOpfsProxy', () => {
    it('worker が無い場合は null', async () => {
      const state = makeState(null);
      expect(await tryOpfsProxy(state, 'QUERY')).toBeNull();
    });

    it('成功時は結果を返す', async () => {
      const postMessage = vi.fn();
      const state = makeState({ postMessage });
      const promise = tryOpfsProxy<{ v: number }>(state, 'Q');
      state.opfsPending.get(1)!.resolve({ v: 42 });
      expect(await promise).toEqual({ v: 42 });
    });

    it('失敗時は null にフォールバックし logWarn', async () => {
      const postMessage = vi.fn();
      const state = makeState({ postMessage });
      const promise = tryOpfsProxy(state, 'Q');
      state.opfsPending.get(1)!.reject(new Error('fail'));
      expect(await promise).toBeNull();
      expect(logWarn).toHaveBeenCalled();
    });
  });

  // ── initOpfsWorker ─────────────────────────────────────────────────────
  describe('initOpfsWorker', () => {
    it('isOpfsAvailable false なら false を返す', async () => {
      vi.stubGlobal('navigator', { storage: {} } as never);
      const state = makeState(null);
      expect(await initOpfsWorker(state)).toBe(false);
    });

    it('canCreateWorker false なら false を返す', async () => {
      vi.stubGlobal('navigator', { storage: { getDirectory: () => {} } } as never);
      const g = globalThis as unknown as Record<string, unknown>;
      const saved = g.Worker;
      delete g.Worker;
      const state = makeState(null);
      expect(await initOpfsWorker(state)).toBe(false);
      g.Worker = saved;
    });

    it('createOpfsWorker が null を返せば false', async () => {
      vi.stubGlobal('navigator', { storage: { getDirectory: () => {} } } as never);
      class ThrowingWorker { constructor() { throw new Error('no'); } }
      vi.stubGlobal('Worker', ThrowingWorker as never);
      const state = makeState(null);
      expect(await initOpfsWorker(state)).toBe(false);
    });

    it('INIT が initialized:true を返せば true', async () => {
      vi.stubGlobal('navigator', { storage: { getDirectory: () => {} } } as never);
      const mockWorker: Record<string, unknown> = { postMessage: vi.fn() };
      class FakeWorker { constructor() { return mockWorker as never; } }
      vi.stubGlobal('Worker', FakeWorker as never);

      const state = makeState(null);
      const initPromise = initOpfsWorker(state);
      // microtask: wait for initOpfsWorker to set pending, then resolve
      await Promise.resolve();
      // after microtask, pending should be set — resolve it
      const pending = state.opfsPending.get(1);
      expect(pending).toBeDefined();
      pending!.resolve({ initialized: true });
      expect(await initPromise).toBe(true);
    });

    it('INIT が initialized: false なら false と logWarn', async () => {
      vi.stubGlobal('navigator', { storage: { getDirectory: () => {} } } as never);
      const mockWorker: Record<string, unknown> = { postMessage: vi.fn() };
      class FakeWorker { constructor() { return mockWorker as never; } }
      vi.stubGlobal('Worker', FakeWorker as never);
      const state = makeState(null);
      const p = initOpfsWorker(state);
      await Promise.resolve();
      state.opfsPending.get(1)?.resolve({ initialized: false } as never);
      expect(await p).toBe(false);
      expect(logWarn).toHaveBeenCalled();
    });

    it('INIT が undefined を返せば false', async () => {
      vi.stubGlobal('navigator', { storage: { getDirectory: () => {} } } as never);
      const mockWorker: Record<string, unknown> = { postMessage: vi.fn() };
      class FakeWorker { constructor() { return mockWorker as never; } }
      vi.stubGlobal('Worker', FakeWorker as never);
      const state = makeState(null);
      const p = initOpfsWorker(state);
      await Promise.resolve();
      state.opfsPending.get(1)?.resolve(undefined as never);
      expect(await p).toBe(false);
    });

    it('例外時は false と logWarn', async () => {
      vi.stubGlobal('navigator', { storage: { getDirectory: () => {} } } as never);
      class ThrowingWorker { constructor() { throw new Error('boom'); } }
      vi.stubGlobal('Worker', ThrowingWorker as never);
      const state = makeState(null);
      expect(await initOpfsWorker(state)).toBe(false);
    });
  });

  // ── terminateOpfsWorker ────────────────────────────────────────────────
  describe('terminateOpfsWorker', () => {
    it('worker があれば terminate し pending を reject して clear', async () => {
      const terminate = vi.fn();
      const state = makeState({ terminate });
      const pendingReject = vi.fn();
      state.opfsPending.set(1, { resolve: vi.fn(), reject: pendingReject });
      state.opfsPending.set(2, { resolve: vi.fn(), reject: vi.fn() });

      terminateOpfsWorker(state);

      expect(terminate).toHaveBeenCalledOnce();
      expect(state.opfsWorker).toBeNull();
      expect(state.opfsPending.size).toBe(0);
      expect(pendingReject).toHaveBeenCalled();
      expect((pendingReject.mock.calls[0][0] as Error).message).toBe('OPFS Worker terminated');
    });

    it('worker が無い場合は何もしない', () => {
      const state = makeState(null);
      expect(() => terminateOpfsWorker(state)).not.toThrow();
      expect(state.opfsPending.size).toBe(0);
    });

    it('pending が空でも terminate する', () => {
      const terminate = vi.fn();
      const state = makeState({ terminate });
      terminateOpfsWorker(state);
      expect(terminate).toHaveBeenCalledOnce();
      expect(state.opfsWorker).toBeNull();
    });
  });
});
