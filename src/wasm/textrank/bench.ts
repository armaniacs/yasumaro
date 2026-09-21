/**
 * Micro-benchmark: TS TextRank extraction vs. WASM extraction, same inputs.
 *
 * Run with: npx tsx src/wasm/textrank/bench.ts
 *
 * Not part of the CI suite — this is a standalone comparison script for
 * manual verification when touching either implementation, mirroring
 * src/wasm/pii-sanitizer/bench.ts. See bench/README.md for the project's
 * actual benchmark harness; this script stays separate since it exercises a
 * WASM module the main bench harness's node environment doesn't initialize.
 */

import { extractSentences } from '../../utils/sentenceExtractor.js';
import { splitSentences } from '../../utils/text/tokenizer.js';
import initWasmModule, { extractTopIndices } from './textrankWasm.js';
import { initWasmForNode } from '../testing/initWasmForNode.js';

// Node has no extension-page fetch(file://) support, unlike the Chrome
// service worker this module targets in production — read the binary
// directly instead of going through initTextrankWasm().
async function initForNode(): Promise<void> {
    await initWasmForNode(initWasmModule, new URL('./textrank_bg.wasm', import.meta.url));
}

function extractWithWasm(text: string, topK: number, minLength: number, threshold: number): string[] {
    const result = extractTopIndices(text, topK, minLength, threshold) as {
        readonly indices: Uint32Array;
        readonly sentenceCount: number;
    };
    const sentences = splitSentences(text);
    if (result.sentenceCount !== sentences.length) {
        throw new Error(
            `wasm split mismatch (wasm ${result.sentenceCount} vs js ${sentences.length} sentences)`
        );
    }
    return Array.from(result.indices).map((i) => sentences[i]!);
}

function buildSampleText(repeats: number): string {
    const paragraph =
        'The recording pipeline compresses page content before every AI summary request. ' +
        'TextRank builds a sentence similarity graph and ranks each sentence by importance. ' +
        '日本語の文章では単語境界が曖昧なため、文字バイグラムで類似度を計算します。 ' +
        'WebAssembly moves the quadratic similarity matrix out of the JavaScript heap. ';
    return paragraph.repeat(repeats);
}

async function timeIt(
    label: string,
    fn: () => unknown,
    iterations: number
): Promise<number> {
    for (let i = 0; i < 3; i++) fn(); // warm up (JIT / wasm compile cache)
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    const duration = performance.now() - start;
    console.log(`${label}: ${(duration / iterations).toFixed(3)} ms/op (${iterations} ops)`);
    return duration / iterations;
}

async function main(): Promise<void> {
    await initForNode();

    for (const repeats of [5, 40]) {
        const text = buildSampleText(repeats);
        const sentenceCount = splitSentences(text).length;
        console.log(`\n--- ${repeats}x paragraph (~${text.length} chars, ${sentenceCount} sentences) ---`);

        const ts = await timeIt('TS  extractSentences ', () => extractSentences(text, { topK: 10 }), 50);
        const wasm = await timeIt('WASM extractTopIndices', () => extractWithWasm(text, 10, 20, 0.3), 50);

        // Parity spot check on this corpus: identical selection, or the
        // difference is a bug in one of the two implementations.
        const tsResult = extractSentences(text, { topK: 10 });
        const wasmResult = extractWithWasm(text, 10, 20, 0.3);
        const parity = JSON.stringify(tsResult) === JSON.stringify(wasmResult);
        console.log(`parity on this corpus: ${parity ? 'OK' : 'MISMATCH'}`);
        if (!parity) process.exitCode = 1;
        console.log(`speedup: ${(ts / wasm).toFixed(2)}x`);
    }
}

void main();
