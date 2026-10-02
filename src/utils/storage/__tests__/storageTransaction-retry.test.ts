/**
 * storageTransaction-retry.test.ts
 *
 * Pins the single retry shell and the single post-write verification that
 * withLock (one key) and withAtomic (many keys) now share. The retry wait is
 * injected, so the backoff series is asserted as a list of requested delays
 * instead of being spent as wall time.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStoragePort, type StoragePort } from '../storagePort.js';
import { StorageTransaction, ConflictError, __resetStorageTransactionForTest } from '../storageTransaction.js';

interface SleepRecorder {
  delays: number[];
  sleep: (ms: number) => Promise<void>;
}

function recordingSleep(): SleepRecorder {
  const delays: number[] = [];
  return { delays, sleep: async (ms) => { delays.push(ms); } };
}

/** Every read reports a fresh version, so the pre-write verify read always conflicts. */
function alwaysConflictingPort(): StoragePort {
  let reads = 0;
  return {
    get: async () => {
      reads += 1;
      const snapshot: Record<string, unknown> = {};
      for (const key of ['k', 'a', 'b']) {
        snapshot[key] = `v${reads}`;
        snapshot[`${key}_version`] = reads;
      }
      return snapshot;
    },
    set: async () => undefined,
  };
}

/** Overwrite `key` right after every write, keeping the version the transaction wrote. */
function tamperAfterWrite(port: InMemoryStoragePort, key: string, value: unknown, version: number): void {
  const realSet = port.set.bind(port);
  port.set = async (items) => {
    await realSet(items);
    if (key in items) await realSet({ [key]: value, [`${key}_version`]: version });
  };
}

/** Overwrite `key` right after the first write only, so the retry can commit. */
function tamperAfterFirstWrite(port: InMemoryStoragePort, key: string, value: unknown, version: number): void {
  const realSet = port.set.bind(port);
  let first = true;
  port.set = async (items) => {
    await realSet(items);
    if (first && key in items) {
      first = false;
      await realSet({ [key]: value, [`${key}_version`]: version });
    }
  };
}

async function captureConflict(run: () => Promise<unknown>): Promise<ConflictError> {
  try {
    await run();
  } catch (error) {
    return error as ConflictError;
  }
  throw new Error('expected a ConflictError');
}

describe('shared CAS retry shell', () => {
  beforeEach(() => {
    __resetStorageTransactionForTest();
  });

  it('retries both transaction shapes on the same backoff series', async () => {
    const single = recordingSleep();
    await expect(
      new StorageTransaction(alwaysConflictingPort())
        .withLock<string>('k', (cur) => `${cur ?? ''}!`, { maxRetries: 4, initialDelay: 25, sleep: single.sleep })
    ).rejects.toThrow(ConflictError);

    const multi = recordingSleep();
    await expect(
      new StorageTransaction(alwaysConflictingPort())
        .withAtomic<[string, string]>(
          ['a', 'b'],
          ([a, b]) => [`${a ?? ''}!`, `${b ?? ''}!`],
          { maxRetries: 4, initialDelay: 25, sleep: multi.sleep }
        )
    ).rejects.toThrow(ConflictError);

    expect(single.delays).toEqual([25, 50, 100, 200]);
    expect(multi.delays).toEqual(single.delays);
  });

  it('sleeps once per retry and stops at the default budget of 5', async () => {
    const single = recordingSleep();
    await expect(
      new StorageTransaction(alwaysConflictingPort())
        .withLock<string>('k', (cur) => cur, { sleep: single.sleep })
    ).rejects.toThrow(ConflictError);

    const multi = recordingSleep();
    await expect(
      new StorageTransaction(alwaysConflictingPort())
        .withAtomic<[string, string]>(['a', 'b'], ([a, b]) => [a, b], { sleep: multi.sleep })
    ).rejects.toThrow(ConflictError);

    expect(single.delays).toHaveLength(5);
    expect(multi.delays).toEqual(single.delays);
  });

  it('reports an exhausted budget as the same -1/-1 conflict under each shape\'s key', async () => {
    const single = await captureConflict(() => new StorageTransaction(alwaysConflictingPort())
      .withLock<string>('k', (cur) => cur, { sleep: recordingSleep().sleep }));
    const multi = await captureConflict(() => new StorageTransaction(alwaysConflictingPort())
      .withAtomic<[string, string]>(['a', 'b'], ([a, b]) => [a, b], { sleep: recordingSleep().sleep }));

    expect(single.message).toBe('Conflict detected for key: k (expected: -1, actual: -1)');
    expect(multi.message).toBe('Conflict detected for key: a+b (expected: -1, actual: -1)');
  });

  it('rethrows a non-conflict failure without retrying or waiting', async () => {
    const failingSet: StoragePort = {
      get: async () => ({ k: 'v', k_version: 0 }),
      set: async () => { throw new Error('Storage error'); },
    };
    const recorder = recordingSleep();
    const tx = new StorageTransaction(failingSet);

    await expect(tx.withLock<string>('k', (cur) => cur, { maxRetries: 3, sleep: recorder.sleep }))
      .rejects.toThrow('Storage error');
    await expect(tx.withAtomic<[string]>(['k'], ([k]) => [k], { maxRetries: 3, sleep: recorder.sleep }))
      .rejects.toThrow('Storage error');

    expect(recorder.delays).toEqual([]);
  });
});

describe('shared post-write verification', () => {
  beforeEach(() => {
    __resetStorageTransactionForTest();
  });

  it('retries a single-key write that was lost after the write and commits on top of the competitor', async () => {
    const port = new InMemoryStoragePort();
    await port.set({ list: ['initial'], list_version: 0 });
    tamperAfterFirstWrite(port, 'list', ['stolen'], 1);

    const result = await new StorageTransaction(port)
      .withLock<string[]>('list', (cur) => [...(cur ?? []), 'item'], { maxRetries: 1, sleep: recordingSleep().sleep });

    expect(result).toEqual(['stolen', 'item']);
    expect((await port.get(['list']))['list']).toEqual(['stolen', 'item']);
  });

  it('retries a multi-key write that was lost after the write under the same verification', async () => {
    const port = new InMemoryStoragePort();
    await port.set({ a: ['initial'], a_version: 0, b: ['initial'], b_version: 0 });
    tamperAfterFirstWrite(port, 'b', ['stolen'], 1);

    const result = await new StorageTransaction(port).withAtomic<[string[], string[]]>(
      ['a', 'b'],
      ([a, b]) => [[...(a ?? []), 'item'], [...(b ?? []), 'item']],
      { maxRetries: 1, sleep: recordingSleep().sleep }
    );

    // The multi-key write did land for `a` (atomic: both keys commit together),
    // so the retry re-derives from `a` and re-appends.
    expect(result).toEqual([['initial', 'item', 'item'], ['stolen', 'item']]);
    expect((await port.get(['b']))['b']).toEqual(['stolen', 'item']);
  });

  it('fails a write that keeps being lost, naming each shape\'s keys', async () => {
    const singlePort = new InMemoryStoragePort();
    await singlePort.set({ list: ['initial'], list_version: 0 });
    tamperAfterWrite(singlePort, 'list', ['stolen'], 1);
    const single = await captureConflict(() => new StorageTransaction(singlePort)
      .withLock<string[]>('list', (cur) => [...(cur ?? []), 'item'], { maxRetries: 1, sleep: recordingSleep().sleep }));

    const multiPort = new InMemoryStoragePort();
    await multiPort.set({ a: ['initial'], a_version: 0, b: ['initial'], b_version: 0 });
    tamperAfterWrite(multiPort, 'b', ['stolen'], 1);
    const multi = await captureConflict(() => new StorageTransaction(multiPort)
      .withAtomic<[string[], string[]]>(
        ['a', 'b'],
        ([a, b]) => [[...(a ?? []), 'item'], [...(b ?? []), 'item']],
        { maxRetries: 1, sleep: recordingSleep().sleep }
      ));

    expect(single.message).toBe('Conflict detected for key: list (expected: -1, actual: -1)');
    expect(multi.message).toBe('Conflict detected for key: a+b (expected: -1, actual: -1)');
  });

  it('passes a write that survived verification', async () => {
    const port = new InMemoryStoragePort();
    const tx = new StorageTransaction(port);

    await expect(tx.withLock<string[]>('list', (cur) => [...(cur ?? []), 'item'])).resolves.toEqual(['item']);
    await expect(tx.withAtomic<[string[], string[]]>(['a', 'b'], ([a, b]) => [[...(a ?? []), 'x'], [...(b ?? [])]]))
      .resolves.toEqual([['x'], []]);
  });
});
