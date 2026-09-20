/* tslint:disable */
/* eslint-disable */

/**
 * Result of `extractTopIndices`: the selected sentence indices (into the
 * core's own `splitSentences(text)`, in selection order) and the total
 * number of sentences that split produced. Exposing the count lets the TS
 * wrapper verify its own split agrees before mapping indices to strings —
 * an in-range index from a disagreeing split would otherwise silently map
 * to the wrong sentence.
 */
export class TopIndicesResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly indices: Uint32Array;
    readonly sentenceCount: number;
}

/**
 * Extracts the top-K sentences' indices from `text` using TextRank.
 *
 * Mirrors `extractSentences(text, { topK, minLength, similarityThreshold })`
 * from sentenceExtractor.ts.
 *
 * Errors (JS receives a rejected promise / thrown Error via the wrapper):
 * - `top_k == 0`: the TS original's `sorted.slice(0, 0)` degenerates to an
 *   empty result; the wrapper treats this as a call failure and falls back
 *   to the TS path, so the quirk is preserved rather than reimplemented.
 */
export function extractTopIndices(text: string, top_k: number, min_length: number, similarity_threshold: number): TopIndicesResult;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_topindicesresult_free: (a: number, b: number) => void;
    readonly extractTopIndices: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly topindicesresult_indices: (a: number) => [number, number];
    readonly topindicesresult_sentenceCount: (a: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
