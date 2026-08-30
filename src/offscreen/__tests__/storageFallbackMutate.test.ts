// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FallbackStorage } from '../storageFallback.js';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';

/**
 * These tests prove that all fallback mutators share a single serialization
 * discipline (the `mutate` helper on `this.mutex`). Without it, a concurrent
 * `purgeOldRecords` and `toggleStar` do lock-free load -> mutate -> save and
 * one clobbers the other (VULN-022 / CWE-362).
 *
 * The interleave is made deterministic by stalling the FIRST few reads of the
 * records blob and returning a deep clone (real chrome.storage hands each
 * caller its own copy, unlike the shared-reference in-memory mock). When the
 * mutators are NOT serialized both read the same pre-mutation snapshot during
 * the stall and the later save wins, dropping the other mutation. When they
 * ARE serialized the second mutator only reads after the first has fully saved.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'FALLBACK_STORAGE_DATA';

function record(overrides: Partial<BrowsingLogRecord>): BrowsingLogRecord {
  return {
    url: 'https://example.com/',
    created_at: Date.now(),
    is_starred: 0,
    is_deleted: 0,
    ...overrides,
  } as BrowsingLogRecord;
}

/**
 * Stall the first `times` reads of the records blob by a few ms so two
 * overlapping mutators have a window to interleave. Uses the real (unspied)
 * mock implementation captured before installing the wrapper.
 */
function stallRecordReads(times: number): () => void {
  const original = chrome.storage.local.get as unknown as (
    keys?: string | string[] | null,
  ) => Promise<Record<string, unknown>>;
  let remaining = times;
  chrome.storage.local.get = (async (keys?: string | string[] | null) => {
    const result = await original(keys);
    if (remaining > 0 && keys === STORAGE_KEY) {
      remaining--;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    // Real chrome.storage returns a fresh copy per read; the in-memory mock
    // shares a reference, which would hide the RMW race.
    return structuredClone(result);
  }) as typeof chrome.storage.local.get;
  return () => {
    chrome.storage.local.get = original as typeof chrome.storage.local.get;
  };
}

describe('FallbackStorage.mutate serialization', () => {
  let storage: FallbackStorage;

  beforeEach(() => {
    vi.restoreAllMocks();
    storage = new FallbackStorage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves purge when toggleStar runs concurrently', async () => {
    const old = Date.now() - 200 * DAY_MS;
    await storage.insertBatch([
      record({ url: 'https://a/', created_at: old }),
      record({ url: 'https://b/', created_at: Date.now() }),
    ]);

    const restore = stallRecordReads(2);
    try {
      await Promise.all([storage.purgeOldRecords(90), storage.toggleStar(2)]);
    } finally {
      restore();
    }

    const all = await storage.getAllRecords();
    // purge must have removed the stale record #1 ...
    expect(all.map(r => r.url)).toEqual(['https://b/']);
    // ... and the star toggle on #2 must also be persisted.
    expect(all[0]!.is_starred).toBe(1);
  });

  it('preserves both update and hardDelete when they overlap', async () => {
    await storage.insertBatch([
      record({ url: 'https://keep/', created_at: 1000 }),
      record({ url: 'https://drop/', created_at: 2000 }),
    ]);

    const restore = stallRecordReads(2);
    try {
      await Promise.all([
        storage.update(1, { title: 'updated' }),
        storage.hardDelete(2),
      ]);
    } finally {
      restore();
    }

    const all = await storage.getAllRecords();
    expect(all.map(r => r.url)).toEqual(['https://keep/']);
    expect(all[0]!.title).toBe('updated');
  });

  describe('boundaries', () => {
    it('empty store: purge and clearAll are no-ops without throwing', async () => {
      await expect(storage.purgeOldRecords(1)).resolves.toEqual({ success: true, purged: 0 });
      await expect(storage.clearAll()).resolves.toEqual({ success: true });
      expect(await storage.getAllRecords()).toEqual([]);
    });

    it('single record: toggleStar then hardDelete leaves an empty store', async () => {
      await storage.insert(record({ url: 'https://only/', created_at: 1 }));
      await storage.toggleStar(1);
      await storage.hardDelete(1);
      expect(await storage.getAllRecords()).toEqual([]);
    });

    it('batch boundary: dedupe-check then id allocation ordering is preserved', async () => {
      const r1 = await storage.insert(record({ url: 'https://x/', created_at: 1 }));
      expect(r1).toEqual({ success: true, id: 1 });
      const batch = await storage.insertBatch([
        record({ url: 'https://x/', created_at: 1 }),
        record({ url: 'https://y/', created_at: 2 }),
      ]);
      expect(batch).toEqual({ success: true, count: 1 });
      const all = await storage.getAllRecords();
      expect(all.find(r => r.url === 'https://y/')!.id).toBe(2);
    });
  });

  describe('exception handling', () => {
    it('releases the lock and leaves data unchanged when saveData fails', async () => {
      await storage.insert(record({ url: 'https://safe/', created_at: 1 }));
      const before = await storage.getAllRecords();

      vi.spyOn(chrome.storage.local, 'set').mockRejectedValueOnce(new Error('disk full'));
      const res = await storage.toggleStar(1);
      expect(res.success).toBe(false);

      const after = await storage.getAllRecords();
      expect(after).toEqual(before);

      // lock released: a subsequent mutator still completes
      const ok = await storage.update(1, { title: 't' });
      expect(ok).toEqual({ success: true });
      expect((await storage.getAllRecords())[0]!.title).toBe('t');
    });

    it('propagates a pure-fn throw as a failed result with the lock released', async () => {
      await storage.insert(record({ url: 'https://z/', created_at: 1 }));
      // UPDATABLE_FIELDS iteration is safe; force a throw via a getter trap on changes
      const hostile = new Proxy(
        {},
        {
          has() {
            throw new Error('boom');
          },
        },
      ) as Partial<BrowsingLogRecord>;
      const res = await storage.update(1, hostile);
      expect(res).toEqual({ success: false, error: 'Error: boom' });

      const ok = await storage.hardDelete(1);
      expect(ok).toEqual({ success: true });
    });
  });
});
