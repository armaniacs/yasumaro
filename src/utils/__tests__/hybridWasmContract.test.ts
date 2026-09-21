/**
 * hybridWasmContract.test.ts
 * Shared WASM-hybrid contract suite over all 3 hybrids
 * (piiSanitizeHybrid / sentenceExtractorHybrid / contentDedupHybrid).
 *
 * Pins CURRENT behavior before the shared-runtime refactor
 * (PBI 2026-09-20-13), and must pass UNCHANGED after it:
 * - split-count mismatch -> TS fallback + a single warn (no silent mis-map)
 * - out-of-range options (NaN / u32-overflow) -> TS path WITHOUT a WASM call
 * - PII size-limit error strings identical between the TS and WASM paths
 * - byte-equal outputs vs the TS reference on representative inputs
 *
 * Absorbs the three per-hybrid unavailable-path suites. Probe-caching
 * assertions from those suites are intentionally NOT carried over: the
 * runtime adopts the tagCooccurrenceHybrid probe contract (success cached
 * permanently / failure re-probed next call / warn at most once per failure
 * burst), which contradicts the old "failure cached forever" pins.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractSentences } from '../sentenceExtractor.js';
import { deduplicateContent } from '../contentDeduplicator.js';
import {
    sanitizeRegex,
    MAX_INPUT_SIZE,
    MAX_SKIP_SIZE,
    MAX_OUTPUT_SIZE,
} from '../piiSanitizer.js';

vi.mock('../../wasm/textrank/index.js', () => ({
    initTextrankWasm: vi.fn().mockRejectedValue(new Error('fetch not implemented in this environment')),
    extractTopIndicesWithWasm: vi.fn(),
}));

vi.mock('../../wasm/sentence-dedup/index.js', () => ({
    initSentenceDedupWasm: vi.fn().mockRejectedValue(new Error('fetch not implemented in this environment')),
    deduplicateIndicesWithWasm: vi.fn(),
}));

vi.mock('../../wasm/pii-sanitizer/index.js', () => ({
    initPiiSanitizerWasm: vi.fn().mockRejectedValue(new Error('fetch not implemented in this environment')),
    sanitizePiiWithWasm: vi.fn(),
}));

const TEXTRANK_TEXT =
    'The first sentence introduces the topic with enough words to qualify. ' +
    'The second sentence continues the discussion in a related direction. ' +
    'The third sentence diverges into an entirely different subject area. ' +
    'The fourth sentence returns to the original topic once again here.';

const DEDUP_TEXT = 'alpha beta gamma. alpha beta gamma. delta epsilon zeta.';
// The dedup hybrid routes inputs under 4KB to TS, so WASM-path contract
// cases need an input above that floor.
const DEDUP_BIG_TEXT = DEDUP_TEXT.repeat(100);

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Explicit defaults: mockResolvedValue overrides from an earlier test
    // survive clearAllMocks (it only clears call history), so re-pin the
    // WASM-down baseline after every reset.
    const unavailable = () => Promise.reject(new Error('fetch not implemented in this environment'));
    const textrank = await import('../../wasm/textrank/index.js');
    vi.mocked(textrank.initTextrankWasm).mockImplementation(unavailable);
    vi.mocked(textrank.extractTopIndicesWithWasm).mockImplementation(unavailable);
    const dedup = await import('../../wasm/sentence-dedup/index.js');
    vi.mocked(dedup.initSentenceDedupWasm).mockImplementation(unavailable);
    vi.mocked(dedup.deduplicateIndicesWithWasm).mockImplementation(unavailable);
    const pii = await import('../../wasm/pii-sanitizer/index.js');
    vi.mocked(pii.initPiiSanitizerWasm).mockImplementation(unavailable);
    vi.mocked(pii.sanitizePiiWithWasm).mockImplementation(unavailable);
});

afterEach(() => {
    warnSpy.mockRestore();
});

describe('hybrid WASM contract: split-count mismatch falls back to TS', () => {
    test('textrank: disagreeing wasm split -> TS result + single warn', async () => {
        const { extractSentencesHybrid } = await import('../sentenceExtractorHybrid.js');
        const wasm = await import('../../wasm/textrank/index.js');
        vi.mocked(wasm.initTextrankWasm).mockResolvedValue(undefined);
        vi.mocked(wasm.extractTopIndicesWithWasm).mockResolvedValue({
            indices: [0],
            sentenceCount: 999,
        });

        const result = await extractSentencesHybrid(TEXTRANK_TEXT, { topK: 2 });
        expect(result).toEqual(extractSentences(TEXTRANK_TEXT, { topK: 2 }));
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    test('dedup: disagreeing wasm split -> TS result + single warn', async () => {
        const { deduplicateContentHybrid } = await import('../contentDedupHybrid.js');
        const wasm = await import('../../wasm/sentence-dedup/index.js');
        vi.mocked(wasm.initSentenceDedupWasm).mockResolvedValue(undefined);
        vi.mocked(wasm.deduplicateIndicesWithWasm).mockResolvedValue({
            indices: [0],
            sentenceCount: 999,
        });

        const result = await deduplicateContentHybrid(DEDUP_BIG_TEXT);
        expect(result).toBe(deduplicateContent(DEDUP_BIG_TEXT));
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    test('textrank: out-of-range wasm indices -> TS result + single warn', async () => {
        const { extractSentencesHybrid } = await import('../sentenceExtractorHybrid.js');
        const wasm = await import('../../wasm/textrank/index.js');
        vi.mocked(wasm.initTextrankWasm).mockResolvedValue(undefined);
        // Count agrees (4) but index 7 is out of range: must not mis-map.
        vi.mocked(wasm.extractTopIndicesWithWasm).mockResolvedValue({
            indices: [7],
            sentenceCount: 4,
        });

        const result = await extractSentencesHybrid(TEXTRANK_TEXT, { topK: 2 });
        expect(result).toEqual(extractSentences(TEXTRANK_TEXT, { topK: 2 }));
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });
});

describe('hybrid WASM contract: out-of-range options bypass WASM', () => {
    test('textrank: NaN / non-u32 options take the TS path without a WASM call', async () => {
        const { extractSentencesHybrid } = await import('../sentenceExtractorHybrid.js');
        const wasm = await import('../../wasm/textrank/index.js');

        await extractSentencesHybrid(TEXTRANK_TEXT, { topK: 0 });
        await extractSentencesHybrid(TEXTRANK_TEXT, { minLength: 2.5 });
        await extractSentencesHybrid(TEXTRANK_TEXT, { similarityThreshold: Number.NaN });
        await extractSentencesHybrid(TEXTRANK_TEXT, { topK: 2 ** 32 + 1 });

        expect(wasm.initTextrankWasm).not.toHaveBeenCalled();
        expect(wasm.extractTopIndicesWithWasm).not.toHaveBeenCalled();
        await expect(extractSentencesHybrid(TEXTRANK_TEXT, { topK: 2 ** 32 + 1 })).resolves.toEqual(
            extractSentences(TEXTRANK_TEXT, { topK: 2 ** 32 + 1 })
        );
    });

    test('textrank: u32 boundary value still reaches WASM', async () => {
        const { extractSentencesHybrid } = await import('../sentenceExtractorHybrid.js');
        const wasm = await import('../../wasm/textrank/index.js');

        await extractSentencesHybrid(TEXTRANK_TEXT, { topK: 0xffffffff });
        expect(wasm.initTextrankWasm).toHaveBeenCalledTimes(1);
    });

    test('dedup: NaN / non-u32 options take the TS path without a WASM call', async () => {
        const { deduplicateContentHybrid } = await import('../contentDedupHybrid.js');
        const wasm = await import('../../wasm/sentence-dedup/index.js');

        expect(await deduplicateContentHybrid(DEDUP_TEXT, { threshold: Number.NaN })).toBe(
            deduplicateContent(DEDUP_TEXT, { threshold: Number.NaN })
        );
        expect(await deduplicateContentHybrid(DEDUP_TEXT, { minLength: 1.5 })).toBe(
            deduplicateContent(DEDUP_TEXT, { minLength: 1.5 })
        );
        expect(await deduplicateContentHybrid(DEDUP_TEXT, { minLength: -1 })).toBe(
            deduplicateContent(DEDUP_TEXT, { minLength: -1 })
        );
        expect(await deduplicateContentHybrid(DEDUP_TEXT, { minLength: 2 ** 32 })).toBe(
            deduplicateContent(DEDUP_TEXT, { minLength: 2 ** 32 })
        );
        expect(wasm.initSentenceDedupWasm).not.toHaveBeenCalled();
        expect(wasm.deduplicateIndicesWithWasm).not.toHaveBeenCalled();
    });
});

describe('hybrid WASM contract: PII size-limit error strings are single-sourced', () => {
    async function importPiiWasmPath() {
        const wasm = await import('../../wasm/pii-sanitizer/index.js');
        vi.mocked(wasm.initPiiSanitizerWasm).mockResolvedValue(undefined);
        vi.mocked(wasm.sanitizePiiWithWasm).mockResolvedValue({
            text: 'contact [MASKED:email] now',
            maskedItems: [{ type: 'email', original: 'user@example.com', index: 8 }],
        });
        const { sanitizePiiHybrid } = await import('../../background/pipeline/piiSanitizeHybrid.js');
        return sanitizePiiHybrid;
    }

    test('oversized input: WASM-path error === TS-path error', async () => {
        const sanitizePiiHybrid = await importPiiWasmPath();
        const oversized = `contact user@example.com ${'filler '.repeat(10_000)}`;
        expect(oversized.length).toBeGreaterThan(MAX_INPUT_SIZE);

        const [wasmPath, tsPath] = await Promise.all([
            sanitizePiiHybrid(oversized),
            sanitizeRegex(oversized),
        ]);
        expect(wasmPath.error).toBeDefined();
        expect(wasmPath.error).toBe(tsPath.error);
        expect(wasmPath.error).toContain(`Input size exceeds maximum limit of ${MAX_INPUT_SIZE}`);
        // Masking still delivered alongside the error.
        expect(wasmPath.text).toContain('[MASKED:email]');
    });

    test('skipSizeLimit hard cap: WASM-path error === TS-path error', async () => {
        const sanitizePiiHybrid = await importPiiWasmPath();
        const huge = 'x'.repeat(MAX_SKIP_SIZE + 1);

        const [wasmPath, tsPath] = await Promise.all([
            sanitizePiiHybrid(huge, { skipSizeLimit: true }),
            sanitizeRegex(huge, { skipSizeLimit: true }),
        ]);
        expect(wasmPath.error).toBe(tsPath.error);
        expect(wasmPath.error).toContain('even with skipSizeLimit');
    });

    test('output truncation error comes from the shared constant', async () => {
        const sanitizePiiHybrid = await importPiiWasmPath();
        const wasm = await import('../../wasm/pii-sanitizer/index.js');
        vi.mocked(wasm.sanitizePiiWithWasm).mockResolvedValue({
            text: 'x'.repeat(MAX_OUTPUT_SIZE + 10),
            maskedItems: [],
        });

        const result = await sanitizePiiHybrid('small input');
        expect(result.error).toBe(`Output truncated to ${MAX_OUTPUT_SIZE} characters`);
        expect(result.text.length).toBe(MAX_OUTPUT_SIZE);
    });
});

describe('hybrid WASM contract: byte-equal outputs on representative inputs', () => {
    test('all 3 hybrids fall back to byte-identical TS results when WASM is down', async () => {
        const { extractSentencesHybrid } = await import('../sentenceExtractorHybrid.js');
        const { deduplicateContentHybrid } = await import('../contentDedupHybrid.js');
        const { sanitizePiiHybrid } = await import('../../background/pipeline/piiSanitizeHybrid.js');

        await expect(extractSentencesHybrid(TEXTRANK_TEXT, { topK: 2 })).resolves.toEqual(
            extractSentences(TEXTRANK_TEXT, { topK: 2 })
        );
        await expect(deduplicateContentHybrid(DEDUP_TEXT)).resolves.toBe(
            deduplicateContent(DEDUP_TEXT)
        );
        const pii = await sanitizePiiHybrid('contact me at user@example.com');
        expect(pii.text).toBe('contact me at [MASKED:email]');
        expect(pii.maskedItems).toHaveLength(1);
    });

    test('dedup per-core policies survive: threshold-0 and empty inputs bypass WASM', async () => {
        const { deduplicateContentHybrid } = await import('../contentDedupHybrid.js');
        const wasm = await import('../../wasm/sentence-dedup/index.js');

        expect(await deduplicateContentHybrid('same. same. same.', { threshold: 0 })).toBe(
            'same. same. same.'
        );
        expect(await deduplicateContentHybrid('')).toBe('');
        expect(await deduplicateContentHybrid('   ')).toBe('   ');
        expect(wasm.initSentenceDedupWasm).not.toHaveBeenCalled();
    });

    test('textrank per-core policy survives: empty input bypasses WASM', async () => {
        const { extractSentencesHybrid } = await import('../sentenceExtractorHybrid.js');
        const wasm = await import('../../wasm/textrank/index.js');

        expect(await extractSentencesHybrid('')).toEqual([]);
        expect(await extractSentencesHybrid('   \n\t')).toEqual([]);
        expect(wasm.initTextrankWasm).not.toHaveBeenCalled();
    });
});
