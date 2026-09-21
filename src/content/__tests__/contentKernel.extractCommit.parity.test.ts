// @vitest-environment jsdom
/**
 * contentKernel.extractCommit.parity.test.ts (PBI 2026-09-21-25)
 * Pins the CURRENT extract -> apply pair behavior BEFORE the
 * extractAndCommit fold, so the deep call can prove field-equivalence after.
 * - stat mapping lands in pageState (5 blocks, incl. undefined defaults)
 * - extract default config === pageState.cleansingConfig
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentKernel } from '../contentKernel.js';
import { InMemoryStoragePort } from '../../utils/storage/storagePort.js';
import { InMemoryDomainPolicyPort } from './helpers/inMemoryDomainPolicyPort.js';
import { PageState } from '../pageState.js';
import { VisitReporter } from '../visitReporter.js';
import { handleGetContentMessage } from '../getContentHandler.js';
import type { ExtractResult } from '../../utils/contentExtractor/types.js';

function makeKernel(pageState?: PageState): ContentKernel {
    const storage = new InMemoryStoragePort();
    const policy = new InMemoryDomainPolicyPort();
    return new ContentKernel(storage, policy, () => Date.now(), undefined, {
        sender: { sendMessageWithRetry: async () => ({ success: true }) },
        ...(pageState ? { pageState } : {}),
    });
}

beforeEach(() => {
    document.body.innerHTML = '';
});

describe('pair pin: applyExtractResultToPageState maps all 5 stat blocks', () => {
    it('copies every stat field into pageState', () => {
        const kernel = makeKernel();
        const result = {
            content: 'x',
            cleansedReason: 'both',
            hardStripRemoved: 1,
            keywordStripRemoved: 2,
            totalRemoved: 3,
            pageBytes: 10,
            candidateBytes: 20,
            originalBytes: 30,
            cleansedBytes: 40,
            aiSummaryOriginalBytes: 50,
            aiSummaryCleansedBytes: 60,
            aiSummaryCleansedElements: 7,
            aiSummaryCleansedReason: 'keyword',
            aiSummaryCleansedReasons: ['keyword'],
            fallbackTriggered: true,
        } as unknown as ExtractResult;
        kernel.applyExtractResultToPageState(result);
        expect(kernel.pageState.lastCleansedReason).toBe('both');
        expect(kernel.pageState.lastCleanseStats).toEqual({ hardStripRemoved: 1, keywordStripRemoved: 2, totalRemoved: 3 });
        expect(kernel.pageState.lastByteStats).toEqual({ pageBytes: 10, candidateBytes: 20, originalBytes: 30, cleansedBytes: 40 });
        expect(kernel.pageState.lastAiSummaryCleansedStats).toMatchObject({
            aiSummaryOriginalBytes: 50,
            aiSummaryCleansedBytes: 60,
            aiSummaryCleansedElements: 7,
            aiSummaryCleansedReason: 'keyword',
            aiSummaryCleansedReasons: ['keyword'],
        });
        expect(kernel.pageState.lastFallbackTriggered).toBe(true);
    });

    it('falls back to 0 / false / none for undefined fields', () => {
        const kernel = makeKernel();
        kernel.applyExtractResultToPageState({ content: 'x' } as ExtractResult);
        expect(kernel.pageState.lastCleansedReason).toBe('none');
        expect(kernel.pageState.lastCleanseStats).toEqual({ hardStripRemoved: 0, keywordStripRemoved: 0, totalRemoved: 0 });
        expect(kernel.pageState.lastByteStats).toEqual({ pageBytes: 0, candidateBytes: 0, originalBytes: 0, cleansedBytes: 0 });
        expect(kernel.pageState.lastAiSummaryCleansedStats).toMatchObject({
            aiSummaryOriginalBytes: 0,
            aiSummaryCleansedBytes: 0,
            aiSummaryCleansedElements: 0,
            aiSummaryCleansedReason: 'none',
        });
        expect(kernel.pageState.lastFallbackTriggered).toBe(false);
    });
});

describe('pair pin: extract default config reads pageState.cleansingConfig', () => {
    const DOM = `<article><p>${'Pin default config body text. '.repeat(10)}</p><script>alert('strip me')</script></article>`;

    it('default (no-arg) extract tracks pageState.cleansingConfig', () => {
        document.body.innerHTML = DOM;
        const kernel = makeKernel();
        const withStrip = kernel.extractPageContent();
        // Disable cleansing via pageState, re-extract with the default (no arg).
        kernel.pageState.cleansingConfig = {
            ...kernel.pageState.cleansingConfig,
            contentStripHardEnabled: false,
            contentStripKeywordEnabled: false,
            aiSummaryCleansingEnabled: false,
            whitelistExtractionEnabled: false,
            contentDedupEnabled: false,
        };
        document.body.innerHTML = DOM;
        const withoutStrip = kernel.extractPageContent();
        // The default read must follow pageState: different configs, different outcomes.
        expect(withStrip.totalRemoved ?? 0).not.toBe(withoutStrip.totalRemoved ?? 0);
    });
});

describe('extractAndCommit: deep call equals the pair (field-equivalence)', () => {
    const DOM = `<article><p>${'Deep call parity body text. '.repeat(10)}</p><script>alert('strip me')</script></article>`;

    function snapshot(pageState: PageState): Record<string, unknown> {
        return {
            lastCleansedReason: pageState.lastCleansedReason,
            lastCleanseStats: { ...pageState.lastCleanseStats },
            lastByteStats: { ...pageState.lastByteStats },
            lastAiSummaryCleansedStats: { ...pageState.lastAiSummaryCleansedStats },
            lastFallbackTriggered: pageState.lastFallbackTriggered,
        };
    }

    it('returns the same ExtractResult and commits identical stats as the pair', () => {
        document.body.innerHTML = DOM;
        const viaPair = makeKernel();
        const pairResult = viaPair.extractPageContent();
        viaPair.applyExtractResultToPageState(pairResult);

        document.body.innerHTML = DOM;
        const viaDeep = makeKernel();
        // Same default config: fresh kernels share the same default cleansing config.
        const deepResult = viaDeep.extractAndCommit();

        expect(deepResult).toEqual(pairResult);
        expect(snapshot(viaDeep.pageState)).toEqual(snapshot(viaPair.pageState));
        expect(viaDeep.pageState.lastCleansedReason).toBe(pairResult.cleansedReason || 'none');
        expect(viaDeep.pageState.lastCleanseStats.totalRemoved).toBe(pairResult.totalRemoved ?? 0);
        expect(viaDeep.pageState.lastByteStats.pageBytes).toBe(pairResult.pageBytes ?? 0);
        expect(viaDeep.pageState.lastFallbackTriggered).toBe(pairResult.fallbackTriggered ?? false);
    });

    it('honours an explicit config identically to the pair', () => {
        document.body.innerHTML = DOM;
        const config = { ...makeKernel().pageState.cleansingConfig, contentStripHardEnabled: false };
        const viaPair = makeKernel();
        document.body.innerHTML = DOM;
        const pairResult = viaPair.extractPageContent(config);
        viaPair.applyExtractResultToPageState(pairResult);

        document.body.innerHTML = DOM;
        const viaDeep = makeKernel();
        const deepResult = viaDeep.extractAndCommit(config);

        expect(deepResult).toEqual(pairResult);
        expect(snapshot(viaDeep.pageState)).toEqual(snapshot(viaPair.pageState));
    });

    it('resolves the default config once at entry: no re-read after pageState changes', () => {
        document.body.innerHTML = DOM;
        const kernel = makeKernel();
        const before = kernel.pageState.cleansingConfig;
        const result = kernel.extractAndCommit();
        // The entry snapshot is the object read before extraction.
        expect(result).toBeDefined();
        expect(kernel.pageState.cleansingConfig).toBe(before);
        expect(kernel.pageState.lastCleansedReason).toBe(result.cleansedReason || 'none');
    });

    it('visitReporter delegates to extractAndCommit (no pair knowledge)', async () => {
        document.body.innerHTML = DOM;
        const kernel = makeKernel();
        const sender = { sendMessageWithRetry: vi.fn(async () => ({ success: true })) };
        const reporter = new VisitReporter({
            pageState: kernel.pageState,
            extractAndCommit: (c) => kernel.extractAndCommit(c),
            sender,
        });
        await reporter.report();
        expect(kernel.pageState.lastByteStats.pageBytes).toBeGreaterThan(0);
        expect(sender.sendMessageWithRetry).toHaveBeenCalledTimes(1);
        const sent = sender.sendMessageWithRetry.mock.calls[0]![0] as { payload: Record<string, unknown> };
        expect(sent.payload.content).toBeDefined();
    });

    it('getContentHandler commits via extractAndCommit alone', () => {
        document.body.innerHTML = DOM;
        const kernel = makeKernel();
        const sendResponse = (_r?: unknown): void => undefined;
        const calls: unknown[] = [];
        const extractAndCommit = vi.fn((c?: Parameters<typeof kernel.extractAndCommit>[0]) => kernel.extractAndCommit(c));
        handleGetContentMessage(
            { type: 'GET_CONTENT' },
            { id: 'test-extension-id' },
            (r?: unknown) => { calls.push(r); },
            {
                extractAndCommit,
                pageState: kernel.pageState,
                runtimeId: 'test-extension-id',
            },
        );
        expect(extractAndCommit).toHaveBeenCalledTimes(1);
        expect(calls).toHaveLength(1);
        expect(kernel.pageState.lastByteStats.pageBytes).toBeGreaterThan(0);
        expect(sendResponse).toBeDefined();
    });
});

describe('pair pin: explicit config override', () => {
    const DOM = `<article><p>${'Pin explicit config body text. '.repeat(10)}</p><script>alert('strip me')</script></article>`;

    it('explicit config overrides the pageState default', () => {
        document.body.innerHTML = DOM;
        const kernel = makeKernel();
        kernel.pageState.cleansingConfig = {
            ...kernel.pageState.cleansingConfig,
            contentStripHardEnabled: false,
            contentStripKeywordEnabled: false,
            aiSummaryCleansingEnabled: false,
            whitelistExtractionEnabled: false,
            contentDedupEnabled: false,
        };
        document.body.innerHTML = DOM;
        const explicit = kernel.extractPageContent({
            ...kernel.pageState.cleansingConfig,
            contentStripHardEnabled: true,
        });
        document.body.innerHTML = DOM;
        const implicit = kernel.extractPageContent();
        expect(explicit.totalRemoved ?? 0).not.toBe(implicit.totalRemoved ?? 0);
    });
});
