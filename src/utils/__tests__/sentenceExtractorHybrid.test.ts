/**
 * sentenceExtractorHybrid.test.ts
 * WASM初期化失敗・オプション境界でのTSフォールバック経路を検証する。
 * (WASM成功経路・パリティは sentenceExtractorHybrid.wasm-success.test.ts)
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { extractSentences } from '../sentenceExtractor.js';

// initTextrankWasm always fails in this Node test environment (no
// extension-page fetch(file://) support), which is exactly the fallback
// path this suite verifies.
vi.mock('../../wasm/textrank/index.js', () => ({
    initTextrankWasm: vi.fn().mockRejectedValue(new Error('fetch not implemented in this environment')),
    extractTopIndicesWithWasm: vi.fn(),
}));

describe('extractSentencesHybrid (WASM unavailable)', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
    });

    test('falls back to TS extraction when WASM init fails', async () => {
        const { extractSentencesHybrid } = await import('../sentenceExtractorHybrid.js');
        const text =
            'The first sentence introduces the topic with enough words to qualify. ' +
            'The second sentence continues the discussion in a related direction. ' +
            'The third sentence diverges into an entirely different subject area. ' +
            'The fourth sentence returns to the original topic once again here.';
        const result = await extractSentencesHybrid(text, { topK: 2 });
        expect(result).toEqual(extractSentences(text, { topK: 2 }));
    });

    test('caches the WASM-unavailable result so init is not retried per call', async () => {
        const { extractSentencesHybrid } = await import('../sentenceExtractorHybrid.js');
        const wasmModule = await import('../../wasm/textrank/index.js');
        const text = 'One two three four five six seven eight nine ten eleven twelve.';

        await extractSentencesHybrid(text);
        await extractSentencesHybrid(text);

        expect(wasmModule.initTextrankWasm).toHaveBeenCalledTimes(1);
    });

    test('bypasses WASM for options outside the JS->u32/f64 domain', async () => {
        const { extractSentencesHybrid } = await import('../sentenceExtractorHybrid.js');
        const wasmModule = await import('../../wasm/textrank/index.js');
        const text =
            'The first sentence introduces the topic with enough words to qualify. ' +
            'The second sentence continues the discussion in a related direction.';

        // topK < 1, negative minLength, fractional values — all JS-quirk
        // territory the u32 boundary would silently reinterpret.
        await extractSentencesHybrid(text, { topK: 0 });
        await extractSentencesHybrid(text, { minLength: -1 });
        await extractSentencesHybrid(text, { minLength: 2.5 });
        await extractSentencesHybrid(text, { similarityThreshold: Number.NaN });

        expect(wasmModule.initTextrankWasm).not.toHaveBeenCalled();
    });

    test('bypasses WASM for values >= 2^32 that ToUint32 would wrap', async () => {
        const { extractSentencesHybrid } = await import('../sentenceExtractorHybrid.js');
        const wasmModule = await import('../../wasm/textrank/index.js');
        const text =
            'Alpha sentence is here with plenty of words to pass. ' +
            'Beta sentence continues the graph strongly. ' +
            'Gamma sentence diverges into another topic entirely. ' +
            'Delta sentence closes the corpus.';

        // 2^32 + 1 wraps to u32 1 inside the wasm ABI: without the guard the
        // WASM path would extract a single sentence while the TS reference
        // (4 <= topK early return) returns all of them.
        await extractSentencesHybrid(text, { topK: 2 ** 32 + 1 });
        await extractSentencesHybrid(text, { topK: 2 ** 32 });
        await extractSentencesHybrid(text, { minLength: 2 ** 32 + 50 });
        await extractSentencesHybrid(text, { minLength: Number.MAX_SAFE_INTEGER });

        expect(wasmModule.initTextrankWasm).not.toHaveBeenCalled();

        // The bypass keeps output identical to the TS reference.
        await expect(extractSentencesHybrid(text, { topK: 2 ** 32 + 1 })).resolves.toEqual(
            extractSentences(text, { topK: 2 ** 32 + 1 })
        );
        // Boundary just inside the safe domain still reaches WASM.
        await extractSentencesHybrid(text, { topK: 0xffffffff });
        expect(wasmModule.initTextrankWasm).toHaveBeenCalledTimes(1);
    });

    test('empty/whitespace input returns empty without touching WASM', async () => {
        const { extractSentencesHybrid } = await import('../sentenceExtractorHybrid.js');
        const wasmModule = await import('../../wasm/textrank/index.js');
        expect(await extractSentencesHybrid('')).toEqual([]);
        expect(await extractSentencesHybrid('   \n\t')).toEqual([]);
        expect(wasmModule.initTextrankWasm).not.toHaveBeenCalled();
    });
});
