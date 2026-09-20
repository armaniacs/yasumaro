/* tslint:disable */
/* eslint-disable */

/**
 * Result of `deduplicateIndices`: the kept part indices (into the core's
 * own split, in original order) and the total number of parts that split
 * produced. Exposing the count lets the TS wrapper verify its own split
 * agrees before mapping indices back to strings — an in-range index from a
 * disagreeing split would otherwise silently reconstruct the wrong text.
 */
export class DedupIndicesResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly indices: Uint32Array;
    readonly sentenceCount: number;
}

/**
 * Computes the kept sentence indices for `text` using Jaccard-based
 * redundancy reduction.
 *
 * Mirrors `deduplicateContent(text, { threshold, minLength })` from
 * contentDeduplicator.ts.
 *
 * Errors (JS receives a thrown Error via the wrapper, which falls back to
 * the TS path):
 * - `threshold` is NaN: the TS comparison `jaccard >= NaN` is always false
 *   (keep everything), which is well-defined — but passing NaN across the
 *   boundary invites silent misuse, so the core rejects it and the wrapper
 *   bypasses NaN inputs to the TS path instead.
 */
export function deduplicateIndices(text: string, threshold: number, min_length: number): DedupIndicesResult;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_dedupindicesresult_free: (a: number, b: number) => void;
    readonly dedupindicesresult_indices: (a: number) => [number, number];
    readonly dedupindicesresult_sentenceCount: (a: number) => number;
    readonly deduplicateIndices: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
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
