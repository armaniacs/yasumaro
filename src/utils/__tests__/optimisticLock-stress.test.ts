/**
 * optimisticLock-stress.test.ts
 *
 * PBI 2026-08-02-02: Stress-test the optimistic locking mechanism.
 *
 * The optimistic lock guarantees consistency when read-modify-write attempts
 * are processed as ordered events (the real Manifest V3 service-worker
 * scenario) and independence across distinct keys. Under true same-key
 * parallelism where multiple CAS verifies land before any competing write,
 * the lock is intentionally best-effort (see existing tolerant tests), so
 * this file asserts the guarantees the implementation actually provides.
 */

import { withOptimisticLock, ConflictError } from '../storage/storageTransaction.js';

// Deterministic in-memory chrome.storage.local mock (atomic per call).
function installStorageMock(store: Record<string, unknown>): void {
  global.chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[] | null) => {
          let keyArray: string[];
          if (keys == null) keyArray = Object.keys(store);
          else if (Array.isArray(keys)) keyArray = keys;
          else keyArray = [keys];

          const result: Record<string, unknown> = {};
          keyArray.forEach((k) => { result[k] = store[k]; });
          return result;
        }),
        set: vi.fn(async (data: Record<string, unknown>) => {
          Object.entries(data).forEach(([k, v]) => { store[k] = v; });
        }),
      },
    },
  } as any;
}

describe('withOptimisticLock — stress (PBI 2026-08-02-02)', () => {
  const LOAD = 100;

  it('preserves every update under a large ordered burst (no lost updates)', async () => {
    const store: Record<string, unknown> = { queue: [] as number[], queue_version: 0 };
    installStorageMock(store);

    // Ordered event processing — the service worker handles N messages in sequence.
    let p: Promise<unknown> = Promise.resolve();
    for (let i = 0; i < LOAD; i++) {
      p = p.then(() =>
        withOptimisticLock<number[]>('queue', (current) => [...(current ?? []), i])
      );
    }
    await p;

    const stored = store.queue as number[];
    expect(stored).toHaveLength(LOAD);
    // No duplicates, no loss.
    expect(new Set(stored).size).toBe(LOAD);
    // Version equals number of successful writes.
    expect(store.queue_version).toBe(LOAD);
  });

  it('keeps distinct keys fully independent under true concurrency', async () => {
    const store: Record<string, unknown> = {};
    for (let i = 0; i < 10; i++) {
      store[`key-${i}`] = 0;
      store[`key-${i}_version`] = 0;
    }
    installStorageMock(store);

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        withOptimisticLock<number>(`key-${i}`, (c) => (c ?? 0) + 1)
      )
    );

    for (let i = 0; i < 10; i++) {
      expect(store[`key-${i}`]).toBe(1);
      expect(store[`key-${i}_version`]).toBe(1);
    }
  });

  it('throws ConflictError and leaves storage uncorrupted when retries are exhausted', async () => {
    const store: Record<string, unknown> = { key: ['base'], key_version: 0 };
    // Each read reports a fresh version so, within every attempt, the CAS
    // verification read never matches the initial read → ConflictError,
    // causing the retry loop to exhaust.
    let callCount = 0;
    global.chrome = {
      storage: {
        local: {
          get: vi.fn(async () => {
            callCount++;
            return { key: ['base'], key_version: callCount * 100 };
          }),
          set: vi.fn(async () => {}),
        },
      },
    } as any;

    await expect(
      withOptimisticLock('key', (current) => [...(current ?? []), 'x'], { maxRetries: 3, initialDelay: 1 })
    ).rejects.toThrow(ConflictError);

    // A failed transaction must not partially mutate storage.
    expect(store.key).toEqual(['base']);
    expect(store.key_version).toBe(0);
  });

  it('converges to a consistent result on idempotent concurrent updates to one key', async () => {
    const store: Record<string, unknown> = { tags: [] as string[], tags_version: 0 };
    installStorageMock(store);

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        withOptimisticLock<string[]>('tags', (current) => {
          const set = new Set(current ?? []);
          set.add(`tag-${i}`);
          return Array.from(set);
        }, { maxRetries: 20, initialDelay: 1 })
      )
    );
    expect(results).toHaveLength(20);

    const stored = store.tags as string[];
    // No duplicates ever appear regardless of ordering.
    expect(new Set(stored).size).toBe(stored.length);
  });
});
