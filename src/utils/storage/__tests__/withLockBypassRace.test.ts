/**
 * withLockBypassRace.test.ts
 *
 * Contract (ADR 2026-09-26-withlock-object-conflict-policy, R2): every writer
 * of an object lock key must go through `withLock`, because `<key>_version` is
 * the only durable conflict signal and a direct `chrome.storage.local.set`
 * that does not bump it is invisible to `performCasUpdate`.
 *
 * The suites below reproduce, against the real `withLock` and the real
 * `chrome.storage.local` port, the race a bypassing writer creates: the
 * bypassing writer's stale read clobbers a commit that already happened.
 * The interleave is decided by a gated `set` rather than a timer, so the
 * ordering is the test's, not wall clock's.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { addPendingPage, migrateLegacyPendingPagesKey, type PendingPage } from '../../pendingStorage.js';
import { purgeLegacyStorage, saveSavedUrlEntryMetadata } from '../savedUrlRepository.js';
import { InMemoryStoragePort, type StoragePort } from '../storagePort.js';
import { StorageTransaction, __resetStorageTransactionForTest } from '../storageTransaction.js';
import type { SavedUrlEntry } from '../../urlEntry.js';

const PAGES_KEY = 'pending_pages';
const ENTRIES_KEY = 'savedUrlsWithTimestamps';

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  settled: boolean;
}

function deferred(): Deferred {
  let resolveFn!: () => void;
  const promise = new Promise<void>((r) => { resolveFn = r; });
  return {
    promise,
    settled: false,
    resolve() {
      if (this.settled) return;
      this.settled = true;
      resolveFn();
    },
  };
}

/** True when a `chrome.storage.local.get` argument list asks for `key`. */
function requestsKey(keys: string | string[] | null | undefined, key: string): boolean {
  if (keys === null || keys === undefined) return true;
  return Array.isArray(keys) ? keys.includes(key) : keys === key;
}

const realLocal = {
  get: chrome.storage.local.get.bind(chrome.storage.local),
  set: chrome.storage.local.set.bind(chrome.storage.local),
};

beforeEach(() => {
  __resetStorageTransactionForTest();
  chrome.storage.local.get = realLocal.get;
  chrome.storage.local.set = realLocal.set;
});

/**
 * Hold every write to `key` until `releaseAll()` is called, and announce the
 * first held write through `heldWrite`. Writes arriving after the release pass
 * straight through: a lock-respecting writer retries and re-commits, so its
 * later write must not be gated again.
 */
function gateWritesTo(key: string): { releaseAll: Deferred; heldWrite: Deferred } {
  const releaseAll = deferred();
  const heldWrite = deferred();
  chrome.storage.local.set = (async (items: Record<string, unknown>) => {
    if (key in items) {
      heldWrite.resolve();
      if (!releaseAll.settled) await releaseAll.promise;
    }
    return realLocal.set(items);
  }) as typeof chrome.storage.local.set;
  return { releaseAll, heldWrite };
}

/** Fire `signal` the first time a `get` asks for `key` after `arm()` is called. */
function observeReadOf(key: string, signal: Deferred): { arm: () => void } {
  let armed = false;
  chrome.storage.local.get = (async (keys?: string | string[] | null) => {
    const result = await realLocal.get(keys as string | string[] | null);
    if (armed && !signal.settled && requestsKey(keys, key)) signal.resolve();
    return result;
  }) as typeof chrome.storage.local.get;
  return { arm: () => { armed = true; } };
}

function pendingPage(url: string, now: number): PendingPage {
  return { url, title: url, timestamp: now, reason: 'cache-control', expiry: now + 86_400_000 };
}

describe('R2 contract: the pending_pages legacy migration participates in the lock', () => {
  it('keeps a page added concurrently with the migration', async () => {
    const now = Date.now();
    const legacyPage = pendingPage('https://legacy.example.com', now);
    const addedPage = pendingPage('https://added.example.com', now);
    await chrome.storage.local.set({ osh_pending_pages: [legacyPage], [PAGES_KEY]: [], [`${PAGES_KEY}_version`]: 0 });

    // addPendingPage parks inside its own CAS write. It read version 0, so a
    // writer that bypasses the lock can land in between and be overwritten;
    // a writer that goes through withLock makes the verify read see version 1
    // and forces a retry that re-merges the legacy page on top.
    const gate = gateWritesTo(PAGES_KEY);
    const addPromise = addPendingPage(addedPage);
    await gate.heldWrite.promise;

    // Release the parked writer only after the migration has read the current
    // value, so the migration necessarily commits after it.
    const migrationRead = deferred();
    const observer = observeReadOf(PAGES_KEY, migrationRead);
    observer.arm();
    const migrationPromise = migrateLegacyPendingPagesKey();
    await migrationRead.promise;
    gate.releaseAll.resolve();
    await Promise.all([addPromise, migrationPromise]);

    const urls = ((await chrome.storage.local.get(PAGES_KEY))[PAGES_KEY] as PendingPage[]).map((p) => p.url);
    expect(urls).toContain('https://added.example.com');
    expect(urls).toContain('https://legacy.example.com');
    // The legacy key is still dropped once the merge is committed.
    expect((await chrome.storage.local.get('osh_pending_pages')).osh_pending_pages).toBeUndefined();
  });

  it('commits the merge through withLock so the version advances', async () => {
    const now = Date.now();
    await chrome.storage.local.set({ osh_pending_pages: [pendingPage('https://legacy.example.com', now)] });

    await migrateLegacyPendingPagesKey();

    const stored = await chrome.storage.local.get([PAGES_KEY, `${PAGES_KEY}_version`]);
    expect((stored[PAGES_KEY] as PendingPage[]).map((p) => p.url)).toEqual(['https://legacy.example.com']);
    expect(stored[`${PAGES_KEY}_version`]).toBe(1);
  });

  it('does not rewrite the key when the legacy key holds no data', async () => {
    await chrome.storage.local.set({ osh_pending_pages: [] });

    await migrateLegacyPendingPagesKey();

    // Nothing to merge: withLock is not entered, so no version is spent.
    const stored = await chrome.storage.local.get([PAGES_KEY, `${PAGES_KEY}_version`]);
    expect(stored[`${PAGES_KEY}_version`]).toBeUndefined();
    expect((await chrome.storage.local.get('osh_pending_pages')).osh_pending_pages).toBeUndefined();
  });
});

describe('R2 contract: the savedUrlsWithTimestamps quota cleanup participates in the lock', () => {
  it('does not drop entries that a CAS writer committed while the cleanup ran', async () => {
    const seed: SavedUrlEntry[] = [{
      url: 'https://kept.example.com', timestamp: 1000, content: 'kept content', aiSummary: 'kept summary',
    }];
    await chrome.storage.local.set({ [ENTRIES_KEY]: seed, [`${ENTRIES_KEY}_version`]: 0 });

    const gate = gateWritesTo(ENTRIES_KEY);
    const savePromise = saveSavedUrlEntryMetadata('https://concurrent.example.com', { recordType: 'auto' });
    await gate.heldWrite.promise;

    const cleanupRead = deferred();
    const observer = observeReadOf(ENTRIES_KEY, cleanupRead);
    observer.arm();
    const cleanupPromise = purgeLegacyStorage();
    await cleanupRead.promise;
    gate.releaseAll.resolve();
    await Promise.all([savePromise, cleanupPromise]);

    const urls = ((await chrome.storage.local.get(ENTRIES_KEY))[ENTRIES_KEY] as SavedUrlEntry[]).map((e) => e.url);
    // Cleanup must not delete the entry a concurrent CAS writer added...
    expect(urls).toContain('https://concurrent.example.com');
    // ...nor the one it had read before that write landed.
    expect(urls).toContain('https://kept.example.com');
  });

  it('commits the cleanup through withLock so the version advances', async () => {
    const seed: SavedUrlEntry[] = [{ url: 'https://kept.example.com', timestamp: 1000, content: 'kept' }];
    await chrome.storage.local.set({ [ENTRIES_KEY]: seed, [`${ENTRIES_KEY}_version`]: 0 });

    await purgeLegacyStorage();

    const stored = await chrome.storage.local.get(`${ENTRIES_KEY}_version`);
    expect(stored[`${ENTRIES_KEY}_version`]).toBe(1);
  });

  it('does not rewrite the key when there is nothing to clean up', async () => {
    await chrome.storage.local.set({ [ENTRIES_KEY]: [], [`${ENTRIES_KEY}_version`]: 7 });

    await purgeLegacyStorage();

    // The legacy shape only wrote when the list was non-empty; keep that.
    const stored = await chrome.storage.local.get(`${ENTRIES_KEY}_version`);
    expect(stored[`${ENTRIES_KEY}_version`]).toBe(7);
  });

  it('keeps the 500 newest entries and strips the same metadata fields as before', async () => {
    const entries: SavedUrlEntry[] = Array.from({ length: 600 }, (_, i) => ({
      url: `https://site${i}.com`,
      timestamp: 10_000 - i,
      content: `content-${i}`,
      aiSummary: `summary-${i}`,
      tags: [`t${i}`],
      recordType: 'auto' as const,
    }));
    await chrome.storage.local.set({ [ENTRIES_KEY]: entries, [`${ENTRIES_KEY}_version`]: 0 });

    await purgeLegacyStorage();

    const stored = (await chrome.storage.local.get(ENTRIES_KEY))[ENTRIES_KEY] as SavedUrlEntry[];
    expect(stored).toHaveLength(500);
    // Newest first, and the oldest entry is the one dropped.
    expect(stored[0]!.url).toBe('https://site0.com');
    expect(stored[499]!.url).toBe('https://site499.com');
    expect(stored.map((e) => e.url)).not.toContain('https://site599.com');
    // Strip set is unchanged: content and aiSummary go, the rest survives.
    expect(stored[0]!.content).toBeUndefined();
    expect(stored[0]!.aiSummary).toBeUndefined();
    expect(stored[0]!.tags).toEqual(['t0']);
    expect(stored[0]!.recordType).toBe('auto');
  });
});

describe('R2 rationale: a version-non-bumping write is invisible to the CAS', () => {
  it('loses a direct set that lands in the outer-read / verify-read window, without raising ConflictError', async () => {
    // The competitor writes between withLock's outer read (read 1) and
    // performCasUpdate's verify read (read 2) without touching the version.
    // The version check passes, the object value is skipped, so the CAS write
    // overwrites the competitor and no ConflictError is raised. This is why R2
    // removes bypassing writers instead of adding value-level CAS: once a
    // writer skips the version there is no durable evidence left at the lock
    // layer to detect the race from.
    const inner = new InMemoryStoragePort();
    let getCount = 0;
    const competitorPort: StoragePort = {
      get: async (keys) => {
        getCount += 1;
        if (getCount === 2) await inner.set({ list: ['competitor'] });
        return inner.get(keys);
      },
      set: (items) => inner.set(items),
      remove: (keys) => inner.remove!(keys),
    };
    const tx = new StorageTransaction(competitorPort);

    await tx.withLock<string[]>('list', (cur) => [...(cur ?? []), 'ours']);

    const stored = await inner.get(['list', 'list_version']);
    expect(stored['list']).toEqual(['ours']);
    expect(stored['list_version']).toBe(1);
  });
});

describe('R1 contract: object conflict detection stays version-only', () => {
  it('writes an object key whose stored value structuredClone cannot handle', async () => {
    // R1 keeps the pre-write check on the version alone and skips objects, so
    // a value `structuredClone` rejects must never be canonicalized on the
    // write path. The updater drops the unclonable field, which is exactly
    // what a value-level CAS would break on: it would canonicalize the
    // stored/verify value and throw DataCloneError before the write.
    const port = new InMemoryStoragePort();
    const tx = new StorageTransaction(port);
    await port.set({ config: { handler: (): void => undefined, retries: 1 }, config_version: 0 });

    await tx.withLock<Record<string, unknown>>('config', () => ({ retries: 2 }));

    const stored = await port.get(['config', 'config_version']);
    expect(stored['config']).toEqual({ retries: 2 });
    expect(stored['config_version']).toBe(1);
  });

  it('still raises ConflictError when only the version moved', async () => {
    const port = new InMemoryStoragePort();
    const tx = new StorageTransaction(port);
    await port.set({ config: { a: 1 }, config_version: 0 });

    let verifications = 0;
    const realGet = port.get.bind(port);
    port.get = async (keys) => {
      const result = await realGet(keys);
      verifications += 1;
      // Bump the version at the verify read so the CAS sees a real conflict.
      if (verifications === 2) await port.set({ config: { a: 1, other: true }, config_version: 1 });
      return realGet(keys);
    };

    await tx.withLock<Record<string, unknown>>('config', (cur) => ({ ...(cur as object), a: 2 }));

    const stored = await port.get(['config', 'config_version']);
    // The retry re-read the competing write and merged on top of it.
    expect(stored['config']).toEqual({ a: 2, other: true });
    expect(stored['config_version']).toBe(2);
  });
});
