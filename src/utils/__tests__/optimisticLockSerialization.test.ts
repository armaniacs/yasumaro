/**
 * optimisticLockSerialization.test.ts
 * Verifies the verify->write region of the CAS helpers is serialized per
 * storage key via a microtask-based primitive (no timer dependency), so
 * concurrent same-key CAS cannot lose a write (VULN-012 TOCTOU residual).
 */

import { withOptimisticLock, withAtomicKeys } from '../optimisticLock.js';
import { runSerialized, _resetKeySerializerForTest } from '../keySerializer.js';
import { ChromeStorageLogAdapter } from '../logger/storageAdapter.js';

describe('keySerializer primitive', () => {
  beforeEach(() => {
    _resetKeySerializerForTest();
  });

  it('serializes sections that share a key', async () => {
    const order: string[] = [];
    const a = runSerialized('k', async () => {
      order.push('a-start');
      await Promise.resolve();
      await Promise.resolve();
      order.push('a-end');
    });
    const b = runSerialized('k', async () => {
      order.push('b-start');
      order.push('b-end');
    });
    await Promise.all([a, b]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('does not serialize sections with different keys', async () => {
    const order: string[] = [];
    const a = runSerialized('k1', async () => {
      order.push('a-start');
      await Promise.resolve();
      await Promise.resolve();
      order.push('a-end');
    });
    const b = runSerialized('k2', async () => {
      order.push('b-start');
      order.push('b-end');
    });
    await Promise.all([a, b]);
    // b must have interleaved before a finished
    expect(order.indexOf('b-end')).toBeLessThan(order.indexOf('a-end'));
  });

  it('resolves under fake timers without advancing them', async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const p = runSerialized('k', async () => {
        await Promise.resolve();
        done = true;
      });
      await p;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('one failed section does not break the next', async () => {
    const a = runSerialized('k', async () => {
      throw new Error('boom');
    });
    await expect(a).rejects.toThrow('boom');
    const b = await runSerialized('k', async () => 42);
    expect(b).toBe(42);
  });
});

describe('withOptimisticLock same-key serialization (TOCTOU)', () => {
  beforeEach(async () => {
    _resetKeySerializerForTest();
    await chrome.storage.local.clear();
  });

  it('both concurrent writers survive on the same key', async () => {
    await chrome.storage.local.set({ list: [] as number[], list_version: 0 });

    const w1 = withOptimisticLock<number[]>('list', (cur) => [...(cur ?? []), 1]);
    const w2 = withOptimisticLock<number[]>('list', (cur) => [...(cur ?? []), 2]);

    await Promise.all([w1, w2]);

    const stored = await chrome.storage.local.get('list');
    expect([...stored.list].sort()).toEqual([1, 2]);
  });

  it('completes under fake timers', async () => {
    vi.useFakeTimers();
    try {
      await chrome.storage.local.set({ fk: [] as number[], fk_version: 0 });
      const p = withOptimisticLock<number[]>('fk', (cur) => [...(cur ?? []), 9]);
      await p;
      const stored = await chrome.storage.local.get('fk');
      expect(stored.fk).toEqual([9]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('withAtomicKeys multi-key serialization', () => {
  beforeEach(async () => {
    _resetKeySerializerForTest();
    await chrome.storage.local.clear();
  });

  it('does not deadlock with overlapping key sets in opposite order', async () => {
    await chrome.storage.local.set({
      a: [] as number[], a_version: 0,
      b: [] as number[], b_version: 0,
    });

    const t1 = withAtomicKeys<[number[], number[]]>(['a', 'b'], ([a, b]) => [
      [...(a ?? []), 1],
      [...(b ?? []), 1],
    ]);
    const t2 = withAtomicKeys<[number[], number[]]>(['b', 'a'], ([b, a]) => [
      [...(b ?? []), 2],
      [...(a ?? []), 2],
    ]);

    await Promise.all([t1, t2]);

    const stored = await chrome.storage.local.get(['a', 'b']);
    expect([...stored.a].sort()).toEqual([1, 2]);
    expect([...stored.b].sort()).toEqual([1, 2]);
  });
});

describe('deterministic interleave: gated set()', () => {
  beforeEach(async () => {
    _resetKeySerializerForTest();
    await chrome.storage.local.clear();
  });

  it('withOptimisticLock: gated first writer, second runs get->merge first, both survive', async () => {
    await chrome.storage.local.set({ g: [] as string[], g_version: 0 });

    const realSet = chrome.storage.local.set;
    let releaseFirstSet: (() => void) | null = null;
    let gateArmed = true;

    chrome.storage.local.set = (async (items: Record<string, unknown>) => {
      if (gateArmed && 'g' in items) {
        gateArmed = false;
        await new Promise<void>((resolve) => {
          releaseFirstSet = resolve;
        });
      }
      return realSet(items);
    }) as typeof chrome.storage.local.set;

    try {
      const w1 = withOptimisticLock<string[]>('g', (cur) => [...(cur ?? []), 'A']);
      // let w1 reach its gated set()
      await new Promise((r) => setTimeout(r, 0));

      const w2 = withOptimisticLock<string[]>('g', (cur) => [...(cur ?? []), 'B']);
      await new Promise((r) => setTimeout(r, 0));

      // release the parked first set
      (releaseFirstSet as unknown as () => void)();

      await Promise.all([w1, w2]);
      const stored = await chrome.storage.local.get('g');
      expect([...stored.g].sort()).toEqual(['A', 'B']);
    } finally {
      chrome.storage.local.set = realSet;
    }
  });

  it('ChromeStorageLogAdapter: concurrent append keeps every entry', async () => {
    const adapter = new ChromeStorageLogAdapter();
    const mk = (id: string) => ({ timestamp: Date.now(), id }) as unknown as Parameters<typeof adapter.append>[0][number];

    await Promise.all([
      adapter.append([mk('1'), mk('2')]),
      adapter.append([mk('3'), mk('4')]),
      adapter.append([mk('5')]),
    ]);

    const logs = await adapter.load();
    expect(logs).toHaveLength(5);
  });
});
