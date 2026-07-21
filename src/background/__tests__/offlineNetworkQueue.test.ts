import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OfflineNetworkQueue, type OfflineJob } from '../offlineNetworkQueue.js';

describe('OfflineNetworkQueue', () => {
  let queue: OfflineNetworkQueue;
  let storage: Record<string, unknown>;

  beforeEach(() => {
    queue = new OfflineNetworkQueue();
    storage = {};
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn(async (keys: string | string[]) => {
            const ks = Array.isArray(keys) ? keys : [keys];
            const result: Record<string, unknown> = {};
            ks.forEach((key) => { if (key in storage) result[key] = storage[key]; });
            return result;
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(storage, items);
          }),
        },
      },
    };
  });

  it('enqueue stores a job', async () => {
    await queue.enqueue({ type: 'ai_summary', payload: { url: 'https://example.com' } });
    const size = await queue.getQueueSize();
    expect(size).toBe(1);
  });

  it('dequeue returns the oldest job and removes it', async () => {
    await queue.enqueue({ type: 'ai_summary', payload: { url: 'https://first.com' } });
    await queue.enqueue({ type: 'obsidian_sync', payload: { url: 'https://second.com' } });

    const job = await queue.dequeue();
    expect(job?.type).toBe('ai_summary');
    expect(await queue.getQueueSize()).toBe(1);
  });

  it('dequeue returns null for an empty queue', async () => {
    const job = await queue.dequeue();
    expect(job).toBeNull();
  });

  it('peek returns the oldest job without removing it', async () => {
    await queue.enqueue({ type: 'ai_summary', payload: { url: 'https://example.com' } });

    const job = await queue.peek();
    expect(job?.type).toBe('ai_summary');
    expect(await queue.getQueueSize()).toBe(1);
  });

  it('retryAll removes jobs when handler returns true', async () => {
    await queue.enqueue({ type: 'ai_summary', payload: { url: 'https://example.com' } });

    await queue.retryAll(async () => true);

    expect(await queue.getQueueSize()).toBe(0);
  });

  it('retryAll keeps jobs when handler returns false', async () => {
    await queue.enqueue({ type: 'ai_summary', payload: { url: 'https://example.com' } });

    await queue.retryAll(async () => false);

    expect(await queue.getQueueSize()).toBe(1);
    const job = await queue.peek();
    expect(job?.retryCount).toBe(1);
  });

  it('retryAll increments retry count on handler error', async () => {
    await queue.enqueue({ type: 'obsidian_sync', payload: { url: 'https://example.com' } });

    await queue.retryAll(async () => {
      throw new Error('network error');
    });

    const job = await queue.peek();
    expect(job?.retryCount).toBe(1);
    expect(job?.lastError).toBe('network error');
  });

  it('drops jobs that exceed max retry count', async () => {
    await queue.enqueue({ type: 'ai_summary', payload: { url: 'https://example.com' } });
    for (let i = 0; i < 3; i++) {
      await queue.retryAll(async () => false);
    }

    expect(await queue.getQueueSize()).toBe(0);
  });

  it('drops expired jobs', async () => {
    const oldJob: OfflineJob = {
      id: 'old',
      type: 'ai_summary',
      payload: { url: 'https://old.com' },
      createdAt: Date.now() - (8 * 24 * 60 * 60 * 1000),
      retryCount: 0,
    };
    storage['offline_network_queue'] = [oldJob];

    await queue.retryAll(async () => true);

    expect(await queue.getQueueSize()).toBe(0);
  });

  it('drops oldest jobs when queue exceeds max size', async () => {
    for (let i = 0; i < 201; i++) {
      await queue.enqueue({ type: 'ai_summary', payload: { index: i } });
    }

    expect(await queue.getQueueSize()).toBe(200);
    const oldest = await queue.peek();
    expect((oldest?.payload as { index: number }).index).toBe(1);
  });

  it('drops jobs with oversized payloads', async () => {
    const hugePayload = 'x'.repeat(60 * 1024);
    await queue.enqueue({ type: 'ai_summary', payload: hugePayload });
    expect(await queue.getQueueSize()).toBe(0);
  });

  it('persists queue across instances', async () => {
    await queue.enqueue({ type: 'ai_summary', payload: { url: 'https://example.com' } });

    const otherQueue = new OfflineNetworkQueue();
    expect(await otherQueue.getQueueSize()).toBe(1);
  });
});
