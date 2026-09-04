/**
 * storageTransaction-contract.test.ts
 * Contract suite: same assertions run on ChromeStoragePort and InMemoryStoragePort.
 * Ensures InMemory fidelity for version handling, CAS, post-write verification,
 * canonical equality, and fake-timer safety.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChromeStoragePort, InMemoryStoragePort, type StoragePort } from '../storagePort.js';
import { StorageTransaction, ConflictError, __resetStorageTransactionForTest } from '../storageTransaction.js';

type PortFactory = () => StoragePort;

const factories: Array<{ name: string; create: PortFactory }> = [
  {
    name: 'ChromeStoragePort',
    create: () => new ChromeStoragePort(),
  },
  {
    name: 'InMemoryStoragePort',
    create: () => new InMemoryStoragePort(),
  },
];

function runContractSuite(factory: PortFactory) {
  let port: StoragePort;
  let tx: StorageTransaction;

  beforeEach(async () => {
    __resetStorageTransactionForTest();
    port = factory();
    tx = new StorageTransaction(port);
    // clear underlying storage
    if (port instanceof InMemoryStoragePort) {
      port.clear();
    } else {
      await chrome.storage.local.clear();
    }
  });

  it('single-key CAS: concurrent writers both survive', async () => {
    await port.set({ list: [] as number[], list_version: 0 });
    const w1 = tx.withLock<number[]>('list', (cur) => [...(cur ?? []), 1]);
    const w2 = tx.withLock<number[]>('list', (cur) => [...(cur ?? []), 2]);
    await Promise.all([w1, w2]);
    const stored = await port.get(['list']);
    expect([...(stored['list'] as number[])].sort()).toEqual([1, 2]);
  });

  it('single-key: version increments on each write', async () => {
    await tx.withLock<number[]>('k', () => [1]);
    let v = await port.get(['k_version']);
    expect(v['k_version']).toBe(1);
    await tx.withLock<number[]>('k', (cur) => [...(cur as number[]), 2]);
    v = await port.get(['k_version']);
    expect(v['k_version']).toBe(2);
  });

  it('single-key: post-write verification always enabled (detects injected tamper)', async () => {
    await port.set({ tamper: 'a', tamper_version: 0 });
    const realSet = port.set.bind(port);
    let first = true;
    port.set = async (items) => {
      await realSet(items);
      if (first && 'tamper' in items) {
        first = false;
        await realSet({ tamper: 'injected', tamper_version: 999 });
      }
    };
    // with maxRetries 0, the injected tamper must cause immediate ConflictError
    await expect(tx.withLock<string>('tamper', () => 'new', { maxRetries: 0 })).rejects.toThrow(ConflictError);
    port.set = realSet;
  });

  it('multi-key atomic: both keys updated together, no partial write', async () => {
    await port.set({ a: [] as number[], a_version: 0, b: [] as number[], b_version: 0 });
    await tx.withAtomic<[number[], number[]]>(['a', 'b'], ([a, b]) => [
      [...(a ?? []), 1],
      [...(b ?? []), 1],
    ]);
    const stored = await port.get(['a', 'b', 'a_version', 'b_version']);
    expect(stored['a']).toEqual([1]);
    expect(stored['b']).toEqual([1]);
    expect(stored['a_version']).toBe(1);
    expect(stored['b_version']).toBe(1);
  });

  it('multi-key: does not deadlock with overlapping key sets in opposite order', async () => {
    await port.set({ x: [] as number[], x_version: 0, y: [] as number[], y_version: 0 });
    const t1 = tx.withAtomic<[number[], number[]]>(['x', 'y'], ([x, y]) => [
      [...(x ?? []), 1],
      [...(y ?? []), 1],
    ]);
    const t2 = tx.withAtomic<[number[], number[]]>(['y', 'x'], ([y, x]) => [
      [...(y ?? []), 2],
      [...(x ?? []), 2],
    ]);
    await Promise.all([t1, t2]);
    const stored = await port.get(['x', 'y']);
    expect([...(stored['x'] as number[])].sort()).toEqual([1, 2]);
    expect([...(stored['y'] as number[])].sort()).toEqual([1, 2]);
  });

  it('canonical equality: key-order insensitive deepEqual does not cause false conflict', async () => {
    const obj = { b: 2, a: 1 } as unknown as Record<string, unknown>;
    await port.set({ obj, obj_version: 0 });
    // updater returns same logical object but different key order
    const result = await tx.withLock<Record<string, unknown>>('obj', () => ({ a: 1, b: 2 }));
    expect(result).toEqual({ a: 1, b: 2 });
    const stored = await port.get(['obj']);
    expect(stored['obj']).toEqual({ a: 1, b: 2 });
  });

  it('resolves under fake timers without advancing', async () => {
    vi.useFakeTimers();
    try {
      const p = tx.withLock<number[]>('fk', (cur) => [...(cur ?? []), 9]);
      await p;
      const stored = await port.get(['fk']);
      expect(stored['fk']).toEqual([9]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('generic key version handling: non-settings keys also versioned', async () => {
    // savedUrls is versioned generically, not only settings family
    await tx.withLock<string[]>('savedUrls', () => ['a']);
    let v = await port.get(['savedUrls_version']);
    expect(v['savedUrls_version']).toBe(1);
    await tx.withLock<string[]>('savedUrls', (cur) => [...(cur as string[]), 'b']);
    v = await port.get(['savedUrls_version']);
    expect(v['savedUrls_version']).toBe(2);
  });

  it('version handling: explicit _version is respected', async () => {
    await port.set({ k: 'v1', k_version: 5 });
    const v = await port.get(['k_version']);
    expect(v['k_version']).toBe(5);
  });
}

for (const { name, create } of factories) {
  describe(`StorageTransaction contract — ${name}`, () => {
    runContractSuite(create);
  });
}
