/**
 * storageTransaction-idempotency.test.ts
 * Pins the withLock updater contract: `updateFn` must be pure and idempotent
 * because a ConflictError retry re-invokes it with the latest value.
 *
 * The value-comparison logic is deliberately NOT deep-equal for objects
 * (version is the conflict signal) — these tests pin the documented contract
 * without touching that behavior.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStoragePort } from '../storagePort.js';
import { StorageTransaction, __resetStorageTransactionForTest } from '../storageTransaction.js';

describe('withLock — updateFn purity/idempotency contract', () => {
  let port: InMemoryStoragePort;
  let tx: StorageTransaction;

  beforeEach(() => {
    __resetStorageTransactionForTest();
    port = new InMemoryStoragePort();
    tx = new StorageTransaction(port);
  });

  /**
   * Force exactly one ConflictError retry: corrupt the stored value right
   * after the first write so the always-on post-write verification fails.
   * (Same tamper seam as the contract suite's post-write test.)
   */
  async function tamperAfterFirstWrite(key: string, tamperedValue: unknown, tamperedVersion: number): Promise<void> {
    const realSet = port.set.bind(port);
    let first = true;
    port.set = async (items) => {
      await realSet(items);
      if (first && key in items) {
        first = false;
        await realSet({ [key]: tamperedValue, [`${key}_version`]: tamperedVersion });
      }
    };
  }

  it('re-invokes a pure updater with the latest value after a conflict', async () => {
    await port.set({ list: [] as string[], list_version: 0 });
    await tamperAfterFirstWrite('list', ['tampered'], 999);

    let invocations = 0;
    const seen: unknown[] = [];
    const result = await tx.withLock<string[]>('list', (cur) => {
      invocations++;
      seen.push(cur);
      return [...(cur ?? []), 'x'];
    });

    // One initial attempt + one retry after the injected conflict.
    expect(invocations).toBe(2);
    // The retry re-read the tampered value and derived from it — the pure
    // updater stays safe because it is a function of its input alone.
    expect(seen[1]).toEqual(['tampered']);
    expect(result).toEqual(['tampered', 'x']);
    const stored = await port.get(['list']);
    expect(stored['list']).toEqual(['tampered', 'x']);
  });

  it('documents that an updater side effect runs twice on retry', async () => {
    await port.set({ list: [] as string[], list_version: 0 });
    await tamperAfterFirstWrite('list', ['tampered'], 999);

    // An updater with an escaping side effect (id minting, notification,
    // external counter) executes it once per attempt — the retry does not
    // know the first attempt already ran.
    const sideEffects: number[] = [];
    let nextId = 0;
    await tx.withLock<string[]>('list', (cur) => {
      sideEffects.push(++nextId);
      return [...(cur ?? []), 'x'];
    });

    expect(sideEffects).toEqual([1, 2]);
    // Only the retry's derivation survives; the first attempt's id is lost
    // — this is why updateFn MUST be pure (a pure function of its input)
    // and idempotent.
    const stored = await port.get(['list']);
    expect(stored['list']).toEqual(['tampered', 'x']);
  });
});
