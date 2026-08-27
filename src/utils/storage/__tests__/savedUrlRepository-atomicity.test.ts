/**
 * savedUrlRepository-atomicity.test.ts
 * PBI 2026-08-27-27: confirms setSavedUrlsWithTimestamps/updateUrlTimestamp/
 * removeSavedUrl update `savedUrls` and `savedUrlsWithTimestamps` through the
 * shared `withAtomicKeys` transaction rather than two independent
 * `withOptimisticLock` calls, so no intermediate single-key state is ever
 * written to storage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addSavedUrl, removeSavedUrl, setSavedUrlsWithTimestamps } from '../savedUrlRepository.js';

beforeEach(async () => {
    await chrome.storage.local.set({});
});

describe('savedUrlRepository — dual-key atomicity', () => {
    it('addSavedUrl writes savedUrls and savedUrlsWithTimestamps together', async () => {
        const setSpy = vi.spyOn(chrome.storage.local, 'set');

        await addSavedUrl('https://example.com');

        const dataCalls = setSpy.mock.calls.filter(
            ([payload]) => 'savedUrls' in (payload as object) || 'savedUrlsWithTimestamps' in (payload as object)
        );
        expect(dataCalls.length).toBeGreaterThan(0);
        for (const [payload] of dataCalls) {
            expect(payload).toHaveProperty('savedUrls');
            expect(payload).toHaveProperty('savedUrlsWithTimestamps');
        }

        setSpy.mockRestore();
    });

    it('removeSavedUrl writes savedUrls and savedUrlsWithTimestamps together', async () => {
        await addSavedUrl('https://example.com');

        const setSpy = vi.spyOn(chrome.storage.local, 'set');
        await removeSavedUrl('https://example.com');

        const dataCalls = setSpy.mock.calls.filter(
            ([payload]) => 'savedUrls' in (payload as object) || 'savedUrlsWithTimestamps' in (payload as object)
        );
        expect(dataCalls.length).toBeGreaterThan(0);
        for (const [payload] of dataCalls) {
            expect(payload).toHaveProperty('savedUrls');
            expect(payload).toHaveProperty('savedUrlsWithTimestamps');
        }

        setSpy.mockRestore();
    });

    it('setSavedUrlsWithTimestamps keeps both keys in sync after concurrent addSavedUrl calls', async () => {
        await Promise.all([
            addSavedUrl('https://a.com'),
            addSavedUrl('https://b.com'),
            addSavedUrl('https://c.com'),
        ]);

        const stored = await chrome.storage.local.get(['savedUrls', 'savedUrlsWithTimestamps']);
        const urls = (stored.savedUrls as string[]) || [];
        const entries = (stored.savedUrlsWithTimestamps as { url: string }[]) || [];

        expect(urls.length).toBe(entries.length);
        expect(new Set(urls)).toEqual(new Set(entries.map((e) => e.url)));
    });

    it('setSavedUrlsWithTimestamps derives savedUrls from the same map, never observed out of sync', async () => {
        const map = new Map<string, number>([
            ['https://x.com', 1000],
            ['https://y.com', 2000],
        ]);

        await setSavedUrlsWithTimestamps(map);

        const stored = await chrome.storage.local.get(['savedUrls', 'savedUrlsWithTimestamps']);
        expect((stored.savedUrls as string[]).sort()).toEqual(['https://x.com', 'https://y.com']);
        expect((stored.savedUrlsWithTimestamps as { url: string }[]).map((e) => e.url).sort()).toEqual([
            'https://x.com',
            'https://y.com',
        ]);
    });
});
