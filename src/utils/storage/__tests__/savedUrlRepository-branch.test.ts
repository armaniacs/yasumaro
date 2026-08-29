/**
 * savedUrlRepository-branch.test.ts
 * Branch coverage tests for savedUrlRepository.ts functions that are not
 * exercised by existing tests (savedUrlRepository-atomicity and savedUrlStore).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    getSavedUrls,
    getSavedUrlsWithTimestamps,
    getSavedUrlEntries,
    isUrlSaved,
    getSavedUrlCount,
    setSavedUrls,
    setSavedUrlsWithTimestamps,
    addSavedUrl,
    removeSavedUrl,
    mergeSavedUrlEntry,
    updateSavedUrlEntry,
    saveSavedUrlEntryMetadata,
    setUrlTags,
    addUrlTag,
    removeUrlTag,
    purgeLegacyStorage,
} from '../savedUrlRepository.js';
import { URL_RETENTION_DAYS, MAX_URL_SET_SIZE } from '../../urlEntry.js';
import type { SavedUrlEntry } from '../../urlEntry.js';
import { hasUnlimitedStorage, getStorageUsage } from '../quota.js';

vi.mock('../quota.js', () => ({
    STORAGE_QUOTA_BYTES: 10 * 1024 * 1024,
    getStorageUsage: vi.fn(),
    estimateDataSize: vi.fn((data: unknown) => new Blob([JSON.stringify(data || {})]).size),
    hasUnlimitedStorage: vi.fn(),
}));

beforeEach(async () => {
    const stored = await chrome.storage.local.get(null);
    const keys = Object.keys(stored);
    if (keys.length > 0) {
        await chrome.storage.local.remove(keys);
    }
    vi.clearAllMocks();
});

describe('getSavedUrls', () => {
    it('returns empty Set when no savedUrls exist', async () => {
        const result = await getSavedUrls();
        expect(result).toBeInstanceOf(Set);
        expect(result.size).toBe(0);
    });

    it('returns Set from stored array', async () => {
        await chrome.storage.local.set({ savedUrls: ['https://a.com', 'https://b.com'] });
        const result = await getSavedUrls();
        expect(result).toEqual(new Set(['https://a.com', 'https://b.com']));
    });
});

describe('getSavedUrlsWithTimestamps', () => {
    it('returns empty Map when no entries exist', async () => {
        const result = await getSavedUrlsWithTimestamps();
        expect(result).toBeInstanceOf(Map);
        expect(result.size).toBe(0);
    });

    it('returns Map from stored entries', async () => {
        const entries: SavedUrlEntry[] = [
            { url: 'https://a.com', timestamp: 1000 },
            { url: 'https://b.com', timestamp: 2000 },
        ];
        await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });
        const result = await getSavedUrlsWithTimestamps();
        expect(result.get('https://a.com')).toBe(1000);
        expect(result.get('https://b.com')).toBe(2000);
    });
});

describe('getSavedUrlEntries', () => {
    it('returns empty array when no entries exist', async () => {
        const result = await getSavedUrlEntries();
        expect(result).toEqual([]);
    });

    it('returns stored entries', async () => {
        const entries: SavedUrlEntry[] = [{ url: 'https://a.com', timestamp: 1000, recordType: 'auto' }];
        await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });
        const result = await getSavedUrlEntries();
        expect(result).toEqual(entries);
    });
});

describe('isUrlSaved', () => {
    it('returns false when URL is not saved', async () => {
        await chrome.storage.local.set({ savedUrls: ['https://a.com'] });
        const result = await isUrlSaved('https://b.com');
        expect(result).toBe(false);
    });

    it('returns true when URL is saved', async () => {
        await chrome.storage.local.set({ savedUrls: ['https://a.com'] });
        const result = await isUrlSaved('https://a.com');
        expect(result).toBe(true);
    });
});

describe('getSavedUrlCount', () => {
    it('returns 0 when no URLs saved', async () => {
        const result = await getSavedUrlCount();
        expect(result).toBe(0);
    });

    it('returns correct count', async () => {
        await chrome.storage.local.set({ savedUrls: ['https://a.com', 'https://b.com'] });
        const result = await getSavedUrlCount();
        expect(result).toBe(2);
    });
});

describe('setSavedUrls', () => {
    it('skips quota check with unlimitedStorage', async () => {
        vi.mocked(hasUnlimitedStorage).mockResolvedValue(true);
        await setSavedUrls(new Set(['https://a.com']));
        expect(getStorageUsage).not.toHaveBeenCalled();
    });

    it('throws when quota exceeded without unlimitedStorage', async () => {
        vi.mocked(hasUnlimitedStorage).mockResolvedValue(false);
        vi.mocked(getStorageUsage).mockResolvedValue(10 * 1024 * 1024 - 1);
        const largeSet = new Set([`https://example.com/${'x'.repeat(1024 * 1024)}`]);
        await expect(setSavedUrls(largeSet)).rejects.toThrow('Storage quota exceeded');
    });

    it('saves with urlToAdd', async () => {
        vi.mocked(hasUnlimitedStorage).mockResolvedValue(true);
        await setSavedUrls(new Set(['https://a.com']), 'https://a.com');
        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        expect((stored.savedUrlsWithTimestamps as SavedUrlEntry[]).length).toBeGreaterThan(0);
    });

    it('saves without urlToAdd', async () => {
        vi.mocked(hasUnlimitedStorage).mockResolvedValue(true);
        await setSavedUrls(new Set(['https://a.com']), null);
        const stored = await chrome.storage.local.get('savedUrls');
        expect(stored.savedUrls).toEqual(['https://a.com']);
    });
});

describe('setSavedUrlsWithTimestamps', () => {
    it('preserves existing fields via spreadExistingFields', async () => {
        const existing: SavedUrlEntry[] = [
            { url: 'https://a.com', timestamp: 1000, aiSummary: 'summary', tags: ['tag1'] },
        ];
        await chrome.storage.local.set({ savedUrlsWithTimestamps: existing, savedUrls: ['https://a.com'] });

        const map = new Map([['https://a.com', 2000]]);
        await setSavedUrlsWithTimestamps(map);

        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        const entries = stored.savedUrlsWithTimestamps as SavedUrlEntry[];
        expect(entries[0]).toMatchObject({ url: 'https://a.com', aiSummary: 'summary', tags: ['tag1'] });
    });

    it('adds urlToAdd timestamp', async () => {
        const map = new Map([['https://a.com', 1000]]);
        await setSavedUrlsWithTimestamps(map, 'https://b.com');
        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        const entries = stored.savedUrlsWithTimestamps as SavedUrlEntry[];
        const b = entries.find(e => e.url === 'https://b.com');
        expect(b).toBeDefined();
        expect(b!.timestamp).toBeGreaterThan(0);
    });

    it('trims content beyond MAX_CONTENT_ENTRIES', async () => {
        const map = new Map<string, number>();
        for (let i = 0; i < 15; i++) {
            map.set(`https://site${i}.com`, 1000 + i);
        }
        // seed with content on all entries
        const existing = Array.from(map.keys()).map((url, i) => ({
            url, timestamp: 1000 + i, content: `content-${i}`,
        }));
        await chrome.storage.local.set({ savedUrlsWithTimestamps: existing, savedUrls: Array.from(map.keys()) });

        await setSavedUrlsWithTimestamps(map);

        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        const entries = stored.savedUrlsWithTimestamps as SavedUrlEntry[];
        const withContent = entries.filter(e => e.content !== undefined);
        expect(withContent.length).toBeLessThanOrEqual(10);
    });
});

describe('addSavedUrl', () => {
    it('adds a URL and creates entry', async () => {
        await addSavedUrl('https://new.com', 'manual');
        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        const entries = stored.savedUrlsWithTimestamps as SavedUrlEntry[];
        const entry = entries.find(e => e.url === 'https://new.com');
        expect(entry).toBeDefined();
        expect(entry!.recordType).toBe('manual');
    });
});

describe('removeSavedUrl', () => {
    it('removes existing URL atomically', async () => {
        const entries: SavedUrlEntry[] = [
            { url: 'https://a.com', timestamp: 1000 },
            { url: 'https://b.com', timestamp: 2000 },
        ];
        await chrome.storage.local.set({ savedUrlsWithTimestamps: entries, savedUrls: ['https://a.com', 'https://b.com'] });

        await removeSavedUrl('https://a.com');

        const stored = await chrome.storage.local.get(['savedUrls', 'savedUrlsWithTimestamps']);
        expect(stored.savedUrls).toEqual(['https://b.com']);
        expect((stored.savedUrlsWithTimestamps as SavedUrlEntry[]).length).toBe(1);
    });
});

describe('mergeSavedUrlEntry', () => {
    it('merges patch into current entry', () => {
        const current: SavedUrlEntry = { url: 'https://a.com', timestamp: 1000, aiSummary: 'old' };
        const result = mergeSavedUrlEntry(current, { aiSummary: 'new' });
        expect(result).toEqual({ url: 'https://a.com', timestamp: 1000, aiSummary: 'new' });
    });
});

describe('updateSavedUrlEntry', () => {
    it('returns unchanged when URL not found', async () => {
        await chrome.storage.local.set({ savedUrlsWithTimestamps: [] });
        await updateSavedUrlEntry('https://missing.com', (entry) => ({ ...entry, aiSummary: 'x' }));
        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        expect(stored.savedUrlsWithTimestamps).toEqual([]);
    });

    it('updates existing entry', async () => {
        const entries: SavedUrlEntry[] = [{ url: 'https://a.com', timestamp: 1000 }];
        await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });

        await updateSavedUrlEntry('https://a.com', (entry) => ({ ...entry, aiSummary: 'updated' }));

        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        const updated = (stored.savedUrlsWithTimestamps as SavedUrlEntry[])[0];
        expect(updated.aiSummary).toBe('updated');
    });
});

describe('saveSavedUrlEntryMetadata', () => {
    it('creates entry with createIfMissing=true (default)', async () => {
        await chrome.storage.local.set({ savedUrlsWithTimestamps: [] });
        await saveSavedUrlEntryMetadata('https://new.com', { aiSummary: 'summary' });
        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        const entries = stored.savedUrlsWithTimestamps as SavedUrlEntry[];
        expect(entries.length).toBe(1);
        expect(entries[0].aiSummary).toBe('summary');
    });

    it('skips creation with createIfMissing=false', async () => {
        await chrome.storage.local.set({ savedUrlsWithTimestamps: [] });
        await saveSavedUrlEntryMetadata('https://new.com', { aiSummary: 'summary' }, { createIfMissing: false });
        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        expect((stored.savedUrlsWithTimestamps as SavedUrlEntry[]).length).toBe(0);
    });

    it('does not refresh timestamp when refreshTimestamp=false', async () => {
        const entries: SavedUrlEntry[] = [{ url: 'https://a.com', timestamp: 1000 }];
        await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });
        await saveSavedUrlEntryMetadata('https://a.com', { aiSummary: 'sum' }, { refreshTimestamp: false });
        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        const updated = (stored.savedUrlsWithTimestamps as SavedUrlEntry[])[0];
        expect(updated.timestamp).toBe(1000);
    });

    it('uses provided timestamp', async () => {
        await chrome.storage.local.set({ savedUrlsWithTimestamps: [] });
        await saveSavedUrlEntryMetadata('https://new.com', { aiSummary: 'sum' }, { timestamp: 5555 });
        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        const entry = (stored.savedUrlsWithTimestamps as SavedUrlEntry[])[0];
        expect(entry.timestamp).toBe(5555);
    });

    it('merges tags with mergeTags=true', async () => {
        const entries: SavedUrlEntry[] = [{ url: 'https://a.com', timestamp: 1000, tags: ['a', 'b'] }];
        await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });
        await saveSavedUrlEntryMetadata('https://a.com', { tags: ['b', 'c'] }, { mergeTags: true });
        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        const updated = (stored.savedUrlsWithTimestamps as SavedUrlEntry[])[0];
        expect(updated.tags).toEqual(['a', 'b', 'c']);
    });

    it('clears empty tags with mergeTags=false', async () => {
        const entries: SavedUrlEntry[] = [{ url: 'https://a.com', timestamp: 1000, tags: ['a'] }];
        await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });
        await saveSavedUrlEntryMetadata('https://a.com', { tags: [] });
        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        const updated = (stored.savedUrlsWithTimestamps as SavedUrlEntry[])[0];
        expect(updated.tags).toBeUndefined();
    });
});

describe('tag operations', () => {
    it('setUrlTags clears tags when empty array', async () => {
        const entries: SavedUrlEntry[] = [{ url: 'https://a.com', timestamp: 1000, tags: ['a'] }];
        await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });
        await setUrlTags('https://a.com', []);
        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        const updated = (stored.savedUrlsWithTimestamps as SavedUrlEntry[])[0];
        expect(updated.tags).toBeUndefined();
    });

    it('addUrlTag appends new tag', async () => {
        const entries: SavedUrlEntry[] = [{ url: 'https://a.com', timestamp: 1000, tags: ['a'] }];
        await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });
        await addUrlTag('https://a.com', 'b');
        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        const updated = (stored.savedUrlsWithTimestamps as SavedUrlEntry[])[0];
        expect(updated.tags).toEqual(['a', 'b']);
    });

    it('addUrlTag ignores duplicate tag', async () => {
        const entries: SavedUrlEntry[] = [{ url: 'https://a.com', timestamp: 1000, tags: ['a'] }];
        await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });
        await addUrlTag('https://a.com', 'a');
        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        const updated = (stored.savedUrlsWithTimestamps as SavedUrlEntry[])[0];
        expect(updated.tags).toEqual(['a']);
    });

    it('removeUrlTag removes existing tag', async () => {
        const entries: SavedUrlEntry[] = [{ url: 'https://a.com', timestamp: 1000, tags: ['a', 'b'] }];
        await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });
        await removeUrlTag('https://a.com', 'a');
        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        const updated = (stored.savedUrlsWithTimestamps as SavedUrlEntry[])[0];
        expect(updated.tags).toEqual(['b']);
    });

    it('removeUrlTag clears tags when last removed', async () => {
        const entries: SavedUrlEntry[] = [{ url: 'https://a.com', timestamp: 1000, tags: ['a'] }];
        await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });
        await removeUrlTag('https://a.com', 'a');
        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        const updated = (stored.savedUrlsWithTimestamps as SavedUrlEntry[])[0];
        expect(updated.tags).toBeUndefined();
    });
});

describe('purgeLegacyStorage', () => {
    it('returns 0 when sqlite health check throws', async () => {
        const result = await purgeLegacyStorage(async () => { throw new Error('fail'); });
        expect(result).toBe(0);
    });

    it('returns 0 when sqlite is unhealthy', async () => {
        const result = await purgeLegacyStorage(async () => false);
        expect(result).toBe(0);
    });

    it('cleans up legacy keys and trims entries', async () => {
        const entries: SavedUrlEntry[] = Array.from({ length: 600 }, (_, i) => ({
            url: `https://site${i}.com`,
            timestamp: Date.now() - i * 1000,
            content: `content-${i}`,
            aiSummary: `summary-${i}`,
        }));
        await chrome.storage.local.set({ savedUrlsWithTimestamps: entries, savedUrls: entries.map(e => e.url) });

        const freed = await purgeLegacyStorage(async () => true);
        expect(freed).toBeGreaterThanOrEqual(0);

        const stored = await chrome.storage.local.get(['savedUrlsWithTimestamps', 'savedUrls']);
        expect((stored.savedUrlsWithTimestamps as SavedUrlEntry[]).length).toBeLessThanOrEqual(500);
        // savedUrls should be removed
        expect(stored.savedUrls).toBeUndefined();
    });

    it('returns 0 when no entries exist', async () => {
        await chrome.storage.local.set({ savedUrlsWithTimestamps: [] });
        const freed = await purgeLegacyStorage(async () => true);
        expect(freed).toBe(0);
    });
});

describe('updateUrlTimestamp branches (via addSavedUrl)', () => {
    it('prunes entries older than retention cutoff', async () => {
        const oldTimestamp = Date.now() - (URL_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000;
        const entries: SavedUrlEntry[] = [
            { url: 'https://old.com', timestamp: oldTimestamp },
            { url: 'https://new.com', timestamp: Date.now() },
        ];
        await chrome.storage.local.set({ savedUrlsWithTimestamps: entries, savedUrls: ['https://old.com', 'https://new.com'] });

        await addSavedUrl('https://another.com');

        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        const urls = (stored.savedUrlsWithTimestamps as SavedUrlEntry[]).map(e => e.url);
        expect(urls).not.toContain('https://old.com');
    });

    it('LRU evicts when exceeding MAX_URL_SET_SIZE', async () => {
        const entries: SavedUrlEntry[] = Array.from({ length: MAX_URL_SET_SIZE + 5 }, (_, i) => ({
            url: `https://site${i}.com`,
            timestamp: 1000 + i,
        }));
        await chrome.storage.local.set({ savedUrlsWithTimestamps: entries, savedUrls: entries.map(e => e.url) });

        await addSavedUrl('https://newest.com');

        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        const result = stored.savedUrlsWithTimestamps as SavedUrlEntry[];
        expect(result.length).toBeLessThanOrEqual(MAX_URL_SET_SIZE);
    });
});
