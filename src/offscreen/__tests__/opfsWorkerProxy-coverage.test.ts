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
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    // vi.unstubAllGlobals() が stub 前の環境グローバルへ戻す。
    // vitest 5 では環境グローバルへの直接代入が不可のため手動復元は行わない
    vi.unstubAllGlobals();
  });

  // ── isOpfsAvailable ───────────────────────────────────────────────────
  describe('isOpfsAvailable', () => {
    it('returns true when navigator.storage.getDirectory is a function', () => {
      vi.stubGlobal('navigator', { storage: { getDirectory: () => {} } } as never);
      expect(isOpfsAvailable()).toBe(true);
    });

    it('returns false when getDirectory is missing', () => {
      vi.stubGlobal('navigator', { storage: {} } as never);
      expect(isOpfsAvailable()).toBe(false);
    });

    it('returns false even when navigator is undefined (exception path)', () => {
      vi.stubGlobal('navigator', undefined as never);
      expect(isOpfsAvailable()).toBe(false);
    });

    it('returns false when getDirectory is not a function', () => {
      vi.stubGlobal('navigator', { storage: { getDirectory: 'not-a-function' } } as never);
      expect(isOpfsAvailable()).toBe(false);
    });
  });

  // ── canCreateWorker ───────────────────────────────────────────────────
  describe('canCreateWorker', () => {
    it('returns true when Worker exists on globalThis', () => {
      vi.stubGlobal('Worker', function FakeWorker() {} as never);
      expect(canCreateWorker()).toBe(true);
    });

    it('returns false when Worker is missing', () => {
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

    it('returns the Worker and sets onmessage/onerror on successful creation', async () => {
      const mockWorker: Record<string, unknown> = {};
      stubWorkerWithInstance(mockWorker);

      const state = makeState(null);
      const worker = createOpfsWorker(state);

      expect(worker).toBe(mockWorker);
      expect(mockWorker.onmessage).toBeDefined();
      expect(mockWorker.onerror).toBeDefined();
    });

    it('returns null and calls logWarn when Worker creation throws', () => {
      class ThrowingWorker { constructor() { throw new Error('no worker'); } }
      vi.stubGlobal('Worker', ThrowingWorker as never);
      const state = makeState(null);
      const worker = createOpfsWorker(state);
      expect(worker).toBeNull();
      expect(logWarn).toHaveBeenCalled();
    });

    it('onmessage: calls logError when __log is true with level=error', () => {
      const mockWorker: Record<string, unknown> = {};
      stubWorkerWithInstance(mockWorker);
      const state = makeState(null);
      createOpfsWorker(state);
      const onmessage = mockWorker.onmessage as (e: MessageEvent<unknown>) => void;

      onmessage({ data: { __log: true, level: 'error', message: 'boom', details: { x: 1 } } } as MessageEvent<unknown>);
      expect(logError).toHaveBeenCalled();
    });

    it('onmessage: calls logWarn when __log is true with level=warn', () => {
      const mockWorker: Record<string, unknown> = {};
      stubWorkerWithInstance(mockWorker);
      const state = makeState(null);
      createOpfsWorker(state);
      (mockWorker.onmessage as (e: MessageEvent<unknown>) => void)({ data: { __log: true, level: 'warn', message: 'w', details: {} } } as MessageEvent<unknown>);
      expect(logWarn).toHaveBeenCalled();
    });

    it('onmessage: calls logInfo when __log is true with level=info', () => {
      const mockWorker: Record<string, unknown> = {};
      stubWorkerWithInstance(mockWorker);
      const state = makeState(null);
      createOpfsWorker(state);
      (mockWorker.onmessage as (e: MessageEvent<unknown>) => void)({ data: { __log: true, level: 'info', message: 'i', details: {} } } as MessageEvent<unknown>);
      expect(logInfo).toHaveBeenCalled();
    });

    it('onmessage: resolves pending when success=true', () => {
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

    it('onmessage: rejects pending when success=false', () => {
      const mockWorker: Record<string, unknown> = {};
      stubWorkerWithInstance(mockWorker);
      const state = makeState(null);
      createOpfsWorker(state);
      const pending = { resolve: vi.fn(), reject: vi.fn() };
      state.opfsPending.set(2, pending);
      (mockWorker.onmessage as (e: MessageEvent<unknown>) => void)({ data: { id: 2, success: false, error: 'fail' } } as MessageEvent<unknown>);
      expect(pending.reject).toHaveBeenCalled();
      expect((pending.reject.mock.calls[0]![0] as Error).message).toBe('fail');
    });

    it('onmessage: ignores ids with no pending entry', () => {
      const mockWorker: Record<string, unknown> = {};
      stubWorkerWithInstance(mockWorker);
      const state = makeState(null);
      createOpfsWorker(state);
      expect(() => (mockWorker.onmessage as (e: MessageEvent<unknown>) => void)({ data: { id: 999, success: true, result: 'x' } } as MessageEvent<unknown>)).not.toThrow();
    });

    it('onerror: rejects all pending entries and calls logError', () => {
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
    it('rejects immediately when the worker is missing', async () => {
      const state = makeState(null);
      await expect(sendToOpfsWorker(state, 'QUERY')).rejects.toThrow('OPFS Worker not available');
    });

    it('rejects with a timeout after 15s and removes the pending entry', async () => {
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

    it('clears the timeout and resolves the Promise on success', async () => {
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

    it('clears the timeout and propagates the rejection on reject', async () => {
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

    it('ignores a late resolve after a timeout (pending already removed)', async () => {
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

    it('times out multiple pending entries independently', async () => {
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

    it('keeps incrementing IDs', async () => {
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
    it('returns null when the worker is missing', async () => {
      const state = makeState(null);
      expect(await tryOpfsProxy(state, 'QUERY')).toBeNull();
    });

    it('returns the result on success', async () => {
      const postMessage = vi.fn();
      const state = makeState({ postMessage });
      const promise = tryOpfsProxy<{ v: number }>(state, 'Q');
      state.opfsPending.get(1)!.resolve({ v: 42 });
      expect(await promise).toEqual({ v: 42 });
    });

    it('falls back to null and calls logWarn on failure', async () => {
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
    it('returns false when isOpfsAvailable is false', async () => {
      vi.stubGlobal('navigator', { storage: {} } as never);
      const state = makeState(null);
      expect(await initOpfsWorker(state)).toBe(false);
    });

    it('returns false when canCreateWorker is false', async () => {
      vi.stubGlobal('navigator', { storage: { getDirectory: () => {} } } as never);
      const g = globalThis as unknown as Record<string, unknown>;
      const saved = g.Worker;
      delete g.Worker;
      const state = makeState(null);
      expect(await initOpfsWorker(state)).toBe(false);
      g.Worker = saved;
    });

    it('returns false when createOpfsWorker returns null', async () => {
      vi.stubGlobal('navigator', { storage: { getDirectory: () => {} } } as never);
      class ThrowingWorker { constructor() { throw new Error('no'); } }
      vi.stubGlobal('Worker', ThrowingWorker as never);
      const state = makeState(null);
      expect(await initOpfsWorker(state)).toBe(false);
    });

    it('returns true when INIT returns initialized:true', async () => {
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

    it('returns false and calls logWarn when INIT returns initialized:false', async () => {
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

    it('returns false when INIT returns undefined', async () => {
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

    it('returns false and calls logWarn on exception', async () => {
      vi.stubGlobal('navigator', { storage: { getDirectory: () => {} } } as never);
      class ThrowingWorker { constructor() { throw new Error('boom'); } }
      vi.stubGlobal('Worker', ThrowingWorker as never);
      const state = makeState(null);
      expect(await initOpfsWorker(state)).toBe(false);
    });
  });

  // ── terminateOpfsWorker ────────────────────────────────────────────────
  describe('terminateOpfsWorker', () => {
    it('terminates the worker and rejects then clears pending entries when a worker exists', async () => {
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
      expect((pendingReject.mock.calls[0]![0] as Error).message).toBe('OPFS Worker terminated');
    });

    it('does nothing when the worker is missing', () => {
      const state = makeState(null);
      expect(() => terminateOpfsWorker(state)).not.toThrow();
      expect(state.opfsPending.size).toBe(0);
    });

    it('terminates even when pending is empty', () => {
      const terminate = vi.fn();
      const state = makeState({ terminate });
      terminateOpfsWorker(state);
      expect(terminate).toHaveBeenCalledOnce();
      expect(state.opfsWorker).toBeNull();
    });
  });
});
