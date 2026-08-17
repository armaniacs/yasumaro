/**
 * Unit tests for opfsWorkerProxy.ts (PBI-01 extraction).
 * Covers message ID assignment, success/failure resolution, and pending
 * request release on Worker error — the module's own state contract
 * (OpfsProxyState) rather than the full SqliteEngineContext facade.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  sendToOpfsWorker,
  tryOpfsProxy,
  terminateOpfsWorker,
  type OpfsProxyState,
} from '../opfsWorkerProxy.js';

function makeState(worker: Partial<Worker> | null): OpfsProxyState {
  return {
    opfsWorker: worker as Worker | null,
    opfsRequestId: 0,
    opfsPending: new Map(),
  };
}

describe('opfsWorkerProxy', () => {
  describe('sendToOpfsWorker', () => {
    it('worker が無い場合は reject する', async () => {
      const state = makeState(null);
      await expect(sendToOpfsWorker(state, 'QUERY')).rejects.toThrow('OPFS Worker not available');
    });

    it('リクエストごとに ID をインクリメントして割り当てる', () => {
      const postMessage = vi.fn();
      const state = makeState({ postMessage });

      void sendToOpfsWorker(state, 'QUERY', { sql: 'SELECT 1' });
      void sendToOpfsWorker(state, 'QUERY', { sql: 'SELECT 2' });

      expect(postMessage).toHaveBeenNthCalledWith(1, { id: 1, type: 'QUERY', payload: { sql: 'SELECT 1' } });
      expect(postMessage).toHaveBeenNthCalledWith(2, { id: 2, type: 'QUERY', payload: { sql: 'SELECT 2' } });
      expect(state.opfsPending.size).toBe(2);
    });

    it('resolve されたら Promise が解決される（削除は onmessage ハンドラ側の責務）', async () => {
      const postMessage = vi.fn();
      const state = makeState({ postMessage });

      const promise = sendToOpfsWorker(state, 'QUERY');
      state.opfsPending.get(1)!.resolve('ok');

      await expect(promise).resolves.toBe('ok');
    });

    it('reject されたら Promise が拒否される（削除は onmessage ハンドラ側の責務）', async () => {
      const postMessage = vi.fn();
      const state = makeState({ postMessage });

      const promise = sendToOpfsWorker(state, 'QUERY');
      state.opfsPending.get(1)!.reject(new Error('boom'));

      await expect(promise).rejects.toThrow('boom');
    });
  });

  describe('tryOpfsProxy', () => {
    it('worker が無い場合は null を返す', async () => {
      const state = makeState(null);
      await expect(tryOpfsProxy(state, 'QUERY')).resolves.toBeNull();
    });

    it('sendToOpfsWorker が失敗したら null にフォールバックする', async () => {
      const postMessage = vi.fn();
      const state = makeState({ postMessage });

      const result = tryOpfsProxy(state, 'QUERY');
      state.opfsPending.get(1)!.reject(new Error('worker error'));

      await expect(result).resolves.toBeNull();
    });

    it('成功時は結果をそのまま返す', async () => {
      const postMessage = vi.fn();
      const state = makeState({ postMessage });

      const result = tryOpfsProxy<{ rows: number[] }>(state, 'QUERY');
      state.opfsPending.get(1)!.resolve({ rows: [1, 2, 3] });

      await expect(result).resolves.toEqual({ rows: [1, 2, 3] });
    });
  });

  describe('terminateOpfsWorker', () => {
    it('worker を terminate し、pending 中の全リクエストを reject する', async () => {
      const terminate = vi.fn();
      const state = makeState({ terminate });

      const rejections: Promise<unknown>[] = [];
      state.opfsPending.set(1, {
        resolve: vi.fn(),
        reject: (e) => rejections.push(Promise.reject(e).catch((err) => err)),
      });

      terminateOpfsWorker(state);

      expect(terminate).toHaveBeenCalledOnce();
      expect(state.opfsWorker).toBeNull();
      expect(state.opfsPending.size).toBe(0);
      const err = await rejections[0];
      expect((err as Error).message).toBe('OPFS Worker terminated');
    });

    it('worker が無い場合は何もしない', () => {
      const state = makeState(null);
      expect(() => terminateOpfsWorker(state)).not.toThrow();
    });
  });
});
