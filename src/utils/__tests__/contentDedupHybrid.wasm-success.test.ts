/**
 * contentDedupHybrid.wasm-success.test.ts
 * WASMが正常に初期化・動作する経路（WASM core + JS再構築の単一パス）を
 * 検証する。Node の file 読み込みでWASM初期化を成功させ（wasm wrapper を
 * vi.mock）、TS実装 deduplicateContent との完全一致を確認する。
 *
 * contentDedupHybrid.test.ts はWASM初期化失敗時のフォールバック経路を
 * 検証する（piiSanitizeHybrid.test.ts /
 * piiSanitizeHybrid.wasm-success.test.ts と同じ二分パターン）。
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, test, expect, vi, beforeAll } from 'vitest';
import initWasmModule from '../../wasm/sentence-dedup/sentenceDedupWasm.js';

vi.mock('../../wasm/sentence-dedup/index.js', async () => {
    const wasmPath = fileURLToPath(
        new URL('../../wasm/sentence-dedup/sentence_dedup_bg.wasm', import.meta.url)
    );
    let initPromise: Promise<void> | null = null;

    async function initSentenceDedupWasm(): Promise<void> {
        if (!initPromise) {
            initPromise = readFile(wasmPath).then(async (bytes) => {
                await initWasmModule({ module_or_path: bytes });
            });
        }
        return initPromise;
    }

    const { deduplicateIndices } = await import(
        '../../wasm/sentence-dedup/sentenceDedupWasm.js'
    );

    return {
        initSentenceDedupWasm,
        deduplicateIndicesWithWasm: async (
            text: string,
            options: { threshold: number; minLength: number }
        ) => {
            await initSentenceDedupWasm();
            const result = deduplicateIndices(text, options.threshold, options.minLength) as {
                readonly indices: Uint32Array;
                readonly sentenceCount: number;
            };
            return { indices: Array.from(result.indices), sentenceCount: result.sentenceCount };
        },
    };
});

describe('deduplicateContentHybrid (WASM available)', () => {
    beforeAll(async () => {
        // Warm the mocked WASM module before the suite runs.
        const { initSentenceDedupWasm } = await import('../../wasm/sentence-dedup/index.js');
        await initSentenceDedupWasm();
    });

    test('removes a duplicate English sentence via the WASM path', async () => {
        const { deduplicateContentHybrid } = await import('../contentDedupHybrid.js');
        const input = 'alpha beta gamma. alpha beta gamma. delta epsilon zeta.';
        expect(await deduplicateContentHybrid(input)).toBe(
            'alpha beta gamma.  delta epsilon zeta.'
        );
    });

    test('removes a duplicate Japanese sentence via bigram similarity', async () => {
        const { deduplicateContentHybrid } = await import('../contentDedupHybrid.js');
        const input = 'これはテスト用の文章です。これはテスト用の文章です。別の内容を含む文です。';
        expect(await deduplicateContentHybrid(input)).toBe(
            'これはテスト用の文章です。別の内容を含む文です。'
        );
    });

    test('matches the TS implementation byte-for-byte across the corpus', async () => {
        const { deduplicateContentHybrid } = await import('../contentDedupHybrid.js');
        const { deduplicateContent } = await import('../contentDeduplicator.js');
        const cases: Array<[string, { threshold?: number; minLength?: number }?]> = [
            ['First. Second! Third? tail'],
            ['a. b.'],
            ['a. .b'],
            ['. .'],
            ['a. '],
            ['x! ?y'],
            ['hi. hello world today. hello world today again.'],
            ['hi. hello world today. hello world today. hello world today again.', { threshold: 0.5 }],
            ['AB CD. AB CD EF GH IJ KL.', { threshold: 0.3 }],
            ['alpha beta. alpha beta. alpha gamma.', { threshold: 1 }],
            ['one two three. four five six.', { threshold: -0.5 }],
            ['-----!,,,,,', { minLength: 3 }],
            ['-----!ab,', { minLength: 3 }],
            ['Emojis 🎉🚀 stay intact. Emojis 🎉🚀 stay intact. Other words here.'],
            ['日本語とEnglish mixed テキストです。日本語とEnglish mixed テキストです。続いて別の文。'],
            ['no delimiters at all in this text'],
        ];
        for (const [text, options] of cases) {
            expect(await deduplicateContentHybrid(text, options)).toBe(
                deduplicateContent(text, options)
            );
        }
    });

    test('matches the TS implementation on an input large enough to take the WASM path', async () => {
        // The hybrid routes inputs under MIN_WASM_INPUT_CHARS (4,096) to the
        // TS path, so this >4KB case is what actually exercises the WASM
        // core through the hybrid. Below the fail-open cap the two engines
        // must still agree byte-for-byte.
        const { deduplicateContentHybrid } = await import('../contentDedupHybrid.js');
        const { deduplicateContent } = await import('../contentDeduplicator.js');
        const input =
            'The recording pipeline compresses page content before every AI summary request. ' +
            'This sentence repeats over and over again to exercise the deduplication scan. '.repeat(60);
        expect(input.length).toBeGreaterThan(4096);
        const parts = input.split(/(?<=[.!?。！？])\s*/).length;
        expect(parts).toBeGreaterThan(10);
        expect(await deduplicateContentHybrid(input)).toBe(deduplicateContent(input));
    });

    test('a single-part split returns the text unchanged (early-return parity)', async () => {
        const { deduplicateContentHybrid } = await import('../contentDedupHybrid.js');
        expect(await deduplicateContentHybrid('. .')).toBe('. .');
        expect(await deduplicateContentHybrid('one sentence only')).toBe('one sentence only');
    });

    test('empty and threshold-0 inputs bypass WASM entirely', async () => {
        const { deduplicateContentHybrid } = await import('../contentDedupHybrid.js');
        expect(await deduplicateContentHybrid('   ')).toBe('   ');
        expect(await deduplicateContentHybrid('same. same. same.', { threshold: 0 })).toBe(
            'same. same. same.'
        );
    });
});
