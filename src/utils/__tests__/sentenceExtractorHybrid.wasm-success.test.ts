/**
 * sentenceExtractorHybrid.wasm-success.test.ts
 * WASMが正常に初期化・動作する経路を検証し、TS参照実装
 * (src/utils/sentenceExtractor.ts) との選択結果の完全な一致を担保する。
 *
 * Node環境ではextension-context fetchが使えないため、wasmバイナリを
 * ディスクから直接読み込んで初期化する (piiSanitizeHybrid.wasm-success
 * .test.ts と同じパターン)。
 */

import { describe, test, expect, vi, beforeAll } from 'vitest';
import initWasmModule from '../../wasm/textrank/textrankWasm.js';
import { extractSentences, type ExtractOptions } from '../sentenceExtractor.js';
import { splitSentences } from '../text/tokenizer.js';

vi.mock('../../wasm/textrank/index.js', async () => {
    const { createNodeWasmInit } = await import('../../wasm/testing/initWasmForNode.js');
    const initTextrankWasm = createNodeWasmInit(
        initWasmModule,
        new URL('../../wasm/textrank/textrank_bg.wasm', import.meta.url)
    );

    const { extractTopIndices } = await import('../../wasm/textrank/textrankWasm.js');

    return {
        initTextrankWasm,
        extractTopIndicesWithWasm: async (
            text: string,
            options: { topK: number; minLength: number; similarityThreshold: number }
        ) => {
            await initTextrankWasm();
            const result = extractTopIndices(
                text,
                options.topK,
                options.minLength,
                options.similarityThreshold
            ) as { readonly indices: Uint32Array; readonly sentenceCount: number };
            return {
                indices: Array.from(result.indices),
                sentenceCount: result.sentenceCount,
            };
        },
    };
});

const LONG_TEXT = [
    'Machine learning models process large volumes of text data every single day.',
    'Extractive summarization selects the most important sentences from a document.',
    'TextRank builds a similarity graph and applies PageRank to rank the sentences.',
    'The algorithm was originally proposed by Mihalcea and Tarau in two thousand four.',
    'Japanese text requires character bigrams because word boundaries are ambiguous.',
    'Similarity between sentences is measured with the Jaccard coefficient over tokens.',
    'The service worker executes this extraction synchronously on every page recording.',
    'WebAssembly moves the quadratic similarity matrix out of the JavaScript heap.',
    'Sentence selection quality matters more than raw extraction speed for users.',
    'The extraction step reduces AI token costs by compressing the input text.',
    'A final sentence rounds out the corpus so the graph has more than ten nodes.',
].join(' ');

const JAPANESE_TEXT = [
    '機械学習モデルは毎日大量のテキストデータを処理しています。',
    '抽出型要約は文書から最も重要な文を選択する手法です。',
    'TextRankは類似度グラフを構築し、PageRankで文をランク付けします。',
    '日本語は単語境界が曖昧なため、文字バイグラムで類似度を測ります。',
    'サービスワーカーは記録のたびにこの抽出を同期的に実行します。',
    'WebAssemblyは二次の類似度計算をJavaScriptヒープの外へ移動させます。',
    '文選択の品質は生の抽出速度よりもユーザーにとって重要です。',
    '最後の文がコーパスを締めくくり、グラフは十ノードを超えます。',
].join('');

async function importHybrid() {
    return import('../sentenceExtractorHybrid.js');
}

describe('extractSentencesHybrid (WASM available)', () => {
    beforeAll(async () => {
        const { initTextrankWasm } = await import('../../wasm/textrank/index.js');
        await initTextrankWasm();
    });

    const parityCases: Array<[string, ExtractOptions]> = [
        ['long English text, default options', [LONG_TEXT, {}]],
        ['long English text, topK 3', [LONG_TEXT, { topK: 3, minLength: 10, similarityThreshold: 0.1 }]],
        ['long Japanese text', [JAPANESE_TEXT, {}]],
        ['long Japanese text, aggressive threshold', [JAPANESE_TEXT, { topK: 2, minLength: 30, similarityThreshold: 0.05 }]],
        [
            'mixed language with emoji and CJK punctuation',
            [
                'Emojis like 🙂 and 👍 count as two UTF-16 units each! ' +
                    '日本語の文も混ぜて、句読点。「括弧」も含めます。 ' +
                    'Mixed text exercises the separator class across both scripts. ' +
                    'Another English sentence to fill out the similarity graph. ' +
                    'And a fifth sentence with numbers 12345 and symbols #$%. ' +
                    'The sixth sentence closes this mixed-language corpus.',
                { topK: 2 },
            ],
        ],
        ['fewer sentences than topK returns them unchanged', [LONG_TEXT.split('. ').slice(0, 3).join('. ') + '.', { topK: 10 }]],
        ['all sentences shorter than minLength', ['Short one. Another short. Tiny.', { topK: 1, minLength: 50 }]],
        ['adjacent delimiters', ['One..Two..Three..Four..Five..Six..Seven..Eight..Nine..Ten..Eleven..Twelve..', {}]],
        [
            'whitespace-separated adjacent delimiters (lastIndex regression)',
            ['Hmm. . ok! ! yes. . . final. ' + 'Filler one has enough words here. ' + 'Filler two keeps the graph busy. ' + 'Filler three ends the corpus.', {}],
        ],
    ];

    test.each(parityCases)('parity: %s', async (_label, [text, options]) => {
        const { extractSentencesHybrid } = await importHybrid();
        const result = await extractSentencesHybrid(text as string, options as ExtractOptions);
        expect(result).toEqual(extractSentences(text as string, options as ExtractOptions));
    });

    test('parity at the VULN-051 sentence cap (MAX_SENTENCES_FOR_TEXTRANK)', async () => {
        // Cross-language cap gate: computeLimits.ts caps the TS selection at
        // 200 sentences and the Rust core hardcodes the same cap. If either
        // side changes, selection over a >cap corpus diverges and this
        // parity assertion fails.
        const { extractSentencesHybrid } = await importHybrid();
        const text = Array.from(
            { length: 250 },
            (_, i) => `Sentence number ${i} carries unique filler content for the graph.`
        ).join(' ');
        const options: ExtractOptions = { topK: 10, minLength: 1, similarityThreshold: 0.3 };
        const result = await extractSentencesHybrid(text, options);
        expect(result).toEqual(extractSentences(text, options));
        // Both paths selected from only the first 200 sentences (cap hit).
        expect(result.every((s) => splitSentences(text).indexOf(s) < 200)).toBe(true);
    });

    test('returns strings from the identical sentence split (no mutation of TS path)', async () => {
        const { extractSentencesHybrid } = await importHybrid();
        const result = await extractSentencesHybrid(LONG_TEXT, { topK: 3 });
        const sentences = splitSentences(LONG_TEXT);
        expect(result.every((s) => sentences.includes(s))).toBe(true);
        expect(new Set(result).size).toBe(result.length);
    });
});
