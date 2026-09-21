/* tslint:disable */
/* eslint-disable */

/**
 * Sanitizes every entry of a JS string array in a single call and returns
 * a JS string array (same order, same length).
 *
 * Newlines inside entries are preserved (see the module-level transfer
 * contract): unlike the `\n`-joined transfer of the tag-cooccur crate,
 * this entry point never splits on content bytes.
 */
export function sanitizeBatch(inputs: any): any;

/**
 * Sanitizes every entry of a JS string array and joins the results with
 * `separator` inside WASM, returning a single string.
 *
 * Mirrors `entries.map(sanitizeForObsidian).join(separator)` (e.g. the
 * `'\n---\n'` aggregation in `exportLogsService.exportMarkdown`) while
 * crossing the JS→WASM boundary exactly once in each direction.
 */
export function sanitizeBatchAndJoin(inputs: any, separator: string): any;

/**
 * Sanitizes one string exactly like `sanitizeForObsidian`.
 */
export function sanitizeForObsidian(input: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly sanitizeBatch: (a: any) => [number, number, number];
    readonly sanitizeBatchAndJoin: (a: any, b: number, c: number) => [number, number, number];
    readonly sanitizeForObsidian: (a: number, b: number) => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
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
