// @vitest-environment jsdom
/**
 * extractionReport.test.ts — PBI 2026-09-23-09 report-level pins.
 *
 * The opaque ExtractionReport replaces the ~18-field ExtractResult width:
 * byte-identity of the hot path, whitelist report uniformity, seam parity
 * with the legacy shape, and the single-call kernel commit.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { extract, extractMainContent, extractMainContentWithInfo } from '../index.js';
import { ExtractionReport } from '../extractionReport.js';
import { ContentKernel } from '../../../content/contentKernel.js';
import { InMemoryStoragePort } from '../../storage/storagePort.js';
import { InMemoryDomainPolicyPort } from '../../../content/__tests__/helpers/inMemoryDomainPolicyPort.js';

const ARTICLE = `<article><h1>Report pin</h1><p>${'Article body content for report verification. '.repeat(10)}</p></article>`;

function makeKernel(): ContentKernel {
    return new ContentKernel(new InMemoryStoragePort(), new InMemoryDomainPolicyPort(), () => Date.now(), undefined, {
        sender: { sendMessageWithRetry: async () => ({ success: true }) },
    });
}

beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('extract() hot path stays byte-identical to the string entry', () => {
    it('returns the same content string with default options', () => {
        document.body.innerHTML = ARTICLE;
        const viaString = extractMainContent(10000, {});
        document.body.innerHTML = ARTICLE;
        const { content } = extract({ maxChars: 10000, cleanseOptions: { cleanseEnabled: false } });
        expect(content).toBe(viaString);
    });

    it('returns the same content string with cleanse + AI summary enabled', () => {
        const dom = `<article><p>${'Main content for combined pin. '.repeat(10)}</p><script>alert('x')</script></article>`;
        document.body.innerHTML = dom;
        const viaString = extractMainContent(
            10000,
            { cleanseEnabled: true, hardStripEnabled: true },
            { aiSummaryCleanseEnabled: true, altEnabled: true },
        );
        document.body.innerHTML = dom;
        const { content } = extract({
            maxChars: 10000,
            cleanseOptions: { cleanseEnabled: true, hardStripEnabled: true },
            aiSummaryCleanseOptions: { aiSummaryCleanseEnabled: true, altEnabled: true },
        });
        expect(content).toBe(viaString);
    });

    it('keeps the string-path encode budget (one fallback-critical encode)', () => {
        document.body.innerHTML = ARTICLE;
        const encodeSpy = vi.spyOn(TextEncoder.prototype, 'encode');
        extractMainContent(10000, {});
        expect(encodeSpy).toHaveBeenCalledTimes(1);
    });
});

describe('whitelist path also produces a report', () => {
    function setupWhitelistDom(): void {
        document.body.innerHTML = `<article><h1>薄いレスのスレ</h1><div class="t_b">薄いレス本文</div></article>`;
    }

    it('carries adapterUsed with a zero byte-funnel and no fallback', () => {
        setupWhitelistDom();
        const { content, report } = extract({ cleanseOptions: { cleanseEnabled: true } });
        expect(report.adapterUsed).toBe('5ch-matome');
        expect(content).toContain('薄いレス本文');
        expect(report.bytesFunnel()).toEqual({ pageBytes: 0, candidateBytes: 0, cleansedBytes: 0 });
        expect(report.fallbackCause()).toEqual({ triggered: false });
    });

    it('legacy expansion of a whitelist report mirrors the old early-return shape', () => {
        setupWhitelistDom();
        const { content, report } = extract({ cleanseOptions: { cleanseEnabled: true } });
        const legacy = report.toLegacyResult(content);
        expect(legacy.whitelistAdapterUsed).toBe('5ch-matome');
        expect(legacy.pageBytes).toBeUndefined();
        expect(legacy.fallbackTriggered).toBeUndefined();
    });
});

describe('narrow seam matches the legacy diagnostic values', () => {
    it('bytesFunnel() equals the legacy byte columns', () => {
        document.body.innerHTML = `<article><p>${'Byte funnel pin content. '.repeat(20)}</p><script>alert('x')</script></article>`;
        const { report } = extract({ cleanseOptions: { cleanseEnabled: true, hardStripEnabled: true } });
        document.body.innerHTML = `<article><p>${'Byte funnel pin content. '.repeat(20)}</p><script>alert('x')</script></article>`;
        const legacy = extractMainContentWithInfo(10000, { cleanseEnabled: true, hardStripEnabled: true });
        expect(report.bytesFunnel()).toEqual({
            pageBytes: legacy.pageBytes,
            candidateBytes: legacy.candidateBytes,
            cleansedBytes: legacy.cleansedBytes,
        });
    });

    it('cleanseCounts() equals the legacy cleanse fields', () => {
        document.body.innerHTML = `<article><p>${'Cleanse counts pin content. '.repeat(10)}</p><script>alert('x')</script></article>`;
        const { report } = extract({ cleanseOptions: { cleanseEnabled: true, hardStripEnabled: true } });
        const counts = report.cleanseCounts();
        expect(counts.cleansedReason).toBe('hard');
        expect(counts.hardStripRemoved).toBeGreaterThan(0);
        expect(counts.totalRemoved).toBe(counts.hardStripRemoved + counts.keywordStripRemoved);
        expect(counts.cleansingExecuted).toBe(true);
    });

    it('fallbackCause() reports the short_content settlement', () => {
        document.body.innerHTML = `<article><p>Hi</p></article><div>Some other body content that will be used as fallback text here.</div>`;
        const { content, report } = extract({ aiSummaryCleanseOptions: { candidateGuardEnabled: false } });
        expect(report.fallbackCause()).toEqual({ triggered: true, reason: 'short_content' });
        expect(typeof content).toBe('string');
    });

    it('originalText() retains the pre-cleanse text capped at maxChars*2', () => {
        document.body.innerHTML = `<article><p>${'Dual payload cap pin. '.repeat(40)}</p></article>`;
        const { report } = extract({ maxChars: 100 });
        const original = report.originalText();
        expect(original).toBeDefined();
        expect((original as string).length).toBeLessThanOrEqual(200);
        expect((original as string).length).toBeGreaterThan(0);
    });
});

describe('report is opaque outside the seam', () => {
    it('exposes no raw diagnostic properties', () => {
        document.body.innerHTML = ARTICLE;
        const { report } = extract({});
        const exposed = report as unknown as Record<string, unknown>;
        expect(exposed['pageBytes']).toBeUndefined();
        expect(exposed['candidateBytes']).toBeUndefined();
        expect(exposed['totalRemoved']).toBeUndefined();
        expect(exposed['fallbackTriggered']).toBeUndefined();
        expect(typeof report.bytesFunnel).toBe('function');
        expect(typeof report.cleanseCounts).toBe('function');
        expect(typeof report.fallbackCause).toBe('function');
        expect(typeof report.originalText).toBe('function');
    });
});

describe('kernel applyReport(report) commits like the legacy pair', () => {
    function snapshot(kernel: ContentKernel): Record<string, unknown> {
        return {
            lastCleansedReason: kernel.pageState.lastCleansedReason,
            lastCleanseStats: { ...kernel.pageState.lastCleanseStats },
            lastByteStats: { ...kernel.pageState.lastByteStats },
            lastAiSummaryCleansedStats: { ...kernel.pageState.lastAiSummaryCleansedStats },
            lastFallbackTriggered: kernel.pageState.lastFallbackTriggered,
            lastFallbackReason: kernel.pageState.lastFallbackReason,
        };
    }

    it('single call equals applyExtractResultToPageState on the same extraction', () => {
        document.body.innerHTML = `<article><p>${'Kernel commit pin content. '.repeat(10)}</p><script>alert('x')</script></article>`;
        const { report } = extract({ cleanseOptions: { cleanseEnabled: true, hardStripEnabled: true } });
        document.body.innerHTML = `<article><p>${'Kernel commit pin content. '.repeat(10)}</p><script>alert('x')</script></article>`;
        const legacy = extractMainContentWithInfo(10000, { cleanseEnabled: true, hardStripEnabled: true });

        const viaReport = makeKernel();
        viaReport.applyReport(report);
        const viaLegacy = makeKernel();
        viaLegacy.applyExtractResultToPageState(legacy);

        expect(snapshot(viaReport)).toEqual(snapshot(viaLegacy));
        expect(viaReport.pageState.lastCleanseStats.totalRemoved).toBeGreaterThan(0);
    });

    it('round-trips a hand-built legacy result through fromLegacy', () => {
        const kernel = makeKernel();
        kernel.applyReport(ExtractionReport.fromLegacy({ content: 'x' }));
        expect(kernel.pageState.lastCleansedReason).toBe('none');
        expect(kernel.pageState.lastCleanseStats).toEqual({ hardStripRemoved: 0, keywordStripRemoved: 0, totalRemoved: 0 });
        expect(kernel.pageState.lastByteStats).toEqual({ pageBytes: 0, candidateBytes: 0, originalBytes: 0, cleansedBytes: 0 });
        expect(kernel.pageState.lastFallbackTriggered).toBe(false);
    });
});
