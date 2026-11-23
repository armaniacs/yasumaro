/**
 * payload.test.ts — PBI 2026-11-08-07(6).
 *
 * An unserializable (e.g. circular) payload must not measure 0 bytes: 0 sails
 * through the capacity gate and queues a job storage cannot persist. It
 * measures +Infinity instead, so the queue drops it via its normal
 * "payload too large" path and it never enters the queue.
 */
import { describe, it, expect } from 'vitest';
import { estimatePayloadSize } from '../payload.js';
import { createOfflineNetworkQueue } from '../../offlineNetworkQueue.js';
import { InMemoryAdapter } from '../../persistentRetryQueue.js';

describe('queue payload', () => {
  describe('estimatePayloadSize', () => {
    it('measures a serializable payload in bytes', () => {
      // JSON.stringify({ a: 'b' }) is '{"a":"b"}': 9 ASCII bytes.
      expect(estimatePayloadSize({ a: 'b' })).toBe(9);
    });

    it('reports a circular payload as infinitely large instead of 0 bytes', () => {
      const circular: Record<string, unknown> = { title: 't' };
      circular['self'] = circular;
      expect(estimatePayloadSize(circular)).toBe(Number.POSITIVE_INFINITY);
    });

    it('reports an unserializable payload as infinitely large instead of 0 bytes', () => {
      expect(estimatePayloadSize({ count: 10n })).toBe(Number.POSITIVE_INFINITY);
    });
  });

  describe('offline queue capacity gate', () => {
    it('refuses to enqueue a job carrying a circular payload', async () => {
      const queue = createOfflineNetworkQueue(new InMemoryAdapter());
      const circular: Record<string, unknown> = {
        title: 't',
        url: 'https://example.com/circular',
        content: 'c',
      };
      circular['self'] = circular;

      const enqueued = await queue.enqueue({ type: 'ai_summary', payload: circular });

      expect(enqueued).toBe(false);
      expect(await queue.getQueueSize()).toBe(0);
    });
  });
});
