/**
 * storageTransaction-cross-context.test.ts
 *
 * PBI 2026-10-18-18: the cross-context CAS verify->write window. Two extension
 * contexts (service worker / popup / dashboard) own separate module instances,
 * so the module-level per-key chain cannot serialize them and their CAS writes
 * interleave. The write-time fence (`port.compareAndSet`) rejects the writer
 * whose version moved between its verify read and its write, so the loser
 * surfaces as a ConflictError and the retry shell re-derives instead of
 * silently overwriting a committed update.
 *
 * The gates below decide every interleave with resolved promises (no timers),
 * per dev-docs/TEST_RULE.md. The same-realm serialization pins stay in
 * optimisticLockSerialization.test.ts, untouched; the version-non-bumping
 * bypass class stays in withLockBypassRace.test.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStoragePort, type StoragePort } from '../storagePort.js';
import {
  StorageTransaction,
  ConflictError,
  __performCasUpdateForTest,
  __resetStorageTransactionForTest,
} from '../storageTransaction.js';

const PAGES_KEY = 'pending_pages';

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolveFn!: () => void;
  const promise = new Promise<void>((resolve) => { resolveFn = resolve; });
  return { promise, resolve: resolveFn };
}

/** True when a `get` asks for exactly `versionKeys` (the write-time fence read). */
function isVersionOnlyRead(keys: string | string[] | null, versionKeys: string[]): boolean {
  return Array.isArray(keys) && keys.length === versionKeys.length
    && versionKeys.every((k) => keys.includes(k));
}

/** True when a `get` asks for the data key together with its version key (outer/verify/post-write). */
function isValueAndVersionRead(keys: string | string[] | null, dataKey: string): boolean {
  return Array.isArray(keys) && keys.length === 2
    && keys.includes(dataKey) && keys.includes(`${dataKey}_version`);
}

describe('StorageTransaction cross-context CAS fence (PBI 2026-10-18-18)', () => {
  beforeEach(() => {
    __resetStorageTransactionForTest();
  });

  describe('withLock: single-key write fence', () => {
    it('detects a cross-context commit landing in the verify->write window and converges on retry', async () => {
      const port = new InMemoryStoragePort();
      port.seed({ [PAGES_KEY]: ['a.com', 'b.com'], [`${PAGES_KEY}_version`]: 0 });
      const realGet = port.get.bind(port);
      const realSet = port.set.bind(port);

      // Context A (service worker) commits its pending_pages removal while
      // context B (popup) sits between its verify read and its write. The
      // fence read is the only get asking for the version key alone, so it is
      // the gate: context A lands right before the fence observes the version.
      let fenceReads = 0;
      port.get = async (keys) => {
        if (isVersionOnlyRead(keys, [`${PAGES_KEY}_version`]) && fenceReads === 0) {
          fenceReads += 1;
          await realSet({ [PAGES_KEY]: ['b.com'], [`${PAGES_KEY}_version`]: 1 });
        }
        return realGet(keys);
      };

      const retryMsgs: string[] = [];
      const result = await new StorageTransaction(port).withLock<string[]>(
        PAGES_KEY,
        (cur) => [...(cur ?? []), 'c.com'],
        { sleep: async () => {}, onRetryDiagnostic: (msg) => { retryMsgs.push(msg); } }
      );

      // The cross-context commit was detected as a conflict and retried once.
      expect(retryMsgs).toHaveLength(1);
      expect(retryMsgs[0]).toBe('withOptimisticLock retrying');
      // Convergence keeps BOTH updates: A's removal of a.com and B's addition
      // of c.com. Without the fence B's write silently erased A's commit.
      expect(result).toEqual(['b.com', 'c.com']);
      const stored = await realGet([PAGES_KEY, `${PAGES_KEY}_version`]);
      expect(stored[PAGES_KEY]).toEqual(['b.com', 'c.com']);
      expect(stored[`${PAGES_KEY}_version`]).toBe(2);
    });

    it('rejects writer B with ConflictError when A commits inside the two-CAS-writer interleave', async () => {
      const port = new InMemoryStoragePort();
      port.seed({ [PAGES_KEY]: ['a.com', 'b.com'], [`${PAGES_KEY}_version`]: 0 });
      const realGet = port.get.bind(port);
      const realSet = port.set.bind(port);

      const bVerified = deferred();  // writer B's verify read resolved (still version 0)
      const aCommitted = deferred(); // writer A's commit landed
      const aPostVerified = deferred(); // writer A's post-write verify read resolved

      let verifyReads = 0;
      let fenceReads = 0;
      let setCalls = 0;
      port.get = async (keys) => {
        if (isValueAndVersionRead(keys, PAGES_KEY)) {
          verifyReads += 1;
          const result = await realGet(keys);
          if (verifyReads === 2) bVerified.resolve(); // B observed version 0
          if (verifyReads === 3) aPostVerified.resolve(); // A's post-write verify
          return result;
        }
        if (isVersionOnlyRead(keys, [`${PAGES_KEY}_version`])) {
          fenceReads += 1;
          if (fenceReads === 1) await bVerified.promise; // A's fence read waits for B's verify read
          if (fenceReads === 2) await aCommitted.promise; // B's fence read waits for A's commit
        }
        return realGet(keys);
      };
      port.set = async (items) => {
        setCalls += 1;
        if (setCalls === 1) await bVerified.promise; // A's write parks in the verify->write window
        if (setCalls === 2) await aPostVerified.promise; // (legacy path) B writes after A fully committed
        await realSet(items);
        if (setCalls === 1) aCommitted.resolve();
      };

      // Two independent module instances share only the storage: the per-key
      // chain cannot serialize them, so the CAS steps run via the documented
      // test seam, bypassing runSerialized. Deterministic interleave: both
      // verify reads observe version 0, then A commits, then B writes.
      const writerA = __performCasUpdateForTest<string[]>(
        port, PAGES_KEY, ['a.com', 'b.com'], ['b.com'], 0, 1
      );
      const writerB = __performCasUpdateForTest<string[]>(
        port, PAGES_KEY, ['a.com', 'b.com'], ['a.com', 'b.com', 'c.com'], 0, 1
      );

      await writerA;
      await expect(writerB).rejects.toThrow(ConflictError);

      const stored = await realGet([PAGES_KEY, `${PAGES_KEY}_version`]);
      // A's committed update (a.com removed) survived: B was told about the
      // conflict instead of silently overwriting it.
      expect(stored[PAGES_KEY]).toEqual(['b.com']);
      expect(stored[`${PAGES_KEY}_version`]).toBe(1);
    });
  });

  describe('withAtomic: multi-key write fence', () => {
    it('rejects a cross-context commit that moves one version in the verify->write window', async () => {
      const port = new InMemoryStoragePort();
      port.seed({ a: ['x'], a_version: 0, b: ['y'], b_version: 0 });
      const realGet = port.get.bind(port);
      const realSet = port.set.bind(port);

      // The fence read is the only get asking for the version keys alone.
      let fenceReads = 0;
      port.get = async (keys) => {
        if (isVersionOnlyRead(keys, ['a_version', 'b_version']) && fenceReads === 0) {
          fenceReads += 1;
          // Another context commits while this writer sits between its verify
          // read and its write.
          await realSet({ a: ['x', 'other'], a_version: 1 });
        }
        return realGet(keys);
      };

      const retryMsgs: string[] = [];
      const result = await new StorageTransaction(port).withAtomic<[string[], string[]]>(
        ['a', 'b'],
        ([a, b]) => [[...(a ?? []), 'mine'], [...(b ?? []), 'mine']],
        { sleep: async () => {}, onRetryDiagnostic: (msg) => { retryMsgs.push(msg); } }
      );

      expect(retryMsgs).toHaveLength(1);
      expect(retryMsgs[0]).toBe('withAtomicKeys retrying');
      // The retry re-derived from the committed state, so the other context's
      // write and this one both survive.
      expect(result).toEqual([['x', 'other', 'mine'], ['y', 'mine']]);
      const stored = await realGet(['a', 'b', 'a_version', 'b_version']);
      expect(stored.a).toEqual(['x', 'other', 'mine']);
      expect(stored.b).toEqual(['y', 'mine']);
      expect(stored.a_version).toBe(2);
      expect(stored.b_version).toBe(2);
    });
  });

  describe('ports without the fence hook', () => {
    it('keeps the legacy write path so existing StoragePort implementations are unaffected', async () => {
      const inner = new InMemoryStoragePort();
      inner.seed({ [PAGES_KEY]: ['a.com'], [`${PAGES_KEY}_version`]: 0 });
      let setCalls = 0;
      const legacyPort: StoragePort = {
        get: (keys) => inner.get(keys),
        set: (items) => {
          setCalls += 1;
          return inner.set(items);
        },
      };

      const result = await new StorageTransaction(legacyPort).withLock<string[]>(
        PAGES_KEY,
        (cur) => [...(cur ?? []), 'b.com']
      );

      expect(result).toEqual(['a.com', 'b.com']);
      expect(setCalls).toBe(1);
      const stored = await inner.get([PAGES_KEY, `${PAGES_KEY}_version`]);
      expect(stored[PAGES_KEY]).toEqual(['a.com', 'b.com']);
      expect(stored[`${PAGES_KEY}_version`]).toBe(1);
    });
  });

  describe('same-realm regression guard (BDD scenario 2)', () => {
    it('two transaction instances in one module realm still serialize through the per-key chain', async () => {
      const port = new InMemoryStoragePort();
      port.seed({ [PAGES_KEY]: ['a.com', 'b.com'], [`${PAGES_KEY}_version`]: 0 });

      const txA = new StorageTransaction(port);
      const txB = new StorageTransaction(port);
      const wA = txA.withLock<string[]>(
        PAGES_KEY, (cur) => (cur ?? []).filter((u) => u !== 'a.com'), { sleep: async () => {} }
      );
      const wB = txB.withLock<string[]>(
        PAGES_KEY, (cur) => [...(cur ?? []), 'c.com'], { sleep: async () => {} }
      );
      await Promise.all([wA, wB]);

      const stored = await port.get([PAGES_KEY, `${PAGES_KEY}_version`]);
      // Both updates survive: the chain ordered the writes and the second
      // writer re-derived from the first writer's commit.
      expect(stored[PAGES_KEY]).toEqual(['b.com', 'c.com']);
      expect(stored[`${PAGES_KEY}_version`]).toBe(2);
    });
  });
});
