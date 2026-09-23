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

describe('extractPipeline: applyFallback boundary pins (PBI 05 A1 — ③ existing semantics)', () => {
    const base = {
        fallbackRatio: 0.2,
        fallbackMinBytes: 300,
        readBodyText: (): string => 'BODY FALLBACK TEXT',
    };

    it('ratio exactly at fallbackRatio does not fire (strict <)', () => {
        const decision = applyFallback({
            ...base,
            content: 'x'.repeat(500),
            contentBytes: 300, // 300 / 1500 === 0.20 exactly
            preAiCleanseText: 'pre-ai text long enough to keep',
            aiSummaryOriginalBytes: 1500,
        });
        expect(decision.fallbackTriggered).toBe(false);
        expect(decision.content).toBe('x'.repeat(500));
    });

    it('contentBytes exactly equal to fallbackMinBytes with healthy ratio does not fire', () => {
        const decision = applyFallback({
            ...base,
            content: 'x'.repeat(500),
            contentBytes: 300, // === minBytes; ratio 300/1200 = 0.25 (healthy)
            preAiCleanseText: 'pre-ai text long enough to keep',
            aiSummaryOriginalBytes: 1200,
        });
        expect(decision.fallbackTriggered).toBe(false);
    });

    it('contentBytes at minBytes-1 with healthy ratio fires via absolute floor', () => {
        const preAi = 'pre-ai '.repeat(20);
        const decision = applyFallback({
            ...base,
            content: 'x'.repeat(500),
            contentBytes: 299,
            preAiCleanseText: preAi,
            aiSummaryOriginalBytes: 1196, // ratio 299/1196 = 0.25 (healthy)
        });
        expect(decision.fallbackTriggered).toBe(true);
        expect(decision.fallbackReason).toBe('over_cleansed');
        expect(decision.usePreAiText).toBe(true);
        expect(decision.content).toBe(preAi);
    });

    it('short content + over-cleansed with pre-AI text → over_cleansed wins (current priority pin)', () => {
        const preAi = 'pre-ai '.repeat(20);
        const decision = applyFallback({
            ...base,
            content: 'y'.repeat(50), // <100 chars AND below absolute floor
            contentBytes: 50,
            preAiCleanseText: preAi,
            aiSummaryOriginalBytes: 10000,
        });
        expect(decision.fallbackTriggered).toBe(true);
        expect(decision.fallbackReason).toBe('over_cleansed');
        expect(decision.usePreAiText).toBe(true);
    });

    it('empty preAiCleanseText with overCleansed falls to body (short_content catch-all)', () => {
        const decision = applyFallback({
            ...base,
            content: 'y'.repeat(500),
            contentBytes: 50,
            preAiCleanseText: '',
            aiSummaryOriginalBytes: 10000,
        });
        expect(decision.fallbackTriggered).toBe(true);
        expect(decision.fallbackReason).toBe('short_content');
        expect(decision.usePreAiText).toBe(false);
        expect(decision.content).toBe('BODY FALLBACK TEXT');
    });

    it('byte-identical: without any new PBI-05 fields the decision matches the legacy shape', () => {
        const content = 'z'.repeat(500);
        const decision = applyFallback({
            ...base,
            content,
            contentBytes: getByteSize(content),
        });
        expect(decision).toEqual({
            content,
            fallbackTriggered: false,
            usePreAiText: false,
        });
    });
});

describe('extractPipeline: applyFallback ② content_overcut arm (PBI 05 A2)', () => {
    const base = {
        fallbackRatio: 0.2,
        fallbackMinBytes: 300,
        fallbackMinChars: 100,
        readBodyText: (): string => 'BODY FALLBACK TEXT',
    };
    const preCleanse = 'PRE CLEANSE TEXT '.repeat(30); // 510 chars

    it('severe relative cut fires content_overcut and restores preCleanseText', () => {
        const post = 'tiny post cleanse text'; // 23 chars; 23/510 < 0.2
        const decision = applyFallback({
            ...base,
            content: post,
            contentBytes: getByteSize(post),
            preCleanseText: preCleanse,
            preCleanseChars: preCleanse.length,
            postCleanseChars: post.length,
            preCleanseBytes: 999,
        });
        expect(decision.fallbackTriggered).toBe(true);
        expect(decision.fallbackReason).toBe('content_overcut');
        expect(decision.usePreAiText).toBe(false);
        expect(decision.content).toBe(preCleanse);
        expect(decision.fallbackBytes).toBe(999);
    });

    it('absolute floor fires when post is below minChars but restore reaches the floor', () => {
        const post = 'x'.repeat(80); // 80 < 100; ratio 80/510 = 0.157 < 0.2 also true — craft healthy ratio instead
        const pre = 'y'.repeat(150); // 150 chars
        const decision = applyFallback({
            ...base,
            content: post,
            contentBytes: getByteSize(post),
            preCleanseText: pre,
            preCleanseChars: pre.length,
            postCleanseChars: post.length, // 80/150 = 0.53 healthy → absolute arm decides
        });
        expect(decision.fallbackTriggered).toBe(true);
        expect(decision.fallbackReason).toBe('content_overcut');
        expect(decision.content).toBe(pre);
    });

    it('does not fire when the restore target is itself below the floor (body is strictly better)', () => {
        const pre = 'z'.repeat(60); // restore would still be starved
        const post = 'w'.repeat(10);
        const decision = applyFallback({
            ...base,
            content: post,
            contentBytes: getByteSize(post),
            preCleanseText: pre,
            preCleanseChars: pre.length,
            postCleanseChars: post.length, // relative cut fires the ratio arm…
        });
        // …but pre < minChars blocks ②; no ③ pair, content <100 → short_content body.
        expect(decision.fallbackTriggered).toBe(true);
        expect(decision.fallbackReason).toBe('short_content');
        expect(decision.content).toBe('BODY FALLBACK TEXT');
    });

    it('② wins over ③ when both pairs are armed (priority pin)', () => {
        const post = 'tiny';
        const decision = applyFallback({
            ...base,
            content: post,
            contentBytes: getByteSize(post),
            preCleanseText: preCleanse,
            preCleanseChars: preCleanse.length,
            postCleanseChars: post.length,
            preAiCleanseText: 'pre ai text '.repeat(20),
            aiSummaryOriginalBytes: 10000,
        });
        expect(decision.fallbackReason).toBe('content_overcut');
        expect(decision.usePreAiText).toBe(false);
    });

    it('ratio exactly at fallbackRatio does not fire (strict <)', () => {
        const pre = 'a'.repeat(500);
        const post = 'b'.repeat(100); // 100/500 === 0.20 exactly; post === minChars (not <)
        const decision = applyFallback({
            ...base,
            content: post,
            contentBytes: getByteSize(post),
            preCleanseText: pre,
            preCleanseChars: pre.length,
            postCleanseChars: post.length,
        });
        expect(decision.fallbackTriggered).toBe(false);
    });

    it('post exactly at minChars with healthy ratio does not fire', () => {
        const pre = 'a'.repeat(1000);
        const post = 'b'.repeat(100); // 100/1000 = 0.10 < 0.2 → ratio arm WOULD fire…
        // …so use a healthy ratio for this boundary: 300/1000 = 0.30
        const decision = applyFallback({
            ...base,
            content: 'c'.repeat(300),
            contentBytes: getByteSize('c'.repeat(300)),
            preCleanseText: pre,
            preCleanseChars: pre.length,
            postCleanseChars: 300, // 0.30 healthy, 300 >= 100 → no fire
        });
        expect(decision.fallbackTriggered).toBe(false);
    });

    it('unchanged content (post === pre) never fires ②', () => {
        const decision = applyFallback({
            ...base,
            content: preCleanse,
            contentBytes: getByteSize(preCleanse),
            preCleanseText: preCleanse,
            preCleanseChars: preCleanse.length,
            postCleanseChars: preCleanse.length,
        });
        expect(decision.fallbackTriggered).toBe(false);
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
