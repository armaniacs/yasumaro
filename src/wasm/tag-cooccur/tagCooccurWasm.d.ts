/* tslint:disable */
/* eslint-disable */

/**
 * Computes tag cooccurrence over `entry_count` raw tags strings
 * `\n`-joined into `joined`.
 *
 * Mirrors `computeTagCooccurrence(entries)` where each entry contributes
 * its raw `tags` string (`null` normalized to `""` by the wrapper).
 */
export function computeCooccurrence(joined: string, entry_count: number): any;

/**
 * Narrows records to the top-`limit` cross-record tags.
 *
 * Mirrors `narrowEntriesToTopTags(entries, limit)`. `limit` arrives as u32;
 * the wrapper bypasses non-integer/negative limits to the TS path because
 * the JS→WASM boundary would silently wrap them via ToUint32.
 */
export function narrowToTopTags(joined: string, entry_count: number, limit: number): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly computeCooccurrence: (a: number, b: number, c: number) => [number, number, number];
    readonly narrowToTopTags: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
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
