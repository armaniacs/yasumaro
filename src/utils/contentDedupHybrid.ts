/**
 * contentDedupHybrid.ts
 * Hybrid sentence dedup: runs the WASM core (see
 * wasm/sentence-dedup/src/lib.rs — an exact port of contentDeduplicator.ts's
 * deduplicateContent) on the success path and falls back to the TS
 * implementation (src/utils/contentDeduplicator.ts) when the WASM module
 * fails to initialize (e.g. CSP blocked the fetch, or an unsupported
 * runtime) or when a WASM call throws at runtime — dedup must keep working
 * wherever the extraction pipeline runs.
 *
 * Output parity: the WASM core returns kept indices into its own split plus
 * the total count of that split; this wrapper re-splits the text with the
 * identical JS `splitSentencesKeepDelimiters` and reconstructs the text by
 * joining `sentence + delimiter` for kept parts only after verifying the
 * two splits agree (same part count; out-of-range indices rejected as
 * belt-and-braces). Any disagreement — or any WASM failure — re-runs the TS
 * path rather than emitting wrong output.
 *
 * Early-return parity with the TS reference (deduplicateContent):
 * - `!text.trim()` → text unchanged, before anything runs.
 * - `threshold === 0` → text unchanged, before the split (a scan with
 *   threshold 0 would remove everything after the first part, since
 *   jaccard >= 0 always holds — the TS short-circuits instead).
 * - part count <= 1 → text unchanged (deduplicateContent returns early
 *   before its kept/join loop; the split's whitespace quirks must not be
 *   "repaired" — see the delimiter-duplication notes in
 *   contentDeduplicator.ts).
 *
 * Guard rails mirrored from the TS original (defense in depth, the WASM
 * core enforces the same ones internally):
 * - Finite threshold: the JS->wasm f64 boundary passes NaN through, where
 *   the core rejects it — so NaN options bypass WASM and take the TS path,
 *   which treats `jaccard >= NaN` as always-false (keep everything).
 *   Negative thresholds are degenerate-but-defined in the TS reference
 *   (everything after the first part matches `jaccard >= negative`) and the
 *   core reproduces that, so they pass through to WASM.
 * - Integer minLength in [0, 2^32 - 1]: the JS->wasm u32 boundary silently
 *   converts any other number via ToUint32 — negatives and values >= 2^32
 *   wrap (e.g. 2^32 + 1 becomes 1), fractions truncate — so any option
 *   outside that domain also bypasses WASM.
 *
 * Known divergence (deliberate): the WASM core caps the O(n^2) pair scan at
 * MAX_SENTENCES_FOR_DEDUP (1000) and fails open beyond it (tail kept
 * unconditionally) to bound the quadratic work the uncapped TS reference
 * would spend on delimiter-dense pages. Below the cap the two paths are
 * byte-identical (enforced by the parity test suite); beyond it the WASM
 * path trades exact TS parity for bounded latency, dropping no content.
 */

import { deduplicateContent, splitSentencesKeepDelimiters, type DeduplicateOptions } from './contentDeduplicator.js';
import { deduplicateIndicesWithWasm, initSentenceDedupWasm } from '../wasm/sentence-dedup/index.js';
import {
    createHybridProbe,
    isWasmSafeF64,
    isWasmSafeU32,
    remapWasmIndices,
    runHybrid,
} from './wasmHybridRuntime.js';

const probe = createHybridProbe(
    initSentenceDedupWasm,
    'Sentence-dedup WASM module unavailable, falling back to TS dedup'
);

/**
 * Defaults mirroring deduplicateContent's parameter defaults.
 */
const DEFAULT_OPTIONS: Required<DeduplicateOptions> = { threshold: 0.7, minLength: 10 };

/**
 * Below this input size the TS path is measurably faster than WASM
 * (src/wasm/sentence-dedup/bench.ts: ~2KB/21 parts → 0.72x, ~16KB/161 parts
 * → 1.30x): the fixed wasm-bindgen string marshalling cost dominates while
 * the pair scan is still short. Small inputs also get nothing from the
 * O(n^2) cap (they can't reach it), so routing them to TS is a pure win —
 * same engine, fewer copies.
 */
const MIN_WASM_INPUT_CHARS = 4096;

/**
 * True when the options are safe to pass across the JS->wasm boundary
 * (finite threshold, integer minLength in range). Anything else takes the
 * TS path, which accepts the same values the JS reference always has.
 */
function isWasmSafeOptions(options: Required<DeduplicateOptions>): boolean {
    const { threshold, minLength } = options;
    return isWasmSafeF64(threshold) && isWasmSafeU32(minLength);
}

/**
 * Deduplicates `text` with the WASM Jaccard core, falling back to the sync
 * TS deduplicateContent() on any WASM unavailability, parameter-domain
 * bypass, or runtime error. Mirrors deduplicateContent()'s signature so
 * call sites can swap over without changing the option shape.
 */
export async function deduplicateContentHybrid(
    text: string,
    options: DeduplicateOptions = {}
): Promise<string> {
    return runHybrid({
        probe,
        fallbackMessage: 'Sentence-dedup WASM call failed, falling back to TS for this input',
        // Same defaults the TS reference applies, so the WASM call never
        // sees different options than the fallback path.
        mergeDefaults: () => ({ ...DEFAULT_OPTIONS, ...options }),
        earlyReturn: (opts) => {
            if (!text || !text.trim()) {
                return text;
            }
            if (opts.threshold === 0) {
                return text;
            }
            return undefined;
        },
        isSafe: (opts) => isWasmSafeOptions(opts),
        bypassWasm: () => text.length < MIN_WASM_INPUT_CHARS,
        callWasm: async (opts) => {
            const result = await deduplicateIndicesWithWasm(text, opts);
            // Per-core splitter injection: the delimiter-bearing
            // `splitSentencesKeepDelimiters` split, verified against the
            // core's own split by the shared remap gate before kept parts
            // are joined as `sentence + delimiter`.
            const parts = splitSentencesKeepDelimiters(text);
            const indices = remapWasmIndices(result, parts, 'sentence-dedup', 'parts');
            // TS early return: a single-part split returns the text unchanged
            // (deduplicateContent returns before its kept/join loop).
            if (parts.length <= 1) {
                return text;
            }
            return indices.map((i) => parts[i]!.sentence + parts[i]!.delimiter).join('');
        },
        callTs: () => deduplicateContent(text, options),
    });
}
