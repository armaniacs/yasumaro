// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
    applyFallback,
    getByteSize,
    makeByteMeter,
    resolvePreAiBytes,
} from '../extractPipeline.js';
import { extractMainContent, extractMainContentWithInfo } from '../index.js';

describe('extractPipeline: ByteMeter', () => {
    it('disabled meter never encodes and returns 0', () => {
        const meter = makeByteMeter(false);
        expect(meter.enabled).toBe(false);
        expect(meter.measure('hello')).toBe(0);
        expect(meter.measure('')).toBe(0);
    });

    it('enabled meter matches the TextEncoder oracle', () => {
        const meter = makeByteMeter(true);
        expect(meter.enabled).toBe(true);
        expect(meter.measure('hello')).toBe(getByteSize('hello'));
        expect(meter.measure('日本語')).toBe(new Blob(['日本語']).size);
    });
});

describe('extractPipeline: resolvePreAiBytes', () => {
    it('reuses the known size for identical strings (no duplicate encode)', () => {
        const meter = makeByteMeter(true);
        const { cleansedBytes, preAiBytes } = resolvePreAiBytes(
            meter, 'same', { text: 'same', bytes: 123 }, true
        );
        expect(cleansedBytes).toBe(123);
        expect(preAiBytes).toBe(123);
    });

    it('measures changed strings on the diagnostic path', () => {
        const meter = makeByteMeter(true);
        const { cleansedBytes, preAiBytes } = resolvePreAiBytes(
            meter, 'changed', { text: 'original', bytes: 1 }, true
        );
        expect(cleansedBytes).toBe(getByteSize('changed'));
        expect(preAiBytes).toBe(getByteSize('changed'));
    });

    it('hot path performs one fallback-critical encode only when AI is enabled', () => {
        const meter = makeByteMeter(false);
        const withAi = resolvePreAiBytes(meter, 'text', { text: 't', bytes: 0 }, true);
        expect(withAi.cleansedBytes).toBe(0);
        expect(withAi.preAiBytes).toBe(getByteSize('text'));
        const withoutAi = resolvePreAiBytes(meter, 'text', { text: 't', bytes: 0 }, false);
        expect(withoutAi.preAiBytes).toBe(0);
    });
});

describe('extractPipeline: applyFallback (single policy for all 3 paths)', () => {
    const base = {
        fallbackRatio: 0.2,
        fallbackMinBytes: 300,
        readBodyText: (): string => 'BODY FALLBACK TEXT',
    };

    it('no fallback for healthy content', () => {
        const content = `x`.repeat(500);
        const decision = applyFallback({
            ...base,
            content,
            contentBytes: getByteSize(content),
            preAiCleanseText: 'pre-ai',
            aiSummaryOriginalBytes: getByteSize(content),
        });
        expect(decision.fallbackTriggered).toBe(false);
        expect(decision.content).toBe(content);
    });

    it('short content falls back to body text', () => {
        const decision = applyFallback({
            ...base,
            content: 'tiny',
            contentBytes: getByteSize('tiny'),
        });
        expect(decision.fallbackTriggered).toBe(true);
        expect(decision.fallbackReason).toBe('short_content');
        expect(decision.usePreAiText).toBe(false);
        expect(decision.content).toBe('BODY FALLBACK TEXT');
        expect(decision.fallbackBytes).toBeUndefined();
    });

    it('over-cleansed content falls back to pre-AI text with reused byte size', () => {
        const preAi = 'pre-ai '.repeat(100);
        const preAiBytes = getByteSize(preAi);
        const small = 'y'.repeat(150);
        const decision = applyFallback({
            ...base,
            content: small,
            contentBytes: getByteSize(small),
            preAiCleanseText: preAi,
            aiSummaryOriginalBytes: preAiBytes,
        });
        expect(decision.fallbackTriggered).toBe(true);
        expect(decision.fallbackReason).toBe('over_cleansed');
        expect(decision.usePreAiText).toBe(true);
        expect(decision.content).toBe(preAi);
        expect(decision.fallbackBytes).toBe(preAiBytes);
    });

    it('over-cleansed without pre-AI text falls back to body', () => {
        const small = 'y'.repeat(150);
        const decision = applyFallback({
            ...base,
            content: small,
            contentBytes: getByteSize(small),
            aiSummaryOriginalBytes: 10000,
        });
        expect(decision.fallbackTriggered).toBe(true);
        expect(decision.fallbackReason).toBe('short_content');
        expect(decision.content).toBe('BODY FALLBACK TEXT');
    });

    it('does not call readBodyText when no fallback triggers', () => {
        let calls = 0;
        const content = 'z'.repeat(500);
        const decision = applyFallback({
            ...base,
            content,
            contentBytes: getByteSize(content),
            readBodyText: () => { calls++; return 'body'; },
        });
        expect(decision.fallbackTriggered).toBe(false);
        expect(calls).toBe(0);
    });
});

describe('extractor entries: string / WithInfo split', () => {
    it('extractMainContent returns a string without diagnostics', () => {
        document.body.innerHTML = `<article><p>${'Entry split content. '.repeat(20)}</p></article>`;
        const result = extractMainContent(10000, {}, { aiSummaryCleanseEnabled: true });
        expect(typeof result).toBe('string');
        expect((result as string).length).toBeGreaterThan(100);
    });

    it('extractMainContentWithInfo returns full diagnostics without the flag', () => {
        document.body.innerHTML = `<article><p>${'Entry split diagnostics. '.repeat(20)}</p></article>`;
        const result = extractMainContentWithInfo(10000, {}, { aiSummaryCleanseEnabled: true });
        expect(typeof result.content).toBe('string');
        expect(result.pageBytes).toBeGreaterThan(0);
        expect(result.candidateBytes).toBeGreaterThan(0);
        expect(result.fallbackTriggered).toBe(false);
    });

    it('both entries produce identical cleansing results', () => {
        document.body.innerHTML = `<article><h1>Same</h1><p>${'Identical cleansing check. '.repeat(20)}</p><script>rm</script></article>`;
        const str = extractMainContent(
            10000,
            { cleanseEnabled: true },
            { aiSummaryCleanseEnabled: true }
        );
        document.body.innerHTML = `<article><h1>Same</h1><p>${'Identical cleansing check. '.repeat(20)}</p><script>rm</script></article>`;
        const info = extractMainContentWithInfo(
            10000,
            { cleanseEnabled: true },
            { aiSummaryCleanseEnabled: true }
        );
        expect(info.content).toBe(str);
    });

    it('extractMainContentWithInfo returns diagnostics with no flag (shim removed)', () => {
        document.body.innerHTML = `<article><p>${'WithInfo diagnostics content. '.repeat(20)}</p></article>`;
        const result = extractMainContentWithInfo(10000, {});
        expect(typeof result).not.toBe('string');
        expect(typeof result.content).toBe('string');
    });
});
