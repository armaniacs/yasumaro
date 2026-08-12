import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../quota.js', () => ({
    STORAGE_QUOTA_BYTES: 10 * 1024 * 1024,
    getStorageUsage: vi.fn(),
    estimateDataSize: vi.fn((data: unknown) => new Blob([JSON.stringify(data || {})]).size),
    hasUnlimitedStorage: vi.fn(),
}));

vi.mock('../../optimisticLock.js', () => ({
    withOptimisticLock: vi.fn(async (key: string, fn: (data: unknown) => unknown) => {
        const result = await chrome.storage.local.get(key);
        const current = result[key];
        const updated = fn(current ?? []);
        await chrome.storage.local.set({ [key]: updated });
        return updated;
    }),
}));

import { setSavedUrls, saveSavedUrlEntryMetadata } from '../savedUrlStore.js';
import { withOptimisticLock } from '../../optimisticLock.js';
import { getStorageUsage, hasUnlimitedStorage } from '../quota.js';
import { STORAGE_QUOTA_BYTES } from '../quota.js';

describe('setSavedUrls', () => {
    beforeEach(async () => {
        const keys = Object.keys(await chrome.storage.local.get(null));
        if (keys.length > 0) {
            await chrome.storage.local.remove(keys);
        }
        vi.clearAllMocks();
    });

    it('skips quota check when unlimitedStorage permission is granted', async () => {
        (hasUnlimitedStorage as vi.Mock).mockResolvedValue(true);
        (getStorageUsage as vi.Mock).mockResolvedValue(STORAGE_QUOTA_BYTES + 1);

        const urlSet = new Set(['https://example.com']);
        await expect(setSavedUrls(urlSet)).resolves.toBeUndefined();

        expect(getStorageUsage).not.toHaveBeenCalled();
    });

    it('throws quota error when unlimitedStorage is not granted and usage exceeds quota', async () => {
        (hasUnlimitedStorage as vi.Mock).mockResolvedValue(false);
        (getStorageUsage as vi.Mock).mockResolvedValue(STORAGE_QUOTA_BYTES - 1);

        const largeUrlSet = new Set([`https://example.com/${'x'.repeat(1024 * 1024)}`]);
        await expect(setSavedUrls(largeUrlSet)).rejects.toThrow('Storage quota exceeded');
    });

    it('saves normally when unlimitedStorage is not granted but usage is under quota', async () => {
        (hasUnlimitedStorage as vi.Mock).mockResolvedValue(false);
        (getStorageUsage as vi.Mock).mockResolvedValue(0);

        const urlSet = new Set(['https://example.com']);
        await expect(setSavedUrls(urlSet)).resolves.toBeUndefined();

        const stored = await chrome.storage.local.get('savedUrls');
        expect(stored.savedUrls).toEqual(['https://example.com']);
    });
});

describe('saveSavedUrlEntryMetadata', () => {
    beforeEach(async () => {
        const keys = Object.keys(await chrome.storage.local.get(null));
        if (keys.length > 0) {
            await chrome.storage.local.remove(keys);
        }
        vi.clearAllMocks();
    });

    async function seedEntry(entry: { url: string; timestamp: number; tags?: string[] }) {
        await chrome.storage.local.set({ savedUrlsWithTimestamps: [entry] });
    }

    async function readEntry(url: string) {
        const stored = await chrome.storage.local.get('savedUrlsWithTimestamps');
        return (stored.savedUrlsWithTimestamps as Array<{ url: string; timestamp: number; [key: string]: unknown }>).find(
            (e) => e.url === url
        );
    }

    it('updates timestamp and metadata in a single CAS call', async () => {
        await seedEntry({ url: 'https://example.com', timestamp: 1000 });

        await saveSavedUrlEntryMetadata('https://example.com', { recordType: 'auto', aiSummary: 'summary' });

        expect(withOptimisticLock).toHaveBeenCalledTimes(1);
        expect(withOptimisticLock).toHaveBeenCalledWith('savedUrlsWithTimestamps', expect.any(Function));
        const entry = await readEntry('https://example.com');
        expect(entry?.recordType).toBe('auto');
        expect(entry?.aiSummary).toBe('summary');
        expect(entry?.timestamp).toBeGreaterThanOrEqual(1000);
        expect(entry?.timestamp).not.toBe(1000);
    });

    it('creates the entry when it does not exist yet', async () => {
        await saveSavedUrlEntryMetadata('https://new.com', { maskedCount: 2 });

        const entry = await readEntry('https://new.com');
        expect(entry?.url).toBe('https://new.com');
        expect(entry?.maskedCount).toBe(2);
        expect(entry?.timestamp).toBeGreaterThan(0);
    });

    it('does not overwrite existing fields for undefined patch values', async () => {
        await seedEntry({ url: 'https://example.com', timestamp: 1000 });
        await chrome.storage.local.set({
            savedUrlsWithTimestamps: [{ url: 'https://example.com', timestamp: 1000, aiSummary: 'keep' }],
        });

        await saveSavedUrlEntryMetadata('https://example.com', { aiSummary: undefined, recordType: 'auto' });

        const entry = await readEntry('https://example.com');
        expect(entry?.aiSummary).toBe('keep');
        expect(entry?.recordType).toBe('auto');
    });

    it('stores an explicit empty tag list as absent', async () => {
        await seedEntry({ url: 'https://example.com', timestamp: 1000, tags: ['old'] });

        await saveSavedUrlEntryMetadata('https://example.com', { tags: [] });

        const entry = await readEntry('https://example.com');
        expect(entry?.tags).toBeUndefined();
    });

    it('merges tags with dedupe when mergeTags is true', async () => {
        await seedEntry({ url: 'https://example.com', timestamp: 1000, tags: ['existing'] });

        await saveSavedUrlEntryMetadata('https://example.com', { tags: ['existing', 'new'] }, { mergeTags: true });

        const entry = await readEntry('https://example.com');
        expect(entry?.tags).toEqual(['existing', 'new']);
    });

    it('replaces tags when mergeTags is false (default)', async () => {
        await seedEntry({ url: 'https://example.com', timestamp: 1000, tags: ['old'] });

        await saveSavedUrlEntryMetadata('https://example.com', { tags: ['new'] });

        const entry = await readEntry('https://example.com');
        expect(entry?.tags).toEqual(['new']);
    });

    it('keeps the existing timestamp when refreshTimestamp is false', async () => {
        await seedEntry({ url: 'https://example.com', timestamp: 1234 });

        await saveSavedUrlEntryMetadata('https://example.com', { content: 'c' }, { refreshTimestamp: false });

        const entry = await readEntry('https://example.com');
        expect(entry?.timestamp).toBe(1234);
        expect(entry?.content).toBe('c');
    });
});
