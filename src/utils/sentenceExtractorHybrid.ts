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
import { errorMessage } from './errorUtils.js';
import { addLog } from './logger/core.js';
import { LogType } from './logger/types.js';

let wasmAvailable: boolean | null = null;

/**
 * Probes WASM availability once per service worker lifetime (mirrors
 * initTextrankWasm's own singleton-promise caching) so a permanently broken
 * environment doesn't retry-and-fail on every recording.
 */
async function isWasmAvailable(): Promise<boolean> {
    if (wasmAvailable !== null) {
        return wasmAvailable;
    }
    try {
        await initTextrankWasm();
        wasmAvailable = true;
    } catch (error: unknown) {
        wasmAvailable = false;
        const message = errorMessage(error);
        console.warn('TextRank WASM module unavailable, falling back to TS extraction:', message);
        addLog(LogType.WARN, 'TextRank WASM module unavailable, falling back to TS extraction', {
            error: message,
        });
    }
    return wasmAvailable;
}

/**
 * Max u32 value. Integers in [0, U32_MAX] pass through the JS->wasm u32
 * boundary unchanged (ToUint32 is the identity on that range); anything
 * outside — negatives, fractions, values >= 2^32 — wraps and would make the
 * WASM core see a different option than the TS reference, so it bypasses.
 */
const U32_MAX = 0xffffffff;

/**
 * True when the options are safe to pass across the JS->u32/f64 WASM
 * boundary (integers in range, finite threshold). Anything else takes the
 * TS path, which accepts the same values the JS reference always has.
 */
function isWasmSafeOptions(options: Required<ExtractOptions>): boolean {
    const { topK, minLength, similarityThreshold } = options;
    return (
        Number.isInteger(topK) &&
        Number.isInteger(minLength) &&
        topK >= 1 &&
        topK <= U32_MAX &&
        minLength >= 0 &&
        minLength <= U32_MAX &&
        Number.isFinite(similarityThreshold)
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
    if (!text || !text.trim()) {
        return [];
    }
    // One shared defaults merge: the same DEFAULT_OPTIONS the TS reference
    // applies, so the WASM call never sees different defaults than the
    // fallback path would.
    const opts: Required<ExtractOptions> = { ...DEFAULT_OPTIONS, ...options };
    if (!isWasmSafeOptions(opts) || !(await isWasmAvailable())) {
        return extractSentences(text, options);
    }

    try {
        const result = await extractTopIndicesWithWasm(text, opts);
        const sentences = splitSentences(text);
        // Split agreement gate: an in-range index from a disagreeing split
        // would silently map to the wrong sentence, so the counts must match
        // before mapping (out-of-range kept as belt-and-braces).
        if (result.sentenceCount !== sentences.length) {
            throw new Error(
                `textrank wasm split mismatch (wasm ${result.sentenceCount} vs ` +
                    `js ${sentences.length} sentences)`
            );
        }
        if (result.indices.some((i) => i < 0 || i >= sentences.length)) {
            throw new Error(
                `textrank wasm returned out-of-range indices (got ${result.indices.length} ` +
                    `indices, ${sentences.length} sentences)`
            );
        }
        return result.indices.map((i) => sentences[i]!);
    } catch (error: unknown) {
        const message = errorMessage(error);
        console.warn('TextRank WASM extraction failed, falling back to TS for this input:', message);
        addLog(LogType.WARN, 'TextRank WASM extraction failed, falling back to TS for this input', {
            error: message,
        });
        return extractSentences(text, options);
    }
}
