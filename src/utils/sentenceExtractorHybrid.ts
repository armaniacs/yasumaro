/**
 * sentenceExtractorHybrid.ts
 * Hybrid TextRank extraction: runs the WASM core (see
 * wasm/textrank/src/lib.rs — an exact port of sentenceExtractor.ts) on the
 * success path and falls back to the TS implementation
 * (src/utils/sentenceExtractor.ts) when the WASM module fails to initialize
 * (e.g. CSP blocked the fetch, or an unsupported runtime) or when a WASM
 * call throws at runtime — L0 extraction must keep working wherever the
 * recording pipeline runs.
 *
 * Output parity: the WASM core returns indices into its own sentence split
 * plus the total count of that split; this wrapper re-splits the text with
 * the identical JS `splitSentences` and maps indices back to sentences only
 * after verifying the two splits agree (same sentence count; out-of-range
 * indices rejected as belt-and-braces). Any disagreement — or any WASM
 * failure — re-runs the TS path rather than emitting wrong output.
 *
 * Guard rails mirrored from the TS original (defense in depth, the WASM core
 * enforces the same ones internally — see computeLimits.ts / VULN-051):
 * - topK >= 1: the TS original's `sorted.slice(0, topK)` with topK <= 0
 *   degenerates to an empty result; instead of reimplementing the quirk,
 *   such options bypass WASM and take the TS path so behavior is unchanged.
 * - Integer topK/minLength in [0, 2^32 - 1]: the JS->wasm i32/u32 boundary
 *   silently converts any other number via ToUint32 — negatives and values
 *   >= 2^32 wrap (e.g. 2^32 + 1 becomes 1, so a "topK: all sentences" option
 *   would silently extract a single sentence), fractions truncate — so any
 *   option outside that domain also bypasses WASM.
 */

import { DEFAULT_OPTIONS, extractSentences, type ExtractOptions } from './sentenceExtractor.js';
import { splitSentences } from './text/tokenizer.js';
import { extractTopIndicesWithWasm, initTextrankWasm } from '../wasm/textrank/index.js';
import {
    createHybridProbe,
    isWasmSafeF64,
    isWasmSafeU32,
    remapWasmIndices,
    runHybrid,
} from './wasmHybridRuntime.js';

const probe = createHybridProbe(
    initTextrankWasm,
    'TextRank WASM module unavailable, falling back to TS extraction'
);

/**
 * True when the options are safe to pass across the JS->u32/f64 WASM
 * boundary (integers in range, finite threshold). Anything else takes the
 * TS path, which accepts the same values the JS reference always has.
 * Per-core policy: topK >= 1 (the TS original's `sorted.slice(0, topK)`
 * with topK <= 0 degenerates to an empty result; instead of reimplementing
 * the quirk, such options bypass WASM so behavior is unchanged).
 */
function isWasmSafeOptions(options: Required<ExtractOptions>): boolean {
    const { topK, minLength, similarityThreshold } = options;
    return (
        Number.isInteger(topK) &&
        topK >= 1 &&
        isWasmSafeU32(topK) &&
        isWasmSafeU32(minLength) &&
        isWasmSafeF64(similarityThreshold)
    );
}

/**
 * Extracts top-K sentences with the WASM TextRank core, falling back to the
 * sync TS extractSentences() on any WASM unavailability, parameter-domain
 * bypass, or runtime error. Mirrors extractSentences()'s signature so the
 * pipeline step swaps over without changing its option shape.
 */
export async function extractSentencesHybrid(
    text: string,
    options: ExtractOptions = {}
): Promise<string[]> {
    return runHybrid({
        probe,
        fallbackMessage: 'TextRank WASM extraction failed, falling back to TS for this input',
        // Same DEFAULT_OPTIONS merge the TS reference applies, so the WASM
        // call never sees different defaults than the fallback path would.
        mergeDefaults: () => ({ ...DEFAULT_OPTIONS, ...options }),
        earlyReturn: () => (!text || !text.trim() ? [] : undefined),
        isSafe: (opts) => isWasmSafeOptions(opts),
        callWasm: async (opts) => {
            const result = await extractTopIndicesWithWasm(text, opts);
            // Per-core splitter injection: the trimmed `splitSentences`
            // split, verified against the core's own split by the shared
            // remap gate before indices are mapped back to strings.
            const sentences = splitSentences(text);
            const indices = remapWasmIndices(result, sentences, 'textrank', 'sentences');
            return indices.map((i) => sentences[i]!);
        },
        callTs: () => extractSentences(text, options),
    });
}
