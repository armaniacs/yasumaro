/**
 * TypeScript wrapper around the Rust/WASM TextRank sentence-extraction core.
 *
 * Ports `extractSentences` / `buildSentenceGraph` / `textRank` from
 * `src/utils/sentenceExtractor.ts` (see wasm/textrank/src/lib.rs for the
 * parity contracts). The production caller is
 * `src/utils/sentenceExtractorHybrid.ts`, which falls back to the TS
 * implementation when this module fails to load.
 *
 * Data-transfer shape: the call sends the raw page text once (a single
 * JS→WASM string copy) and receives a small object back — the selected
 * sentence indices as a `Uint32Array` plus the total sentence count the
 * core's own split produced (used by the hybrid to verify its JS split
 * agrees before mapping indices to strings). The O(n^2) similarity matrix
 * and PageRank iterations run entirely inside WASM without JS GC pressure.
 *
 * Loading follows the shared contract in `../initWasm.ts`: binary at the
 * stable public path `wasm/textrank_bg.wasm` (copied from `public/wasm/` by
 * wxt.config.ts's build:publicAssets hook), fetched via
 * `chrome.runtime.getURL()`. Do NOT switch this to
 * `new URL('./textrank_bg.wasm', import.meta.url)` — under the single-file
 * IIFE background build Vite inlines that as a CSP-blocked `data:` URI and
 * the module silently fails in every real build (see
 * src/wasm/pii-sanitizer/index.ts's module doc for the full story).
 */

import initWasmModule, {
    extractTopIndices as extractTopIndicesWasm,
} from './textrankWasm.js';
import { initExtensionWasm } from '../initWasm.js';
import { errorMessage } from '../../utils/errorUtils.js';

/**
 * Initializes the wasm module. Safe to call repeatedly (idempotent) and
 * from multiple call sites — all callers share the same in-flight promise
 * so the ~39KB binary is fetched/compiled exactly once per worker lifetime.
 */
export function initTextrankWasm(): Promise<void> {
    return initExtensionWasm('textrank_bg.wasm', (url) =>
        initWasmModule({ module_or_path: url })
    );
}

export interface WasmExtractOptions {
    topK: number;
    minLength: number;
    similarityThreshold: number;
}

export interface WasmExtractResult {
    /** Selected original sentence indices, in selection order. */
    indices: number[];
    /** Total sentences the core's own split produced for `text`. */
    sentenceCount: number;
}

/**
 * Runs the WASM TextRank extraction. Must call initTextrankWasm() first
 * (or await it here) — throws if the module isn't loaded and initialization
 * fails, or if the core rejects the parameters (e.g. topK < 1); callers
 * treat any throw as "fall back to the TS path".
 */
export async function extractTopIndicesWithWasm(
    text: string,
    options: WasmExtractOptions
): Promise<WasmExtractResult> {
    await initTextrankWasm();
    try {
        const result = extractTopIndicesWasm(
            text,
            options.topK,
            options.minLength,
            options.similarityThreshold
        ) as { readonly indices: Uint32Array; readonly sentenceCount: number };
        return {
            indices: Array.from(result.indices),
            sentenceCount: result.sentenceCount,
        };
    } catch (error: unknown) {
        throw error instanceof Error ? error : new Error(errorMessage(error));
    }
}
