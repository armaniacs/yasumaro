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
    it('rejects when the worker is missing', async () => {
      const state = makeState(null);
      await expect(sendToOpfsWorker(state, 'QUERY')).rejects.toThrow('OPFS Worker not available');
    });

    it('assigns incrementing IDs per request', () => {
      const postMessage = vi.fn();
      const state = makeState({ postMessage });

      void sendToOpfsWorker(state, 'QUERY', { sql: 'SELECT 1' });
      void sendToOpfsWorker(state, 'QUERY', { sql: 'SELECT 2' });

      expect(postMessage).toHaveBeenNthCalledWith(1, { id: 1, type: 'QUERY', payload: { sql: 'SELECT 1' } });
      expect(postMessage).toHaveBeenNthCalledWith(2, { id: 2, type: 'QUERY', payload: { sql: 'SELECT 2' } });
      expect(state.opfsPending.size).toBe(2);
    });

    it('resolves the Promise when resolved (removal is the onmessage handler responsibility)', async () => {
      const postMessage = vi.fn();
      const state = makeState({ postMessage });

      const promise = sendToOpfsWorker(state, 'QUERY');
      state.opfsPending.get(1)!.resolve('ok');

      await expect(promise).resolves.toBe('ok');
    });

    it('rejects the Promise when rejected (removal is the onmessage handler responsibility)', async () => {
      const postMessage = vi.fn();
      const state = makeState({ postMessage });

      const promise = sendToOpfsWorker(state, 'QUERY');
      state.opfsPending.get(1)!.reject(new Error('boom'));

      await expect(promise).rejects.toThrow('boom');
    });
  });

  describe('tryOpfsProxy', () => {
    it('returns null when the worker is missing', async () => {
      const state = makeState(null);
      await expect(tryOpfsProxy(state, 'QUERY')).resolves.toBeNull();
    });

    it('falls back to null when sendToOpfsWorker fails', async () => {
      const postMessage = vi.fn();
      const state = makeState({ postMessage });

      const result = tryOpfsProxy(state, 'QUERY');
      state.opfsPending.get(1)!.reject(new Error('worker error'));

      await expect(result).resolves.toBeNull();
    });

    it('returns the result as-is on success', async () => {
      const postMessage = vi.fn();
      const state = makeState({ postMessage });

      const result = tryOpfsProxy<{ rows: number[] }>(state, 'QUERY');
      state.opfsPending.get(1)!.resolve({ rows: [1, 2, 3] });

      await expect(result).resolves.toEqual({ rows: [1, 2, 3] });
    });
  });

  describe('terminateOpfsWorker', () => {
    it('terminates the worker and rejects all pending requests', async () => {
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

    it('does nothing when the worker is missing', () => {
      const state = makeState(null);
      expect(() => terminateOpfsWorker(state)).not.toThrow();
    });
  });
});
