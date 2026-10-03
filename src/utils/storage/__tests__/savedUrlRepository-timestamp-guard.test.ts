/**
 * savedUrlRepository-timestamp-guard.test.ts
 * Regression tests for the missing-timestamp guards in savedUrlRepository.ts
 * (PBI: savedUrlRepository の timestamp ソートに欠損ガードを入れる).
 *
 * Hand-made / migrated data can carry entries without a timestamp. Before the
 * guard, the sort comparators returned NaN and Array.prototype.sort accepted
 * them silently, leaving the content-deletion set unspecified. The guards
 * normalize missing timestamps to 0 (same defense as purgeLegacyStorage),
 * so the deletion set and retention verdicts are deterministic.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    getSavedUrlsWithTimestamps,
    setSavedUrlsWithTimestamps,
    addSavedUrl,
} from '../savedUrlRepository.js';
import { URL_RETENTION_DAYS } from '../../urlEntry.js';
import type { SavedUrlEntry } from '../../urlEntry.js';

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => {
    const stored = await chrome.storage.local.get(null);
    const keys = Object.keys(stored);
    if (keys.length > 0) {
        await chrome.storage.local.remove(keys);
    }
});

describe('savedUrlRepository timestamp guard', () => {
    describe('capContentEntries (via setSavedUrlsWithTimestamps)', () => {
        it('treats a missing timestamp as the oldest entry so content deletion is deterministic', async () => {
            const now = Date.now();
            const valid: SavedUrlEntry[] = Array.from({ length: 11 }, (_, i) => ({
                url: `https://valid-${i}.com`,
                timestamp: now - i * 1000,
                content: `content-${i}`,
            }));
            const missing = { url: 'https://missing.com', content: 'content-missing' } as SavedUrlEntry;
            await chrome.storage.local.set({ savedUrlsWithTimestamps: [missing, ...valid] });

            // Caller built its own Map from raw hand-made data: the missing
            // entry carries an explicit undefined timestamp.
            const urlMap = new Map<string, number>();
            urlMap.set(missing.url, undefined as unknown as number);
            for (const e of valid) urlMap.set(e.url, e.timestamp);

            await setSavedUrlsWithTimestamps(urlMap);

            const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
            const entries = stored.savedUrlsWithTimestamps as SavedUrlEntry[];
            const byUrl = new Map(entries.map(e => [e.url, e]));

            expect(byUrl.get(missing.url)?.content).toBeUndefined();
            expect(byUrl.get('https://valid-10.com')?.content).toBeUndefined();
            for (let i = 0; i < 10; i++) {
                expect(byUrl.get(`https://valid-${i}.com`)?.content).toBe(`content-${i}`);
            }
            const withContent = entries.filter(e => e.content !== undefined);
            expect(withContent.length).toBe(10);
        });

        it('keeps the cap and order behavior for well-formed entries (parity)', async () => {
            const now = Date.now();
            const valid: SavedUrlEntry[] = Array.from({ length: 15 }, (_, i) => ({
                url: `https://site-${i}.com`,
                timestamp: now - i * 1000,
                content: `content-${i}`,
            }));
            await chrome.storage.local.set({ savedUrlsWithTimestamps: valid });

            const urlMap = new Map<string, number>();
            for (const e of valid) urlMap.set(e.url, e.timestamp);

            await setSavedUrlsWithTimestamps(urlMap);

            const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
            const entries = stored.savedUrlsWithTimestamps as SavedUrlEntry[];

            const expectedContentUrls = new Set(valid.slice(0, 10).map(e => e.url));
            for (const entry of entries) {
                if (expectedContentUrls.has(entry.url)) {
                    expect(entry.content).toBe(`content-${valid.findIndex(v => v.url === entry.url)}`);
                } else {
                    expect(entry.content).toBeUndefined();
                }
            }
            const withContent = entries.filter(e => e.content !== undefined);
            expect(withContent.length).toBe(10);
        });
    });

    describe('updateUrlTimestamp (via addSavedUrl)', () => {
        it('excludes a missing-timestamp entry by the same policy as a timestamp-0 entry', async () => {
            const now = Date.now();
            const fresh: SavedUrlEntry = { url: 'https://fresh.com', timestamp: now - 1000, content: 'c-fresh' };
            const expired: SavedUrlEntry = {
                url: 'https://expired.com',
                timestamp: now - (URL_RETENTION_DAYS + 1) * DAY_MS,
                content: 'c-expired',
            };
            const zeroTs: SavedUrlEntry = { url: 'https://zero.com', timestamp: 0, content: 'c-zero' };
            const missing = { url: 'https://missing.com', content: 'c-missing' } as SavedUrlEntry;
            await chrome.storage.local.set({
                savedUrlsWithTimestamps: [fresh, expired, zeroTs, missing],
                savedUrls: [fresh.url, expired.url, zeroTs.url, missing.url],
            });

            await addSavedUrl('https://added.com');

            const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
            const urls = (stored.savedUrlsWithTimestamps as SavedUrlEntry[]).map(e => e.url);

            expect(urls).toContain(fresh.url);
            expect(urls).toContain('https://added.com');
            expect(urls).not.toContain(expired.url);
            expect(urls).not.toContain(zeroTs.url);
            expect(urls).not.toContain(missing.url);
        });

        it('retains well-formed recent entries unchanged (parity)', async () => {
            const now = Date.now();
            const valid: SavedUrlEntry[] = Array.from({ length: 3 }, (_, i) => ({
                url: `https://keep-${i}.com`,
                timestamp: now - i * 1000,
                content: `c-${i}`,
                recordType: 'manual' as const,
            }));
            await chrome.storage.local.set({
                savedUrlsWithTimestamps: valid,
                savedUrls: valid.map(e => e.url),
            });

            await addSavedUrl('https://added.com');

            const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
            const entries = stored.savedUrlsWithTimestamps as SavedUrlEntry[];
            const byUrl = new Map(entries.map(e => [e.url, e]));

            for (const original of valid) {
                const kept = byUrl.get(original.url);
                expect(kept).toBeDefined();
                expect(kept?.timestamp).toBe(original.timestamp);
                expect(kept?.content).toBe(original.content);
                expect(kept?.recordType).toBe(original.recordType);
            }
            expect(byUrl.get('https://added.com')).toBeDefined();
            expect(entries.length).toBe(4);
        });
    });

    describe('getSavedUrlsWithTimestamps', () => {
        it('normalizes a missing timestamp to 0 instead of undefined', async () => {
            await chrome.storage.local.set({
                savedUrlsWithTimestamps: [
                    { url: 'https://a.com', timestamp: 5000 },
                    { url: 'https://b.com' },
                ] as SavedUrlEntry[],
            });

            const result = await getSavedUrlsWithTimestamps();

            expect(result.size).toBe(2);
            expect(result.get('https://a.com')).toBe(5000);
            expect(result.get('https://b.com')).toBe(0);
        });

        it('closes the undefined round-trip: a reader-normalized Map writes well-formed entries', async () => {
            await chrome.storage.local.set({
                savedUrlsWithTimestamps: [
                    { url: 'https://a.com', timestamp: 5000 },
                    { url: 'https://b.com' },
                ] as SavedUrlEntry[],
            });

            const urlMap = await getSavedUrlsWithTimestamps();
            await setSavedUrlsWithTimestamps(urlMap);

            const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
            const entries = stored.savedUrlsWithTimestamps as SavedUrlEntry[];
            const byUrl = new Map(entries.map(e => [e.url, e]));
            expect(byUrl.get('https://a.com')?.timestamp).toBe(5000);
            expect(byUrl.get('https://b.com')?.timestamp).toBe(0);
            for (const entry of entries) {
                expect(typeof entry.timestamp).toBe('number');
            }
        });
    });
});
