/**
 * urlStorage.test.ts
 * Unit tests for URL storage utilities
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
    getSavedUrls,
    getSavedUrlsWithTimestamps,
    getSavedUrlEntries,
    setSavedUrls,
    setSavedUrlsWithTimestamps,
    addSavedUrl,
    removeSavedUrl,
    isUrlSaved,
    getSavedUrlCount,
} from '../urlStorage.js';
import { MAX_URL_SET_SIZE, MAX_CONTENT_ENTRIES } from '../urlEntry.js';
import type { SavedUrlEntry } from '../urlEntry.js';

// Mock urlEntry constants to keep tests fast and deterministic
vi.mock('../urlEntry.js', async () => {
    const actual = await vi.importActual<typeof import('../urlEntry.js')>('../urlEntry.js');
    return {
        ...actual,
        MAX_URL_SET_SIZE: 5,
        MAX_CONTENT_ENTRIES: 3,
    };
});

describe('urlStorage', () => {
    beforeEach(async () => {
        await chrome.storage.local.clear();
    });

    // ------------------------------------------------------------------
    // getSavedUrls
    // ------------------------------------------------------------------
    describe('getSavedUrls', () => {
        it('returns empty Set when no savedUrls exist in storage', async () => {
            const result = await getSavedUrls();
            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(0);
        });

        it('returns Set of saved URLs from storage', async () => {
            await chrome.storage.local.set({ savedUrls: ['https://a.com', 'https://b.com'] });
            const result = await getSavedUrls();
            expect(result).toEqual(new Set(['https://a.com', 'https://b.com']));
        });

        it('ignores non-array values and returns empty Set', async () => {
            await chrome.storage.local.set({ savedUrls: null });
            const result = await getSavedUrls();
            expect(result.size).toBe(0);
        });
    });

    // ------------------------------------------------------------------
    // getSavedUrlsWithTimestamps
    // ------------------------------------------------------------------
    describe('getSavedUrlsWithTimestamps', () => {
        it('returns empty Map when storage is empty', async () => {
            const result = await getSavedUrlsWithTimestamps();
            expect(result).toBeInstanceOf(Map);
            expect(result.size).toBe(0);
        });

        it('returns Map of URL to timestamp from storage', async () => {
            const entries: SavedUrlEntry[] = [
                { url: 'https://a.com', timestamp: 1000 },
                { url: 'https://b.com', timestamp: 2000 },
            ];
            await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });
            const result = await getSavedUrlsWithTimestamps();
            expect(result.get('https://a.com')).toBe(1000);
            expect(result.get('https://b.com')).toBe(2000);
        });

        it('ignores non-array values and returns empty Map', async () => {
            await chrome.storage.local.set({ savedUrlsWithTimestamps: undefined });
            const result = await getSavedUrlsWithTimestamps();
            expect(result.size).toBe(0);
        });
    });

    // ------------------------------------------------------------------
    // getSavedUrlEntries
    // ------------------------------------------------------------------
    describe('getSavedUrlEntries', () => {
        it('returns empty array when storage is empty', async () => {
            const result = await getSavedUrlEntries();
            expect(result).toEqual([]);
        });

        it('returns entry array preserving all properties', async () => {
            const entries: SavedUrlEntry[] = [
                { url: 'https://a.com', timestamp: 1000, recordType: 'auto', tags: ['tag1'] },
            ];
            await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });
            const result = await getSavedUrlEntries();
            expect(result).toHaveLength(1);
            expect(result[0].url).toBe('https://a.com');
            expect(result[0].recordType).toBe('auto');
            expect(result[0].tags).toEqual(['tag1']);
        });
    });

    // ------------------------------------------------------------------
    // setSavedUrls
    // ------------------------------------------------------------------
    describe('setSavedUrls', () => {
        it('saves url set without timestamp update when urlToAdd is null', async () => {
            const urlSet = new Set(['https://x.com', 'https://y.com']);
            await setSavedUrls(urlSet);

            const stored = await chrome.storage.local.get('savedUrls');
            expect(stored.savedUrls).toEqual(['https://x.com', 'https://y.com']);

            const timestamps = await chrome.storage.local.get('savedUrlsWithTimestamps');
            expect(timestamps.savedUrlsWithTimestamps).toBeUndefined();
        });

        it('saves url set and updates timestamp when urlToAdd is provided', async () => {
            const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(5000);
            const urlSet = new Set(['https://x.com']);
            await setSavedUrls(urlSet, 'https://x.com');

            const stored = await chrome.storage.local.get('savedUrls');
            expect(stored.savedUrls).toContain('https://x.com');

            const timestamps = await chrome.storage.local.get('savedUrlsWithTimestamps');
            expect(timestamps.savedUrlsWithTimestamps).toHaveLength(1);
            expect(timestamps.savedUrlsWithTimestamps[0].url).toBe('https://x.com');
            expect(timestamps.savedUrlsWithTimestamps[0].timestamp).toBe(5000);

            nowSpy.mockRestore();
        });

        it('handles empty url set', async () => {
            await setSavedUrls(new Set());
            const stored = await chrome.storage.local.get('savedUrls');
            expect(stored.savedUrls).toEqual([]);
        });
    });

    // ------------------------------------------------------------------
    // setSavedUrlsWithTimestamps
    // ------------------------------------------------------------------
    describe('setSavedUrlsWithTimestamps', () => {
        it('saves entries from Map and syncs savedUrls', async () => {
            const urlMap = new Map([
                ['https://a.com', 1000],
                ['https://b.com', 2000],
            ]);
            await setSavedUrlsWithTimestamps(urlMap);

            const storedTs = await chrome.storage.local.get('savedUrlsWithTimestamps');
            expect(storedTs.savedUrlsWithTimestamps).toHaveLength(2);

            const storedUrls = await chrome.storage.local.get('savedUrls');
            expect(storedUrls.savedUrls).toContain('https://a.com');
            expect(storedUrls.savedUrls).toContain('https://b.com');
        });

        it('preserves existing entry properties when rebuilding entries', async () => {
            const existing: SavedUrlEntry[] = [
                {
                    url: 'https://a.com',
                    timestamp: 1000,
                    recordType: 'auto',
                    maskedCount: 5,
                    tags: ['tag1'],
                    content: 'content',
                    aiSummary: 'summary',
                    sentTokens: 100,
                    receivedTokens: 50,
                    originalTokens: 120,
                    cleansedTokens: 80,
                    originalBytes: 1000,
                    cleansedBytes: 800,
                    aiSummaryOriginalBytes: 500,
                    aiSummaryCleansedBytes: 400,
                    aiSummaryCleansedElements: 2,
                    aiSummaryCleansedReason: 'alt',
                    aiSummaryCleansedReasons: ['alt', 'nav'],
                    pageBytes: 2000,
                    candidateBytes: 1500,
                    aiProvider: 'openai',
                    aiModel: 'gpt-4',
                    aiDuration: 1000,
                    obsidianDuration: 500,
                },
            ];
            await chrome.storage.local.set({ savedUrlsWithTimestamps: existing });

            const urlMap = new Map([['https://a.com', 3000]]);
            await setSavedUrlsWithTimestamps(urlMap);

            const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
            const entry = stored.savedUrlsWithTimestamps[0] as SavedUrlEntry;
            expect(entry.timestamp).toBe(3000);
            expect(entry.recordType).toBe('auto');
            expect(entry.maskedCount).toBe(5);
            expect(entry.tags).toEqual(['tag1']);
            expect(entry.content).toBe('content');
            expect(entry.aiSummary).toBe('summary');
            expect(entry.sentTokens).toBe(100);
            expect(entry.receivedTokens).toBe(50);
            expect(entry.originalTokens).toBe(120);
            expect(entry.cleansedTokens).toBe(80);
            expect(entry.originalBytes).toBe(1000);
            expect(entry.cleansedBytes).toBe(800);
            expect(entry.aiSummaryOriginalBytes).toBe(500);
            expect(entry.aiSummaryCleansedBytes).toBe(400);
            expect(entry.aiSummaryCleansedElements).toBe(2);
            expect(entry.aiSummaryCleansedReason).toBe('alt');
            expect(entry.aiSummaryCleansedReasons).toEqual(['alt', 'nav']);
            expect(entry.pageBytes).toBe(2000);
            expect(entry.candidateBytes).toBe(1500);
            expect(entry.aiProvider).toBe('openai');
            expect(entry.aiModel).toBe('gpt-4');
            expect(entry.aiDuration).toBe(1000);
            expect(entry.obsidianDuration).toBe(500);
        });

        it('cleans content for entries beyond MAX_CONTENT_ENTRIES', async () => {
            const entries: SavedUrlEntry[] = [
                { url: 'https://old1.com', timestamp: 1000, content: 'content1' },
                { url: 'https://old2.com', timestamp: 2000, content: 'content2' },
                { url: 'https://old3.com', timestamp: 3000, content: 'content3' },
                { url: 'https://new1.com', timestamp: 4000, content: 'content4' },
            ];
            await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });

            const urlMap = new Map([
                ['https://old1.com', 1000],
                ['https://old2.com', 2000],
                ['https://old3.com', 3000],
                ['https://new1.com', 4000],
            ]);
            await setSavedUrlsWithTimestamps(urlMap);

            const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
            const result = stored.savedUrlsWithTimestamps as SavedUrlEntry[];
            const byUrl = new Map(result.map(e => [e.url, e]));

            // Newest 3 should keep content (MAX_CONTENT_ENTRIES = 3)
            expect(byUrl.get('https://new1.com')!.content).toBe('content4');
            expect(byUrl.get('https://old3.com')!.content).toBe('content3');
            expect(byUrl.get('https://old2.com')!.content).toBe('content2');
            // Oldest should have content deleted
            expect(byUrl.get('https://old1.com')!.content).toBeUndefined();
        });

        it('does not corrupt savedUrls when syncing identical URL sets', async () => {
            await chrome.storage.local.set({ savedUrls: ['https://a.com', 'https://b.com'] });

            const urlMap = new Map([
                ['https://a.com', 1000],
                ['https://b.com', 2000],
            ]);
            await setSavedUrlsWithTimestamps(urlMap);

            const stored = await chrome.storage.local.get('savedUrls');
            expect(stored.savedUrls).toContain('https://a.com');
            expect(stored.savedUrls).toContain('https://b.com');
        });

        it('updates savedUrls when set sizes match but contents differ (line 124 branch)', async () => {
            await chrome.storage.local.set({ savedUrls: ['https://a.com', 'https://b.com'] });
            await chrome.storage.local.set({ savedUrlsWithTimestamps: [
                { url: 'https://a.com', timestamp: 1000 },
                { url: 'https://b.com', timestamp: 2000 },
            ]});

            const urlMap = new Map([
                ['https://a.com', 1000],
                ['https://c.com', 3000],
            ]);
            await setSavedUrlsWithTimestamps(urlMap);

            const stored = await chrome.storage.local.get('savedUrls');
            expect(stored.savedUrls).toContain('https://a.com');
            expect(stored.savedUrls).toContain('https://c.com');
            expect(stored.savedUrls).not.toContain('https://b.com');
        });

        it('accepts urlToAdd parameter without error (unused in current implementation)', async () => {
            const urlMap = new Map([['https://a.com', 1000]]);
            await expect(setSavedUrlsWithTimestamps(urlMap, 'https://a.com')).resolves.toBeUndefined();
        });
    });

    // ------------------------------------------------------------------
    // addSavedUrl
    // ------------------------------------------------------------------
    describe('addSavedUrl', () => {
        it('adds new URL with current timestamp', async () => {
            const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(10000);
            await addSavedUrl('https://new.com');

            const saved = await getSavedUrls();
            expect(saved.has('https://new.com')).toBe(true);

            const entries = await getSavedUrlEntries();
            expect(entries).toHaveLength(1);
            expect(entries[0].url).toBe('https://new.com');
            expect(entries[0].timestamp).toBe(10000);

            nowSpy.mockRestore();
        });

        it('adds URL with recordType', async () => {
            const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(20000);
            await addSavedUrl('https://manual.com', 'manual');

            const entries = await getSavedUrlEntries();
            expect(entries[0].recordType).toBe('manual');
            nowSpy.mockRestore();
        });

        it('preserves all optional fields when updating timestamp via addSavedUrl', async () => {
            const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(60000);
            const existing: SavedUrlEntry[] = [
                {
                    url: 'https://full.com',
                    timestamp: 1000,
                    recordType: 'auto',
                    maskedCount: 3,
                    tags: ['tag1'],
                    content: 'content',
                    cleansedReason: 'hard',
                    aiSummary: 'summary',
                    sentTokens: 10,
                    receivedTokens: 20,
                    originalTokens: 30,
                    cleansedTokens: 25,
                    originalBytes: 100,
                    cleansedBytes: 80,
                    aiSummaryOriginalBytes: 50,
                    aiSummaryCleansedBytes: 40,
                    aiSummaryCleansedElements: 2,
                    aiSummaryCleansedReason: 'alt',
                    aiSummaryCleansedReasons: ['alt', 'nav'],
                    pageBytes: 200,
                    candidateBytes: 150,
                    aiProvider: 'gemini',
                    aiModel: 'flash',
                    aiDuration: 100,
                    obsidianDuration: 50,
                },
            ];
            await chrome.storage.local.set({ savedUrlsWithTimestamps: existing });
            await chrome.storage.local.set({ savedUrls: ['https://full.com'] });

            await addSavedUrl('https://full.com', 'manual');

            const entries = await getSavedUrlEntries();
            expect(entries).toHaveLength(1);
            const e = entries[0];
            expect(e.timestamp).toBe(60000);
            expect(e.recordType).toBe('manual');
            expect(e.maskedCount).toBe(3);
            expect(e.tags).toEqual(['tag1']);
            expect(e.content).toBe('content');
            expect(e.cleansedReason).toBe('hard');
            expect(e.aiSummary).toBe('summary');
            expect(e.sentTokens).toBe(10);
            expect(e.receivedTokens).toBe(20);
            expect(e.originalTokens).toBe(30);
            expect(e.cleansedTokens).toBe(25);
            expect(e.originalBytes).toBe(100);
            expect(e.cleansedBytes).toBe(80);
            expect(e.aiSummaryOriginalBytes).toBe(50);
            expect(e.aiSummaryCleansedBytes).toBe(40);
            expect(e.aiSummaryCleansedElements).toBe(2);
            expect(e.aiSummaryCleansedReason).toBe('alt');
            expect(e.aiSummaryCleansedReasons).toEqual(['alt', 'nav']);
            expect(e.pageBytes).toBe(200);
            expect(e.candidateBytes).toBe(150);
            expect(e.aiProvider).toBe('gemini');
            expect(e.aiModel).toBe('flash');
            expect(e.aiDuration).toBe(100);
            expect(e.obsidianDuration).toBe(50);

            nowSpy.mockRestore();
        });

        it('removes entries older than retention days', async () => {
            const now = 1000000000000;
            const eightDaysAgo = now - 8 * 24 * 60 * 60 * 1000;
            const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

            const existing: SavedUrlEntry[] = [
                { url: 'https://old.com', timestamp: eightDaysAgo },
                { url: 'https://recent.com', timestamp: now - 60 * 60 * 1000 },
            ];
            await chrome.storage.local.set({ savedUrlsWithTimestamps: existing });
            await chrome.storage.local.set({ savedUrls: ['https://old.com', 'https://recent.com'] });

            await addSavedUrl('https://trigger.com');

            const entries = await getSavedUrlEntries();
            const urls = entries.map(e => e.url);
            expect(urls).not.toContain('https://old.com');
            expect(urls).toContain('https://recent.com');
            expect(urls).toContain('https://trigger.com');

            nowSpy.mockRestore();
        });

        it('performs LRU eviction when exceeding MAX_URL_SET_SIZE', async () => {
            const now = 5000;
            const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

            const existing: SavedUrlEntry[] = [
                { url: 'https://1.com', timestamp: 1000 },
                { url: 'https://2.com', timestamp: 2000 },
                { url: 'https://3.com', timestamp: 3000 },
                { url: 'https://4.com', timestamp: 4000 },
            ];
            await chrome.storage.local.set({ savedUrlsWithTimestamps: existing });
            await chrome.storage.local.set({ savedUrls: ['https://1.com', 'https://2.com', 'https://3.com', 'https://4.com'] });

            // MAX_URL_SET_SIZE is mocked to 5, add 2 more -> should evict oldest
            await addSavedUrl('https://5.com');
            await addSavedUrl('https://6.com');

            const entries = await getSavedUrlEntries();
            const urls = entries.map(e => e.url);
            expect(urls).not.toContain('https://1.com'); // oldest evicted
            expect(urls).toContain('https://2.com');
            expect(urls).toContain('https://3.com');
            expect(urls).toContain('https://4.com');
            expect(urls).toContain('https://5.com');
            expect(urls).toContain('https://6.com');
            expect(entries).toHaveLength(5); // MAX_URL_SET_SIZE = 5

            nowSpy.mockRestore();
        });

        it('cleans content for entries beyond MAX_CONTENT_ENTRIES when adding URLs', async () => {
            const now = 10000;
            const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

            const existing: SavedUrlEntry[] = [
                { url: 'https://1.com', timestamp: 1000, content: 'c1' },
                { url: 'https://2.com', timestamp: 2000, content: 'c2' },
                { url: 'https://3.com', timestamp: 3000, content: 'c3' },
                { url: 'https://4.com', timestamp: 4000, content: 'c4' },
            ];
            await chrome.storage.local.set({ savedUrlsWithTimestamps: existing });
            await chrome.storage.local.set({ savedUrls: ['https://1.com', 'https://2.com', 'https://3.com', 'https://4.com'] });

            await addSavedUrl('https://5.com');

            const entries = await getSavedUrlEntries();
            const byUrl = new Map(entries.map(e => [e.url, e]));

            // MAX_CONTENT_ENTRIES = 3, only newest 3 by timestamp keep content
            // https://5.com has no content, so only https://4.com and https://3.com keep content
            expect(byUrl.get('https://5.com')!.content).toBeUndefined(); // new one has no content
            expect(byUrl.get('https://4.com')!.content).toBe('c4');
            expect(byUrl.get('https://3.com')!.content).toBe('c3');
            expect(byUrl.get('https://2.com')!.content).toBeUndefined();
            expect(byUrl.get('https://1.com')!.content).toBeUndefined();

            nowSpy.mockRestore();
        });
    });

    // ------------------------------------------------------------------
    // removeSavedUrl
    // ------------------------------------------------------------------
    describe('removeSavedUrl', () => {
        it('removes URL from savedUrls set', async () => {
            await chrome.storage.local.set({ savedUrls: ['https://a.com', 'https://b.com'] });
            await chrome.storage.local.set({ savedUrlsWithTimestamps: [
                { url: 'https://a.com', timestamp: 1000 },
                { url: 'https://b.com', timestamp: 2000 },
            ]});

            await removeSavedUrl('https://a.com');

            const saved = await getSavedUrls();
            expect(saved.has('https://a.com')).toBe(false);
            expect(saved.has('https://b.com')).toBe(true);
        });

        it('removes URL from savedUrlsWithTimestamps', async () => {
            await chrome.storage.local.set({ savedUrlsWithTimestamps: [
                { url: 'https://a.com', timestamp: 1000 },
                { url: 'https://b.com', timestamp: 2000 },
            ]});
            await chrome.storage.local.set({ savedUrls: ['https://a.com', 'https://b.com'] });

            await removeSavedUrl('https://a.com');

            const entries = await getSavedUrlEntries();
            expect(entries).toHaveLength(1);
            expect(entries[0].url).toBe('https://b.com');
        });

        it('handles removal of non-existent URL gracefully', async () => {
            await chrome.storage.local.set({ savedUrls: ['https://a.com'] });
            await chrome.storage.local.set({ savedUrlsWithTimestamps: [
                { url: 'https://a.com', timestamp: 1000 },
            ]});

            await expect(removeSavedUrl('https://missing.com')).resolves.toBeUndefined();

            const saved = await getSavedUrls();
            expect(saved.has('https://a.com')).toBe(true);
        });
    });

    // ------------------------------------------------------------------
    // isUrlSaved
    // ------------------------------------------------------------------
    describe('isUrlSaved', () => {
        it('returns true when URL exists in saved list', async () => {
            await chrome.storage.local.set({ savedUrls: ['https://exists.com'] });
            const result = await isUrlSaved('https://exists.com');
            expect(result).toBe(true);
        });

        it('returns false when URL does not exist', async () => {
            await chrome.storage.local.set({ savedUrls: ['https://a.com'] });
            const result = await isUrlSaved('https://missing.com');
            expect(result).toBe(false);
        });

        it('returns false when savedUrls is empty', async () => {
            const result = await isUrlSaved('https://any.com');
            expect(result).toBe(false);
        });
    });

    // ------------------------------------------------------------------
    // getSavedUrlCount
    // ------------------------------------------------------------------
    describe('getSavedUrlCount', () => {
        it('returns 0 when no URLs are saved', async () => {
            const count = await getSavedUrlCount();
            expect(count).toBe(0);
        });

        it('returns correct count of saved URLs', async () => {
            await chrome.storage.local.set({ savedUrls: ['https://a.com', 'https://b.com', 'https://c.com'] });
            const count = await getSavedUrlCount();
            expect(count).toBe(3);
        });
    });

    // ------------------------------------------------------------------
    // Integration / edge cases
    // ------------------------------------------------------------------
    describe('integration and edge cases', () => {
        it('handles rapid add and remove operations', async () => {
            await addSavedUrl('https://rapid1.com');
            await addSavedUrl('https://rapid2.com');
            await removeSavedUrl('https://rapid1.com');
            await addSavedUrl('https://rapid3.com');

            const saved = await getSavedUrls();
            expect(saved.has('https://rapid1.com')).toBe(false);
            expect(saved.has('https://rapid2.com')).toBe(true);
            expect(saved.has('https://rapid3.com')).toBe(true);
            expect(await getSavedUrlCount()).toBe(2);
        });

        it('handles empty string URL via addSavedUrl', async () => {
            const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000);
            await addSavedUrl('');

            const saved = await getSavedUrls();
            expect(saved.has('')).toBe(true);
            nowSpy.mockRestore();
        });

        it('handles undefined stored values in getSavedUrls', async () => {
            // Explicitly set savedUrls key to undefined to simulate absent data
            await chrome.storage.local.set({ savedUrls: undefined });
            const result = await getSavedUrls();
            expect(result.size).toBe(0);
        });
    });
});
