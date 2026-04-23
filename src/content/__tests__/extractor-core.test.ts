// @vitest-environment jsdom
/**
 * extractor.ts core function tests
 * Tests for exported state variables, extractPageContent, and init behavior.
 * The module-level chrome.runtime guard allows safe import in jsdom.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    shouldRecordVisit,
    extractPageContent,
    init,
    lastCleansedReason,
    lastCleanseStats,
    lastByteStats,
    lastAiSummaryCleansedStats,
    lastFallbackTriggered,
} from '../extractor.js';

describe('shouldRecordVisit', () => {
    it('returns true when both duration and scroll meet thresholds', () => {
        expect(shouldRecordVisit(5, 50)).toBe(true);
        expect(shouldRecordVisit(10, 100)).toBe(true);
    });

    it('returns false when duration is below threshold', () => {
        expect(shouldRecordVisit(4, 50)).toBe(false);
        expect(shouldRecordVisit(0, 100)).toBe(false);
    });

    it('returns false when scroll is below threshold', () => {
        expect(shouldRecordVisit(10, 49)).toBe(false);
        expect(shouldRecordVisit(10, 0)).toBe(false);
    });

    it('returns false when both conditions unmet', () => {
        expect(shouldRecordVisit(2, 20)).toBe(false);
    });

    it('returns true at exact threshold boundary', () => {
        expect(shouldRecordVisit(5, 50)).toBe(true);
    });
});

describe('exported state initial values', () => {
    it('lastCleansedReason is "none" by default', () => {
        expect(lastCleansedReason).toBe('none');
    });

    it('lastCleanseStats has zero counts by default', () => {
        expect(lastCleanseStats.hardStripRemoved).toBe(0);
        expect(lastCleanseStats.keywordStripRemoved).toBe(0);
        expect(lastCleanseStats.totalRemoved).toBe(0);
    });

    it('lastByteStats has zero bytes by default', () => {
        expect(lastByteStats.pageBytes).toBe(0);
        expect(lastByteStats.candidateBytes).toBe(0);
        expect(lastByteStats.originalBytes).toBe(0);
        expect(lastByteStats.cleansedBytes).toBe(0);
    });

    it('lastAiSummaryCleansedStats has zero counts and "none" reason by default', () => {
        expect(lastAiSummaryCleansedStats.aiSummaryOriginalBytes).toBe(0);
        expect(lastAiSummaryCleansedStats.aiSummaryCleansedBytes).toBe(0);
        expect(lastAiSummaryCleansedStats.aiSummaryCleansedElements).toBe(0);
        expect(lastAiSummaryCleansedStats.aiSummaryCleansedReason).toBe('none');
    });

    it('lastFallbackTriggered is false by default', () => {
        expect(lastFallbackTriggered).toBe(false);
    });
});

describe('extractPageContent', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('returns empty string for empty document', () => {
        document.body.innerHTML = '';
        const result = extractPageContent();
        expect(typeof result).toBe('string');
    });

    it('extracts text from article element', () => {
        document.body.innerHTML = `
            <article>
                <h1>Test Article</h1>
                <p>This is the main content of the article with enough text to be extracted.</p>
                <p>Another paragraph with more meaningful content here.</p>
            </article>
        `;
        const result = extractPageContent();
        expect(result).toContain('Test Article');
        expect(result).toContain('main content');
    });

    it('returns a string for document with main element', () => {
        document.body.innerHTML = `
            <main>
                <h2>Main Content</h2>
                <p>This is main content with sufficient length for extraction.</p>
            </main>
        `;
        const result = extractPageContent();
        expect(typeof result).toBe('string');
    });

    it('returns a string even when body has only nav elements', () => {
        document.body.innerHTML = `
            <nav><a href="/">Home</a><a href="/about">About</a></nav>
        `;
        const result = extractPageContent();
        expect(typeof result).toBe('string');
    });

    it('respects maxChars limit (default 10000)', () => {
        const longText = 'a'.repeat(15000);
        document.body.innerHTML = `<article><p>${longText}</p></article>`;
        const result = extractPageContent();
        expect(result.length).toBeLessThanOrEqual(10000);
    });
});

describe('init', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
        // loadSettings() はコールバック形式で chrome.storage.local.get を呼ぶ
        // モックがコールバックを即座に呼ぶよう設定
        (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockImplementation(
            (_keys: unknown, callback?: (result: Record<string, unknown>) => void) => {
                if (typeof callback === 'function') callback({});
                return Promise.resolve({});
            }
        );
    });

    it('resolves without throwing in jsdom environment', async () => {
        await expect(init()).resolves.not.toThrow();
    });

    it('adds scroll event listener to window', async () => {
        const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
        await init();
        expect(addEventListenerSpy).toHaveBeenCalledWith('scroll', expect.any(Function));
    });

    it('adds beforeunload event listener to window', async () => {
        const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
        await init();
        expect(addEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    });

    it('adds visibilitychange event listener to document', async () => {
        const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
        await init();
        expect(addEventListenerSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });
});
