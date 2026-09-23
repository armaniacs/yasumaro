/**
 * Micro-benchmark: TS sentence dedup vs. WASM dedup, same inputs.
 *
 * Run with: npx tsx src/wasm/sentence-dedup/bench.ts
 *
 * Not part of the CI suite — this is a standalone comparison script for
 * manual verification when touching either implementation, mirroring
 * src/wasm/textrank/bench.ts. See bench/README.md for the project's actual
 * benchmark harness; this script stays separate since it exercises a WASM
 * module the main bench harness's node environment doesn't initialize.
 *
 * Benchmarking idea (what to look for): the dominant cost is the O(n^2)
 * pair scan over per-sentence word sets. The TS path allocates one
 * Set<string> per sentence plus Jaccard iteration objects on the JS heap;
 * the WASM path builds the same sets inside wasm linear memory and returns
 * only a Uint32Array of kept indices (plus one JS re-split pass). Expect
 * the gap to widen with sentence count (quadratic pair scan) and with
 * short sentences (set allocation dominates). Measure with --expose-gc in
 * a fresh process for stable numbers; medians over many iterations beat
 * single runs because wasm-bindgen string marshalling has a warmup cost.
 */

import { deduplicateContent, splitSentencesKeepDelimiters } from '../../utils/contentDeduplicator.js';
import initWasmModule, { deduplicateIndices } from './sentenceDedupWasm.js';
import { initWasmForNode } from '../testing/initWasmForNode.js';

// Node has no extension-page fetch(file://) support, unlike the Chrome
// service worker this module targets in production — read the binary
// directly instead of going through initSentenceDedupWasm().
async function initForNode(): Promise<void> {
    await initWasmForNode(initWasmModule, new URL('./sentence_dedup_bg.wasm', import.meta.url));
}

function dedupWithWasm(text: string, threshold: number, minLength: number): string {
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
    if (parts.length <= 1) {
        return text;
    }
    return Array.from(result.indices)
        .map((i) => parts[i]!.sentence + parts[i]!.delimiter)
        .join('');
}

function buildSampleText(repeats: number, withDuplicates: boolean): string {
    const paragraph =
        'The recording pipeline compresses page content before every AI summary request. ' +
        'TextRank builds a sentence similarity graph and ranks each sentence by importance. ' +
        '日本語の文章では単語境界が曖昧なため、文字バイグラムで類似度を計算します。 ' +
        'WebAssembly moves the quadratic similarity scan out of the JavaScript heap. ';
    const duplicate =
        'This sentence repeats over and over again to exercise the deduplication scan. ';
    return (paragraph + (withDuplicates ? duplicate : '')).repeat(repeats);
}

function timeIt(label: string, fn: () => unknown, iterations: number): number {
    for (let i = 0; i < 3; i++) fn(); // warm up (JIT / wasm compile cache)
    if (typeof globalThis.gc === 'function') globalThis.gc();
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    const duration = performance.now() - start;
    const perOp = duration / iterations;
    console.log(`${label}: ${perOp.toFixed(3)} ms/op (${iterations} ops)`);
    return perOp;
}

async function main(): Promise<void> {
    await initForNode();

    const scenarios = [
        { repeats: 5, withDuplicates: false, label: '~2KB, distinct sentences' },
        { repeats: 40, withDuplicates: false, label: '~16KB, distinct sentences' },
        { repeats: 40, withDuplicates: true, label: '~20KB, heavy duplicates' },
        { repeats: 150, withDuplicates: true, label: '~75KB, heavy duplicates' },
    ];

    for (const { repeats, withDuplicates, label } of scenarios) {
        const text = buildSampleText(repeats, withDuplicates);
        const partCount = splitSentencesKeepDelimiters(text).length;
        console.log(`\n--- ${label} (~${text.length} chars, ${partCount} parts) ---`);

        const ts = timeIt('TS  deduplicateContent', () => deduplicateContent(text), 30);
        const wasm = timeIt('WASM deduplicateIndices ', () => dedupWithWasm(text, 0.7, 10), 30);

        // Parity spot check on this corpus: identical output, or the
        // difference is a bug in one of the two implementations (below the
        // fail-open cap both paths must agree).
        if (partCount <= 1000) {
            const parity =
                deduplicateContent(text) === dedupWithWasm(text, 0.7, 10);
            console.log(`parity on this corpus: ${parity ? 'OK' : 'MISMATCH'}`);
            if (!parity) process.exitCode = 1;
        } else {
            console.log('parity: skipped (above MAX_SENTENCES_FOR_DEDUP — deliberate divergence)');
        }
        console.log(`speedup: ${(ts / wasm).toFixed(2)}x`);
    }
}

void main();
