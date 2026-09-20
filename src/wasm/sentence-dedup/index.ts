/**
 * TypeScript wrapper around the Rust/WASM sentence-dedup core.
 *
 * Ports `deduplicateContent` from src/utils/contentDeduplicator.ts (the
 * MMR-style redundancy reduction step; see wasm/sentence-dedup/src/lib.rs
 * for the parity contracts, including the deliberate MAX_SENTENCES_FOR_DEDUP
 * fail-open cap). The intended caller is src/utils/contentDedupHybrid.ts,
 * which falls back to the TS implementation when this module fails to load —
 * NOT YET WIRED: no production call site imports the hybrid yet, so this
 * module (and the src copy of the binary) is currently exercised only by
 * tests and bench until the integration lands.
 *
 * Data-transfer shape: the call sends the raw text once (a single JS→WASM
 * string copy) and receives a small object back — the kept part indices as
 * a `Uint32Array` plus the total part count the core's own split produced
 * (used by the hybrid to verify its JS split agrees before mapping indices
 * to strings). The O(n^2) Jaccard pair scan over per-sentence word sets
 * runs entirely inside WASM without JS GC pressure; no per-sentence
 * Set<string> is ever materialized on the JS side.
 *
 * Loading follows the shared contract in `../initWasm.ts`: binary at the
 * stable public path `wasm/sentence_dedup_bg.wasm` (fetched via
 * `chrome.runtime.getURL()`). STAGED state: the public copy and the
 * wxt.config.ts publicAssets entry are intentionally deferred until the
 * hybrid is wired into a production call site (see wxt.config.ts
 * publicAssets), so in the current tree ONLY the committed src copy exists
 * — tests and bench read it directly from disk, and a production call to
 * initSentenceDedupWasm() would 404 until integration restores the public
 * path. Do NOT switch this to
 * `new URL('./sentence_dedup_bg.wasm', import.meta.url)` — under the
 * single-file IIFE background build Vite inlines that as a CSP-blocked
 * `data:` URI and the module silently fails in every real build (see
 * src/wasm/pii-sanitizer/index.ts's module doc for the full story).
 */

import initWasmModule, {
    deduplicateIndices as deduplicateIndicesWasm,
} from './sentenceDedupWasm.js';
import { initExtensionWasm } from '../initWasm.js';
import { errorMessage } from '../../utils/errorUtils.js';

/**
 * Initializes the wasm module. Safe to call repeatedly (idempotent) and
 * from multiple call sites — all callers share the same in-flight promise
 * so the ~29KB binary is fetched/compiled exactly once per worker lifetime,
 * with reset-on-failure so a transient fetch error can be retried.
 */
export function initSentenceDedupWasm(): Promise<void> {
    return initExtensionWasm('sentence_dedup_bg.wasm', (url) =>
        initWasmModule({ module_or_path: url })
    );
}

export interface WasmDedupOptions {
    /** Jaccard threshold, in [0, 1] — values > 1 keep everything. */
    threshold: number;
    /** Sentences shorter than this (UTF-16 units) are always kept. */
    minLength: number;
}

export interface WasmDedupResult {
    /** Kept original part indices, in original order. */
    indices: number[];
    /** Total parts the core's own split produced for `text`. */
    sentenceCount: number;
}

/**
 * Runs the WASM dedup scan. Must call initSentenceDedupWasm() first (or
 * await it here) — throws if the module isn't loaded and initialization
 * fails, or if the core rejects the parameters (e.g. NaN threshold);
 * callers treat any throw as "fall back to the TS path".
 */
export async function deduplicateIndicesWithWasm(
    text: string,
    options: WasmDedupOptions
): Promise<WasmDedupResult> {
    await initSentenceDedupWasm();
    try {
        const result = deduplicateIndicesWasm(
            text,
            options.threshold,
            options.minLength
        ) as { readonly indices: Uint32Array; readonly sentenceCount: number };
        return {
            indices: Array.from(result.indices),
            sentenceCount: result.sentenceCount,
        };
    } catch (error: unknown) {
        throw error instanceof Error ? error : new Error(errorMessage(error));
    }
}
