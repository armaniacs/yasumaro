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

  it('persists retryCount progress per job, not only after the full pass completes', async () => {
    await queue.enqueue({ type: 'ai_summary', payload: { url: 'https://a.com' } });
    await queue.enqueue({ type: 'ai_summary', payload: { url: 'https://b.com' } });

    let resolveSecondJob: (() => void) | undefined;
    const secondJobStarted = new Promise<void>((resolve) => {
      resolveSecondJob = resolve;
    });
    // Held so the test can resolve the in-flight handler call explicitly at
    // the end, rather than leaving it (and the retryAll() Promise chain)
    // permanently pending — see PBI-2026-08-01-21.
    let resolveSecondJobHandler: ((success: boolean) => void) | undefined;

    const retryAllPromise = queue.retryAll(async (job) => {
      if ((job.payload as { url: string }).url === 'https://b.com') {
        resolveSecondJob?.();
        // Simulates the Service Worker being torn down while the second job
        // is still in flight: the handler call doesn't resolve until the
        // test explicitly does so below.
        return new Promise<boolean>((resolve) => {
          resolveSecondJobHandler = resolve;
        });
      }
      return false;
    });

    await secondJobStarted;

    // At this point the first job has already been handled by retryAll's
    // loop, and the second job's handler call is still pending (unresolved).
    // The first job's retryCount increment must already be durable in
    // storage — this is the behavior PBI-2026-08-01-14 fixes (previously
    // only a single save after the *entire* loop completed meant this
    // progress would be lost if the SW terminated here).
    const persisted = storage['offline_network_queue'] as OfflineJob[];
    const jobA = persisted.find((j) => (j.payload as { url: string }).url === 'https://a.com');
    expect(jobA?.retryCount).toBe(1);

    // Explicit cleanup: resolve the in-flight handler and await retryAll()
    // so no pending Promise chain outlives this test.
    resolveSecondJobHandler?.(false);
    await retryAllPromise;
  });

  it('processes at most MAX_JOBS_PER_CYCLE (20) jobs in a single retryAll pass', async () => {
    for (let i = 0; i < 50; i++) {
      await queue.enqueue({ type: 'ai_summary', payload: { index: i } });
    }
    expect(await queue.getQueueSize()).toBe(50);

    let handlerCallCount = 0;
    await queue.retryAll(async () => {
      handlerCallCount++;
      return true; // remove each processed job
    });

    expect(handlerCallCount).toBe(20);
    expect(await queue.getQueueSize()).toBe(30);
  });

  it('leaves jobs under the per-cycle cap fully processed (no artificial truncation)', async () => {
    for (let i = 0; i < 10; i++) {
      await queue.enqueue({ type: 'ai_summary', payload: { index: i } });
    }

    let handlerCallCount = 0;
    await queue.retryAll(async () => {
      handlerCallCount++;
      return true;
    });

    expect(handlerCallCount).toBe(10);
    expect(await queue.getQueueSize()).toBe(0);
  });

  it('processes the deferred remainder on the next retryAll call', async () => {
    for (let i = 0; i < 25; i++) {
      await queue.enqueue({ type: 'ai_summary', payload: { index: i } });
    }

    const processedIndexes: number[] = [];
    const handler = async (job: OfflineJob) => {
      processedIndexes.push((job.payload as { index: number }).index);
      return true;
    };

    await queue.retryAll(handler); // cycle 1: processes indexes 0-19
    expect(await queue.getQueueSize()).toBe(5);

    await queue.retryAll(handler); // cycle 2: processes the remaining 5
    expect(await queue.getQueueSize()).toBe(0);
    expect(processedIndexes).toEqual(Array.from({ length: 25 }, (_, i) => i));
  });

  it('does not touch jobs deferred past the per-cycle cap (retryCount unchanged)', async () => {
    for (let i = 0; i < 21; i++) {
      await queue.enqueue({ type: 'ai_summary', payload: { index: i } });
    }

    await queue.retryAll(async () => false); // fail every processed job

    const persisted = storage['offline_network_queue'] as OfflineJob[];
    expect(persisted).toHaveLength(21);
    const processed = persisted.filter((j) => j.retryCount > 0);
    const deferred = persisted.filter((j) => j.retryCount === 0);
    expect(processed).toHaveLength(20);
    expect(deferred).toHaveLength(1);
    expect((deferred[0].payload as { index: number }).index).toBe(20);
  });
});
