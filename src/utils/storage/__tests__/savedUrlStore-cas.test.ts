/**
 * savedUrlStore-cas.test.ts
 * Atomic-CAS tests for saveSavedUrlEntryMetadata against the REAL optimistic
 * lock (unlike savedUrlStore.test.ts, which replaces withOptimisticLock with a
 * plain get→set mock). Uses the in-memory chrome.storage.local from the
 * vitest setup.
 *
 * Pinned contracts:
 *   - timestamp + metadata are committed in the same CAS cycle (no torn write),
 *   - a version conflict detected by the CAS verify forces a retry that
 *     re-reads the fresh state and re-merges the competing write instead of
 *     losing it,
 *   - sequential saves accumulate patches and bump the version per cycle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveSavedUrlEntryMetadata } from '../savedUrlStore.js';
import type { SavedUrlEntry } from '../../urlEntry.js';

const storageGetMock = chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>;
const storageSetMock = chrome.storage.local.set as unknown as ReturnType<typeof vi.fn>;
const originalGetImplementation = storageGetMock.getMockImplementation();
const originalSetImplementation = storageSetMock.getMockImplementation();

async function readEntries(): Promise<SavedUrlEntry[]> {
  const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
  return (stored.savedUrlsWithTimestamps as SavedUrlEntry[]) || [];
}

async function clearStorage(): Promise<void> {
  await chrome.storage.local.remove('savedUrlsWithTimestamps');
  await chrome.storage.local.remove('savedUrlsWithTimestamps_version');
}

beforeEach(async () => {
  await clearStorage();
});

afterEach(async () => {
  // Restore the real implementations if a test intercepted them.
  if (storageGetMock.getMockImplementation() !== originalGetImplementation) {
    storageGetMock.mockImplementation(originalGetImplementation);
  }
  if (storageSetMock.getMockImplementation() !== originalSetImplementation) {
    storageSetMock.mockImplementation(originalSetImplementation);
  }
  await clearStorage();
});

describe('saveSavedUrlEntryMetadata — atomic CAS behavior', () => {
  it('accumulates patches through the real optimistic lock and bumps the version per cycle', async () => {
    const url = 'https://sequential.com';

    await saveSavedUrlEntryMetadata(url, { recordType: 'auto' });
    await saveSavedUrlEntryMetadata(url, { aiSummary: 'summary' });

    const entries = await readEntries();
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.url).toBe(url);
    expect(entry.recordType).toBe('auto');
    expect(entry.aiSummary).toBe('summary');
    expect(entry.timestamp).toBeGreaterThan(0);

    const versioned = await chrome.storage.local.get('savedUrlsWithTimestamps_version');
    expect(versioned.savedUrlsWithTimestamps_version).toBe(2);
  });

  it('retries on a CAS version conflict and re-merges the competing write', async () => {
    const url = 'https://conflict.com';
    await chrome.storage.local.set({ savedUrlsWithTimestamps: [], savedUrlsWithTimestamps_version: 0 });

    // Intercept the CAS verify read (the second get inside withOptimisticLock).
    // A competing writer commits between the outer read and the verify: it
    // bumps the version and writes its own field. The verify then sees
    // version 1 !== expected 0, which throws a ConflictError and forces a
    // retry on the fresh state.
    const realGet = originalGetImplementation!;
    let getCall = 0;
    storageGetMock.mockImplementation(async (keys?: string | string[] | null) => {
      getCall += 1;
      if (getCall === 2) {
        await chrome.storage.local.set({
          savedUrlsWithTimestamps: [{ url, timestamp: 111, maskedCount: 9 }],
          savedUrlsWithTimestamps_version: 1,
        });
      }
      return realGet.call(chrome.storage.local, keys);
    });

    await saveSavedUrlEntryMetadata(url, { recordType: 'auto' });

    const entries = await readEntries();
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    // Our patch…
    expect(entry.recordType).toBe('auto');
    // …and the competing write both survive the retry.
    expect(entry.maskedCount).toBe(9);
    expect(entry.url).toBe(url);
    // Timestamp was refreshed in the same retry cycle (torn writes would leave
    // either the metadata or the timestamp stale).
    expect(entry.timestamp).toBeGreaterThanOrEqual(111);
    expect(entry.timestamp).not.toBe(111);
  });
});
