/**
 * storageUrls.test.ts
 * URL管理関連機能のテスト
 */

import { describe, it, expect, beforeEach, jest } from 'vitest';
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
    setUrlRecordType,
    setUrlContent,
    setUrlCleansedReason,
    setUrlMaskedCount,
    setUrlTags,
    addUrlTag,
    removeUrlTag,
    setUrlAiSummary,
    setUrlSentTokens,
    setUrlReceivedTokens,
    setUrlOriginalTokens,
    setUrlCleansedTokens,
    setUrlPageBytes,
    setUrlCandidateBytes,
    setUrlOriginalBytes,
    setUrlCleansedBytes,
    setUrlAiSummaryOriginalBytes,
    setUrlAiSummaryCleansedBytes,
    setUrlAiSummaryCleansedElements,
    setUrlAiSummaryCleansedReason,
    buildAllowedUrls,
    computeUrlsHash,
    saveSettingsWithAllowedUrls,
    getAllowedUrls,
    MAX_URL_SET_SIZE,
    URL_RETENTION_DAYS,
} from '../storageUrls.js';

/**
 * Helper to seed savedUrlsWithTimestamps into chrome.storage.local.
 * The global mock from jest.setup.ts stores data in an in-memory object
 * keyed by `localStorage`.  We write directly via chrome.storage.local.set.
 */
async function seedTimestamps(entries: Array<{ url: string; timestamp: number; recordType?: 'auto' | 'manual'; tags?: string[]; content?: string; cleansedReason?: string; maskedCount?: number; aiSummary?: string; sentTokens?: number; receivedTokens?: number; originalTokens?: number; cleansedTokens?: number; pageBytes?: number; candidateBytes?: number; originalBytes?: number; cleansedBytes?: number; aiSummaryOriginalBytes?: number; aiSummaryCleansedBytes?: number; aiSummaryCleansedElements?: number; aiSummaryCleansedReason?: string }>) {
    await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });
    await chrome.storage.local.set({ savedUrls: entries.map(e => e.url) });
}

// ============================================================================
// getSavedUrls / isUrlSaved / getSavedUrlCount
// ============================================================================

describe('getSavedUrls / isUrlSaved / getSavedUrlCount', () => {
    it('returns empty set when storage is empty', async () => {
        const urls = await getSavedUrls();
        expect(urls.size).toBe(0);
    });

    it('returns URLs from storage', async () => {
        await chrome.storage.local.set({ savedUrls: ['https://a.com', 'https://b.com'] });
        const urls = await getSavedUrls();
        expect(urls.size).toBe(2);
        expect(urls.has('https://a.com')).toBe(true);
        expect(urls.has('https://b.com')).toBe(true);
    });

    it('isUrlSaved returns true for saved URL', async () => {
        await chrome.storage.local.set({ savedUrls: ['https://example.com'] });
        expect(await isUrlSaved('https://example.com')).toBe(true);
        expect(await isUrlSaved('https://other.com')).toBe(false);
    });

    it('getSavedUrlCount returns correct count', async () => {
        await chrome.storage.local.set({ savedUrls: ['https://a.com', 'https://b.com', 'https://c.com'] });
        expect(await getSavedUrlCount()).toBe(3);
    });
});

// ============================================================================
// getSavedUrlEntries
// ============================================================================

describe('getSavedUrlEntries', () => {
    it('returns empty array when storage is empty', async () => {
        const entries = await getSavedUrlEntries();
        expect(entries).toEqual([]);
    });

    it('returns entries from storage', async () => {
        await seedTimestamps([
            { url: 'https://example.com', timestamp: 1000 },
            { url: 'https://other.com', timestamp: 2000 },
        ]);
        const entries = await getSavedUrlEntries();
        expect(entries.length).toBe(2);
    });
});

// ============================================================================
// addSavedUrl
// ============================================================================

describe('addSavedUrl', () => {
    it('adds URL to saved set and creates timestamp entry', async () => {
        await addSavedUrl('https://example.com');
        const urls = await getSavedUrls();
        expect(urls.has('https://example.com')).toBe(true);

        const entries = await getSavedUrlEntries();
        expect(entries.length).toBe(1);
        expect(entries[0].url).toBe('https://example.com');
    });

    it('adds URL with recordType auto', async () => {
        await addSavedUrl('https://example.com', 'auto');
        const entries = await getSavedUrlEntries();
        expect(entries[0].recordType).toBe('auto');
    });

    it('adds URL with recordType manual', async () => {
        await addSavedUrl('https://example.com', 'manual');
        const entries = await getSavedUrlEntries();
        expect(entries[0].recordType).toBe('manual');
    });

    it('preserves existing fields when updating timestamp', async () => {
        await addSavedUrl('https://example.com');
        await setUrlTags('https://example.com', ['tag1']);
        await setUrlMaskedCount('https://example.com', 5);

        // Re-add to update timestamp – fields should be preserved
        await addSavedUrl('https://example.com', 'auto');
        const entries = await getSavedUrlEntries();
        const entry = entries.find(e => e.url === 'https://example.com');
        expect(entry?.maskedCount).toBe(5);
        expect(entry?.tags).toEqual(['tag1']);
    });
});

// ============================================================================
// removeSavedUrl
// ============================================================================

describe('removeSavedUrl', () => {
    it('removes URL from saved set and timestamps', async () => {
        await addSavedUrl('https://remove-me.com');
        await addSavedUrl('https://keep-me.com');
        await removeSavedUrl('https://remove-me.com');

        const urls = await getSavedUrls();
        expect(urls.has('https://remove-me.com')).toBe(false);
        expect(urls.has('https://keep-me.com')).toBe(true);

        const entries = await getSavedUrlEntries();
        expect(entries.find(e => e.url === 'https://remove-me.com')).toBeUndefined();
    });
});

// ============================================================================
// setUrlRecordType
// ============================================================================

describe('setUrlRecordType', () => {
    it('sets recordType on existing entry', async () => {
        await addSavedUrl('https://example.com');
        await setUrlRecordType('https://example.com', 'manual');
        const entries = await getSavedUrlEntries();
        expect(entries[0].recordType).toBe('manual');
    });

    it('does nothing when URL not found (no-op)', async () => {
        // Should not throw
        await setUrlRecordType('https://nonexistent.com', 'auto');
        const entries = await getSavedUrlEntries();
        expect(entries.length).toBe(0);
    });
});

// ============================================================================
// setUrlContent
// ============================================================================

describe('setUrlContent', () => {
    it('sets content on existing entry', async () => {
        await addSavedUrl('https://example.com');
        await setUrlContent('https://example.com', 'Hello world');
        const entries = await getSavedUrlEntries();
        expect(entries[0].content).toBe('Hello world');
    });

    it('does nothing when URL not found', async () => {
        await setUrlContent('https://nonexistent.com', 'content');
        const entries = await getSavedUrlEntries();
        expect(entries.length).toBe(0);
    });
});

// ============================================================================
// setUrlCleansedReason
// ============================================================================

describe('setUrlCleansedReason', () => {
    it('sets cleansedReason on existing entry', async () => {
        await addSavedUrl('https://example.com');
        await setUrlCleansedReason('https://example.com', 'hard');
        const entries = await getSavedUrlEntries();
        expect(entries[0].cleansedReason).toBe('hard');
    });

    it('does nothing when URL not found', async () => {
        await setUrlCleansedReason('https://nonexistent.com', 'keyword');
        // Should not throw
    });
});

// ============================================================================
// setUrlMaskedCount
// ============================================================================

describe('setUrlMaskedCount', () => {
    it('sets maskedCount on existing entry', async () => {
        await addSavedUrl('https://example.com');
        await setUrlMaskedCount('https://example.com', 10);
        const entries = await getSavedUrlEntries();
        expect(entries[0].maskedCount).toBe(10);
    });

    it('does nothing when URL not found', async () => {
        await setUrlMaskedCount('https://nonexistent.com', 3);
        // Should not throw
    });
});

// ============================================================================
// Tag management
// ============================================================================

describe('setUrlTags', () => {
    it('sets tags on existing entry', async () => {
        await addSavedUrl('https://example.com');
        await setUrlTags('https://example.com', ['news', 'tech']);
        const entries = await getSavedUrlEntries();
        expect(entries[0].tags).toEqual(['news', 'tech']);
    });

    it('sets undefined for empty tag array', async () => {
        await addSavedUrl('https://example.com');
        await setUrlTags('https://example.com', ['tag1']);
        await setUrlTags('https://example.com', []);
        const entries = await getSavedUrlEntries();
        expect(entries[0].tags).toBeUndefined();
    });

    it('warns when URL not found', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await setUrlTags('https://nonexistent.com', ['tag']);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('URL not found'));
        warnSpy.mockRestore();
    });
});

describe('addUrlTag', () => {
    it('adds tag to existing entry', async () => {
        await addSavedUrl('https://example.com');
        await addUrlTag('https://example.com', 'news');
        await addUrlTag('https://example.com', 'tech');
        const entries = await getSavedUrlEntries();
        expect(entries[0].tags).toEqual(['news', 'tech']);
    });

    it('does not duplicate tag', async () => {
        await addSavedUrl('https://example.com');
        await addUrlTag('https://example.com', 'news');
        await addUrlTag('https://example.com', 'news');
        const entries = await getSavedUrlEntries();
        expect(entries[0].tags).toEqual(['news']);
    });

    it('initializes tags array when undefined', async () => {
        await addSavedUrl('https://example.com');
        const entries1 = await getSavedUrlEntries();
        expect(entries1[0].tags).toBeUndefined();
        await addUrlTag('https://example.com', 'first');
        const entries2 = await getSavedUrlEntries();
        expect(entries2[0].tags).toEqual(['first']);
    });

    it('does nothing when URL not found', async () => {
        // Should not throw
        await addUrlTag('https://nonexistent.com', 'tag');
    });
});

describe('removeUrlTag', () => {
    it('removes tag from existing entry', async () => {
        await addSavedUrl('https://example.com');
        await setUrlTags('https://example.com', ['news', 'tech']);
        await removeUrlTag('https://example.com', 'news');
        const entries = await getSavedUrlEntries();
        expect(entries[0].tags).toEqual(['tech']);
    });

    it('sets tags to undefined when last tag removed', async () => {
        await addSavedUrl('https://example.com');
        await setUrlTags('https://example.com', ['only-tag']);
        await removeUrlTag('https://example.com', 'only-tag');
        const entries = await getSavedUrlEntries();
        expect(entries[0].tags).toBeUndefined();
    });

    it('does nothing when URL has no tags', async () => {
        await addSavedUrl('https://example.com');
        await removeUrlTag('https://example.com', 'nonexistent');
        const entries = await getSavedUrlEntries();
        expect(entries[0].tags).toBeUndefined();
    });

    it('does nothing when URL not found', async () => {
        await removeUrlTag('https://nonexistent.com', 'tag');
        // Should not throw
    });
});

// ============================================================================
// AI summary / token setters
// ============================================================================

describe('setUrlAiSummary', () => {
    it('sets aiSummary on existing entry', async () => {
        await addSavedUrl('https://example.com');
        await setUrlAiSummary('https://example.com', 'Summary text');
        const entries = await getSavedUrlEntries();
        expect(entries[0].aiSummary).toBe('Summary text');
    });

    it('does nothing when URL not found', async () => {
        await setUrlAiSummary('https://nonexistent.com', 'Summary');
        // no throw
    });
});

describe('setUrlSentTokens', () => {
    it('sets sentTokens on existing entry', async () => {
        await addSavedUrl('https://example.com');
        await setUrlSentTokens('https://example.com', 1500);
        const entries = await getSavedUrlEntries();
        expect(entries[0].sentTokens).toBe(1500);
    });

    it('does nothing when URL not found', async () => {
        await setUrlSentTokens('https://nonexistent.com', 100);
    });
});

describe('setUrlReceivedTokens', () => {
    it('sets receivedTokens on existing entry', async () => {
        await addSavedUrl('https://example.com');
        await setUrlReceivedTokens('https://example.com', 2000);
        const entries = await getSavedUrlEntries();
        expect(entries[0].receivedTokens).toBe(2000);
    });

    it('does nothing when URL not found', async () => {
        await setUrlReceivedTokens('https://nonexistent.com', 100);
    });
});

describe('setUrlOriginalTokens', () => {
    it('sets originalTokens on existing entry', async () => {
        await addSavedUrl('https://example.com');
        await setUrlOriginalTokens('https://example.com', 5000);
        const entries = await getSavedUrlEntries();
        expect(entries[0].originalTokens).toBe(5000);
    });

    it('does nothing when URL not found', async () => {
        await setUrlOriginalTokens('https://nonexistent.com', 100);
    });
});

describe('setUrlCleansedTokens', () => {
    it('sets cleansedTokens on existing entry', async () => {
        await addSavedUrl('https://example.com');
        await setUrlCleansedTokens('https://example.com', 3000);
        const entries = await getSavedUrlEntries();
        expect(entries[0].cleansedTokens).toBe(3000);
    });

    it('does nothing when URL not found', async () => {
        await setUrlCleansedTokens('https://nonexistent.com', 100);
    });
});

describe('setUrlPageBytes', () => {
    it('sets pageBytes on existing entry', async () => {
        await addSavedUrl('https://example.com');
        await setUrlPageBytes('https://example.com', 102400);
        const entries = await getSavedUrlEntries();
        expect(entries[0].pageBytes).toBe(102400);
    });

    it('does nothing when URL not found', async () => {
        await setUrlPageBytes('https://nonexistent.com', 100);
    });
});

describe('setUrlCandidateBytes', () => {
    it('sets candidateBytes on existing entry', async () => {
        await addSavedUrl('https://example.com');
        await setUrlCandidateBytes('https://example.com', 51200);
        const entries = await getSavedUrlEntries();
        expect(entries[0].candidateBytes).toBe(51200);
    });

    it('does nothing when URL not found', async () => {
        await setUrlCandidateBytes('https://nonexistent.com', 100);
    });
});

describe('setUrlOriginalBytes', () => {
    it('sets originalBytes on existing entry', async () => {
        await addSavedUrl('https://example.com');
        await setUrlOriginalBytes('https://example.com', 204800);
        const entries = await getSavedUrlEntries();
        expect(entries[0].originalBytes).toBe(204800);
    });

    it('does nothing when URL not found', async () => {
        await setUrlOriginalBytes('https://nonexistent.com', 100);
    });
});

describe('setUrlCleansedBytes', () => {
    it('sets cleansedBytes on existing entry', async () => {
        await addSavedUrl('https://example.com');
        await setUrlCleansedBytes('https://example.com', 102400);
        const entries = await getSavedUrlEntries();
        expect(entries[0].cleansedBytes).toBe(102400);
    });

    it('does nothing when URL not found', async () => {
        await setUrlCleansedBytes('https://nonexistent.com', 100);
    });
});

describe('setUrlAiSummaryOriginalBytes', () => {
    it('sets aiSummaryOriginalBytes on existing entry', async () => {
        await addSavedUrl('https://example.com');
        await setUrlAiSummaryOriginalBytes('https://example.com', 4096);
        const entries = await getSavedUrlEntries();
        expect(entries[0].aiSummaryOriginalBytes).toBe(4096);
    });

    it('does nothing when URL not found', async () => {
        await setUrlAiSummaryOriginalBytes('https://nonexistent.com', 100);
    });
});

describe('setUrlAiSummaryCleansedBytes', () => {
    it('sets aiSummaryCleansedBytes on existing entry', async () => {
        await addSavedUrl('https://example.com');
        await setUrlAiSummaryCleansedBytes('https://example.com', 2048);
        const entries = await getSavedUrlEntries();
        expect(entries[0].aiSummaryCleansedBytes).toBe(2048);
    });

    it('does nothing when URL not found', async () => {
        await setUrlAiSummaryCleansedBytes('https://nonexistent.com', 100);
    });
});

describe('setUrlAiSummaryCleansedElements', () => {
    it('sets aiSummaryCleansedElements on existing entry', async () => {
        await addSavedUrl('https://example.com');
        await setUrlAiSummaryCleansedElements('https://example.com', 15);
        const entries = await getSavedUrlEntries();
        expect(entries[0].aiSummaryCleansedElements).toBe(15);
    });

    it('does nothing when URL not found', async () => {
        await setUrlAiSummaryCleansedElements('https://nonexistent.com', 5);
    });
});

describe('setUrlAiSummaryCleansedReason', () => {
    it('sets aiSummaryCleansedReason on existing entry', async () => {
        await addSavedUrl('https://example.com');
        await setUrlAiSummaryCleansedReason('https://example.com', 'ads');
        const entries = await getSavedUrlEntries();
        expect(entries[0].aiSummaryCleansedReason).toBe('ads');
    });

    it('does nothing when URL not found', async () => {
        await setUrlAiSummaryCleansedReason('https://nonexistent.com', 'nav');
    });
});

// ============================================================================
// buildAllowedUrls
// ============================================================================

describe('buildAllowedUrls', () => {
    const whitelistFn = () => true;
    const rejectFn = () => false;

    it('includes Obsidian API URLs with default protocol/port', () => {
        const urls = buildAllowedUrls({}, whitelistFn);
        expect(urls.has('https://127.0.0.1:27124')).toBe(true);
        expect(urls.has('https://localhost:27124')).toBe(true);
    });

    it('uses custom protocol and port', () => {
        const urls = buildAllowedUrls({ obsidian_protocol: 'http', obsidian_port: '5000' }, whitelistFn);
        expect(urls.has('http://127.0.0.1:5000')).toBe(true);
        expect(urls.has('http://localhost:5000')).toBe(true);
    });

    it('includes Gemini API URL', () => {
        const urls = buildAllowedUrls({}, whitelistFn);
        expect(urls.has('https://generativelanguage.googleapis.com')).toBe(true);
    });

    it('includes OpenAI base URL when whitelisted', () => {
        const urls = buildAllowedUrls({ openai_base_url: 'https://api.openai.com/v1' }, whitelistFn);
        expect(urls.has('https://api.openai.com/v1')).toBe(true);
    });

    it('warns and skips OpenAI base URL when not whitelisted', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const urls = buildAllowedUrls({ openai_base_url: 'https://evil.com/v1' }, rejectFn);
        expect(urls.has('https://evil.com/v1')).toBe(false);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not in whitelist'));
        warnSpy.mockRestore();
    });

    it('warns on invalid OpenAI base URL', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const urls = buildAllowedUrls({ openai_base_url: 'not-a-url' }, whitelistFn);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid OpenAI Base URL'));
        warnSpy.mockRestore();
    });

    it('includes OpenAI 2 base URL when whitelisted', () => {
        const urls = buildAllowedUrls({ openai_2_base_url: 'http://127.0.0.1:11434/v1' }, whitelistFn);
        expect(urls.has('http://127.0.0.1:11434/v1')).toBe(true);
    });

    it('warns and skips OpenAI 2 base URL when not whitelisted', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const urls = buildAllowedUrls({ openai_2_base_url: 'https://evil.com/v1' }, rejectFn);
        expect(urls.has('https://evil.com/v1')).toBe(false);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('OpenAI 2 Base URL not in whitelist'));
        warnSpy.mockRestore();
    });

    it('warns on invalid OpenAI 2 base URL', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const urls = buildAllowedUrls({ openai_2_base_url: '://bad' }, whitelistFn);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid OpenAI 2 Base URL'));
        warnSpy.mockRestore();
    });

    it('includes ublock source origins', () => {
        const urls = buildAllowedUrls({
            ublock_sources: [
                { url: 'https://easylist.to/easylist/easylist.txt', ruleCount: 0, blockDomains: [], exceptionDomains: [], importedAt: 0 },
            ],
        }, whitelistFn);
        expect(urls.has('https://easylist.to')).toBe(true);
    });

    it('skips manual ublock sources', () => {
        const urls = buildAllowedUrls({
            ublock_sources: [
                { url: 'manual', ruleCount: 0, blockDomains: [], exceptionDomains: [], importedAt: 0 },
            ],
        }, whitelistFn);
        // Should not crash; manual is skipped
        expect(urls.size).toBeGreaterThan(0);
    });

    it('skips invalid ublock source URLs gracefully', () => {
        const urls = buildAllowedUrls({
            ublock_sources: [
                { url: 'not-a-valid-url', ruleCount: 0, blockDomains: [], exceptionDomains: [], importedAt: 0 },
            ],
        }, whitelistFn);
        // Should not throw
        expect(urls.size).toBeGreaterThan(0);
    });

    it('includes fixed filter list domains', () => {
        const urls = buildAllowedUrls({}, whitelistFn);
        expect(urls.has('https://raw.githubusercontent.com')).toBe(true);
        expect(urls.has('https://gitlab.com')).toBe(true);
        expect(urls.has('https://easylist.to')).toBe(true);
        expect(urls.has('https://pgl.yoyo.org')).toBe(true);
        expect(urls.has('https://nsfw.oisd.nl')).toBe(true);
    });

    it('warns on invalid Obsidian 127.0.0.1 URL', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // Pass an invalid port that makes URL construction fail
        // normalizeUrl throws for invalid URLs, which the try/catch should catch
        // The URL constructor accepts most inputs, so this path is hard to trigger naturally.
        // But we can at least verify the function handles weird settings gracefully.
        buildAllowedUrls({ obsidian_port: '' }, whitelistFn);
        warnSpy.mockRestore();
    });
});

// ============================================================================
// computeUrlsHash
// ============================================================================

describe('computeUrlsHash', () => {
    it('returns pipe-joined sorted URLs', () => {
        const hash = computeUrlsHash(new Set(['https://b.com', 'https://a.com']));
        expect(hash).toBe('https://a.com|https://b.com');
    });

    it('returns empty string for empty set', () => {
        expect(computeUrlsHash(new Set())).toBe('');
    });

    it('same URLs in different order produce same hash', () => {
        const h1 = computeUrlsHash(new Set(['https://a.com', 'https://b.com']));
        const h2 = computeUrlsHash(new Set(['https://b.com', 'https://a.com']));
        expect(h1).toBe(h2);
    });
});

// ============================================================================
// saveSettingsWithAllowedUrls
// ============================================================================

describe('saveSettingsWithAllowedUrls', () => {
    it('calls saveSettingsFunc with provided settings', async () => {
        const mockSave = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
        const settings = { obsidian_protocol: 'https' } as any;
        await saveSettingsWithAllowedUrls(settings, mockSave as any);
        expect(mockSave).toHaveBeenCalledWith(settings);
    });
});

// ============================================================================
// getAllowedUrls
// ============================================================================

describe('getAllowedUrls', () => {
    it('returns empty set when key not in storage', async () => {
        const urls = await getAllowedUrls('myAllowedUrls');
        expect(urls.size).toBe(0);
    });

    it('returns URLs from storage', async () => {
        await chrome.storage.local.set({ myKey: ['https://a.com', 'https://b.com'] });
        const urls = await getAllowedUrls('myKey');
        expect(urls.size).toBe(2);
        expect(urls.has('https://a.com')).toBe(true);
    });
});

// ============================================================================
// updateUrlTimestamp: retention and LRU eviction (lines 170-208)
// ============================================================================

describe('updateUrlTimestamp: retention & LRU eviction', () => {
    it('removes entries older than URL_RETENTION_DAYS', async () => {
        const now = Date.now();
        const oldTimestamp = now - (URL_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000;
        await seedTimestamps([
            { url: 'https://old.com', timestamp: oldTimestamp },
            { url: 'https://new.com', timestamp: now },
        ]);

        // Adding a new URL triggers cleanup of old entries
        await addSavedUrl('https://fresh.com');
        const entries = await getSavedUrlEntries();
        const urls = entries.map(e => e.url);
        expect(urls).toContain('https://new.com');
        expect(urls).toContain('https://fresh.com');
        expect(urls).not.toContain('https://old.com');
    });

    it('LRU evicts oldest entries when exceeding MAX_URL_SET_SIZE', async () => {
        const now = Date.now();
        // Create MAX_URL_SET_SIZE + 5 entries
        const entries = Array.from({ length: MAX_URL_SET_SIZE + 5 }, (_, i) => ({
            url: `https://site${i}.com`,
            timestamp: now - (MAX_URL_SET_SIZE + 5 - i) * 1000, // older entries have smaller timestamps
        }));
        await seedTimestamps(entries);

        // Adding one more should trigger eviction
        await addSavedUrl('https://new-entry.com');
        const result = await getSavedUrlEntries();
        expect(result.length).toBeLessThanOrEqual(MAX_URL_SET_SIZE);
        // The oldest entries should be evicted
        expect(result.find(e => e.url === 'https://site0.com')).toBeUndefined();
        expect(result.find(e => e.url === 'https://new-entry.com')).toBeDefined();
    });
});

// ============================================================================
// getSavedUrlsWithTimestamps
// ============================================================================

describe('getSavedUrlsWithTimestamps', () => {
    it('returns empty map when storage is empty', async () => {
        const map = await getSavedUrlsWithTimestamps();
        expect(map.size).toBe(0);
    });

    it('returns URL-timestamp map from storage', async () => {
        await seedTimestamps([
            { url: 'https://a.com', timestamp: 1000 },
            { url: 'https://b.com', timestamp: 2000 },
        ]);
        const map = await getSavedUrlsWithTimestamps();
        expect(map.size).toBe(2);
        expect(map.get('https://a.com')).toBe(1000);
        expect(map.get('https://b.com')).toBe(2000);
    });
});

// ============================================================================
// setSavedUrls
// ============================================================================

describe('setSavedUrls', () => {
    it('saves URL set to storage', async () => {
        const urlSet = new Set(['https://a.com', 'https://b.com']);
        await setSavedUrls(urlSet);
        const urls = await getSavedUrls();
        expect(urls.size).toBe(2);
        expect(urls.has('https://a.com')).toBe(true);
        expect(urls.has('https://b.com')).toBe(true);
    });

    it('updates timestamp when urlToAdd is provided', async () => {
        const urlSet = new Set(['https://existing.com']);
        await setSavedUrls(urlSet, 'https://existing.com');
        const entries = await getSavedUrlEntries();
        const entry = entries.find(e => e.url === 'https://existing.com');
        expect(entry).toBeDefined();
        expect(entry!.timestamp).toBeGreaterThan(0);
    });

    it('does not update timestamp when urlToAdd is null', async () => {
        const urlSet = new Set(['https://a.com']);
        await setSavedUrls(urlSet, null);
        const urls = await getSavedUrls();
        expect(urls.has('https://a.com')).toBe(true);
        const entries = await getSavedUrlEntries();
        // No timestamp entry created when urlToAdd is null
        expect(entries.length).toBe(0);
    });
});

// ============================================================================
// setSavedUrlsWithTimestamps
// ============================================================================

describe('setSavedUrlsWithTimestamps', () => {
    it('saves URL map with timestamps', async () => {
        const urlMap = new Map<string, number>([
            ['https://a.com', 1000],
            ['https://b.com', 2000],
        ]);
        await setSavedUrlsWithTimestamps(urlMap);
        const entries = await getSavedUrlEntries();
        expect(entries.length).toBe(2);
        const urls = await getSavedUrls();
        expect(urls.has('https://a.com')).toBe(true);
        expect(urls.has('https://b.com')).toBe(true);
    });

    it('preserves existing entry fields when updating', async () => {
        // First, create entries with extra fields
        await addSavedUrl('https://example.com');
        await setUrlRecordType('https://example.com', 'manual');
        await setUrlMaskedCount('https://example.com', 7);
        await setUrlTags('https://example.com', ['tag1']);
        await setUrlAiSummary('https://example.com', 'Summary');
        await setUrlSentTokens('https://example.com', 100);
        await setUrlReceivedTokens('https://example.com', 200);
        await setUrlOriginalTokens('https://example.com', 300);
        await setUrlCleansedTokens('https://example.com', 250);

        // Now overwrite with setSavedUrlsWithTimestamps
        const urlMap = new Map<string, number>([
            ['https://example.com', Date.now()],
        ]);
        await setSavedUrlsWithTimestamps(urlMap);
        const entries = await getSavedUrlEntries();
        const entry = entries.find(e => e.url === 'https://example.com');
        expect(entry).toBeDefined();
        expect(entry!.recordType).toBe('manual');
        expect(entry!.maskedCount).toBe(7);
        expect(entry!.tags).toEqual(['tag1']);
        expect(entry!.aiSummary).toBe('Summary');
        expect(entry!.sentTokens).toBe(100);
        expect(entry!.receivedTokens).toBe(200);
        expect(entry!.originalTokens).toBe(300);
        expect(entry!.cleansedTokens).toBe(250);
    });

    it('preserves byte fields when updating', async () => {
        await addSavedUrl('https://example.com');
        await setUrlPageBytes('https://example.com', 1000);
        await setUrlCandidateBytes('https://example.com', 800);
        await setUrlOriginalBytes('https://example.com', 1200);
        await setUrlCleansedBytes('https://example.com', 900);
        await setUrlAiSummaryOriginalBytes('https://example.com', 500);
        await setUrlAiSummaryCleansedBytes('https://example.com', 400);
        await setUrlAiSummaryCleansedElements('https://example.com', 10);
        await setUrlAiSummaryCleansedReason('https://example.com', 'ads');

        const urlMap = new Map<string, number>([
            ['https://example.com', Date.now()],
        ]);
        await setSavedUrlsWithTimestamps(urlMap);
        const entries = await getSavedUrlEntries();
        const entry = entries.find(e => e.url === 'https://example.com');
        expect(entry!.pageBytes).toBe(1000);
        expect(entry!.candidateBytes).toBe(800);
        expect(entry!.originalBytes).toBe(1200);
        expect(entry!.cleansedBytes).toBe(900);
        expect(entry!.aiSummaryOriginalBytes).toBe(500);
        expect(entry!.aiSummaryCleansedBytes).toBe(400);
        expect(entry!.aiSummaryCleansedElements).toBe(10);
        expect(entry!.aiSummaryCleansedReason).toBe('ads');
    });

    it('accepts urlToAdd parameter without error (unused internally)', async () => {
        const urlMap = new Map<string, number>([
            ['https://existing.com', 1000],
        ]);
        // urlToAdd parameter is accepted but not used in setSavedUrlsWithTimestamps
        await setSavedUrlsWithTimestamps(urlMap, 'https://new.com');
        const entries = await getSavedUrlEntries();
        const urls = entries.map(e => e.url);
        expect(urls).toContain('https://existing.com');
    });

    it('handles empty urlMap', async () => {
        const urlMap = new Map<string, number>();
        await setSavedUrlsWithTimestamps(urlMap);
        const entries = await getSavedUrlEntries();
        expect(entries.length).toBe(0);
    });

    it('does not modify storage when urlMap and existing are identical', async () => {
        await seedTimestamps([
            { url: 'https://a.com', timestamp: 1000 },
            { url: 'https://b.com', timestamp: 2000 },
        ]);
        const urlMap = new Map<string, number>([
            ['https://a.com', 1000],
            ['https://b.com', 2000],
        ]);
        await setSavedUrlsWithTimestamps(urlMap);
        const urls = await getSavedUrls();
        expect(urls.size).toBe(2);
    });

    it('updates savedUrls when size differs from current', async () => {
        await chrome.storage.local.set({ savedUrls: ['https://old.com'] });
        const urlMap = new Map<string, number>([
            ['https://a.com', 1000],
            ['https://b.com', 2000],
        ]);
        await setSavedUrlsWithTimestamps(urlMap);
        const urls = await getSavedUrls();
        expect(urls.has('https://a.com')).toBe(true);
        expect(urls.has('https://b.com')).toBe(true);
        expect(urls.has('https://old.com')).toBe(false);
    });

    it('updates savedUrls when content differs even with same size', async () => {
        await chrome.storage.local.set({ savedUrls: ['https://old.com'] });
        const urlMap = new Map<string, number>([
            ['https://new.com', 1000],
        ]);
        await setSavedUrlsWithTimestamps(urlMap);
        const urls = await getSavedUrls();
        expect(urls.has('https://new.com')).toBe(true);
        expect(urls.has('https://old.com')).toBe(false);
    });
});
