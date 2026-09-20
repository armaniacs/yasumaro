/**
 * Parity check: for every corpus input below, the WASM dedup core's
 * (indices + count) mapped back through the identical JS split must
 * reconstruct EXACTLY what the TS deduplicateContent() returns. This is the
 * regression gate for the WASM port: any wasm/*.rs change that breaks
 * parity here must not ship (same gate contract as the pii-sanitizer
 * parity suite).
 *
 * The corpus covers the verified TS boundary quirks: delimiter-keeping
 * split, whitespace duplication on kept boundaries, adjacent/leading
 * delimiters, whitespace-only tails, CJK bigram similarity, case-sensitive
 * bigrams, empty-set Jaccard (punctuation-only sentences), threshold 0/1,
 * negative thresholds, and astral-plane characters.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, test, expect, beforeAll } from 'vitest';
import { deduplicateContent, splitSentencesKeepDelimiters } from '../../../utils/contentDeduplicator.js';
import initWasmModule, { deduplicateIndices } from '../sentenceDedupWasm.js';

const CORPUS: Array<{ text: string; threshold?: number; minLength?: number }> = [
    { text: 'alpha beta gamma. alpha beta gamma. delta epsilon zeta.' },
    { text: 'これはテスト用の文章です。これはテスト用の文章です。別の内容を含む文です。' },
    { text: 'First. Second! Third? tail' },
    { text: 'a. b.' },
    { text: 'a. .b' },
    { text: '. .' },
    { text: 'a. ' },
    { text: 'x! ?y' },
    { text: 'hi. hello world today. hello world today again.' },
    { text: 'hi. hello world today. hello world today. hello world today again.', threshold: 0.5 },
    { text: 'AB CD. AB CD EF GH IJ KL.', threshold: 0.3 },
    { text: 'alpha beta. alpha beta. alpha gamma.', threshold: 1 },
    { text: 'one two three. four five six.', threshold: -0.5 },
    { text: '-----!,,,,,', minLength: 3 },
    { text: '-----!ab,', minLength: 3 },
    { text: 'same. same. same.', threshold: 0 },
    { text: 'Emojis 🎉🚀 stay intact. Emojis 🎉🚀 stay intact. Other words here.' },
    { text: 'The quick brown fox jumps. The quick brown fox jumps over. Different content entirely.' },
    { text: '日本語とEnglish mixed テキストです。日本語とEnglish mixed テキストです。続いて別の文。' },
    { text: 'no delimiters at all in this text' },
    { text: '' },
    { text: '   ' },
    { text: 'A single sentence.' },
];

async function initForNode(): Promise<void> {
    const wasmPath = fileURLToPath(new URL('../sentence_dedup_bg.wasm', import.meta.url));
    const bytes = await readFile(wasmPath);
    await initWasmModule({ module_or_path: bytes });
}

/**
 * Reconstructs the deduped text the same way the production hybrid does:
 * early returns first (empty text, threshold 0 — both return the text
 * BEFORE any scan, exactly like deduplicateContent), then WASM indices +
 * the identical JS split. Throws on the split-agreement gates so a contract
 * violation surfaces as a test failure, not silent divergence.
 *
 * The threshold-0 placement is load-bearing: returning "all indices" from
 * the core and reconstructing would double the whitespace between kept
 * parts, while the TS reference returns the text untouched.
 */
function dedupWithWasm(
    text: string,
    threshold: number,
    minLength: number
): string {
    if (!text.trim() || threshold === 0) {
        return text;
    }
    const result = deduplicateIndices(text, threshold, minLength) as {
        readonly indices: Uint32Array;
        readonly sentenceCount: number;
    };
    const parts = splitSentencesKeepDelimiters(text);
    if (result.sentenceCount !== parts.length) {
        throw new Error(
            `wasm split mismatch (wasm ${result.sentenceCount} vs js ${parts.length} parts)`
        );
    }
    const indices = Array.from(result.indices);
    if (indices.some((i) => i < 0 || i >= parts.length)) {
        throw new Error(`wasm returned out-of-range indices (${indices.length} indices)`);
    }
    if (parts.length <= 1) {
        return text;
    }
    return indices.map((i) => parts[i]!.sentence + parts[i]!.delimiter).join('');
}

describe('WASM vs TS dedup parity', () => {
    beforeAll(async () => {
        await initForNode();
    });

    test.each(CORPUS)('corpus %# matches TS output exactly', (c) => {
        const { text, threshold, minLength } = c;
        const ts = deduplicateContent(text, { threshold, minLength });
        const wasm = dedupWithWasm(text, threshold ?? 0.7, minLength ?? 10);
        expect(wasm).toBe(ts);
    });

    test('sentences beyond the fail-open cap diverge from the uncapped TS path', () => {
        // Contract pin for MAX_SENTENCES_FOR_DEDUP: above 1000 parts the
        // WASM path keeps the tail unconditionally (fail-open, no content
        // dropped) while the TS reference would keep deduping. The two
        // paths are byte-identical below the cap (the corpus above).
        const identical = 'duplicate content repeated here. '.repeat(1100);
        const result = deduplicateIndices(identical, 0.7, 10) as {
            readonly indices: Uint32Array;
            readonly sentenceCount: number;
        };
        const indices = Array.from(result.indices);
        expect(result.sentenceCount).toBe(1101);
        expect(indices[0]).toBe(0);
        // Only the first head part survives the pairwise scan...
        expect(indices.filter((i) => i < 1000)).toEqual([0]);
        // ...and the tail is appended unconditionally.
        expect(indices.slice(1)).toEqual(
            Array.from({ length: 101 }, (_, k) => 1000 + k)
        );
    });
});
