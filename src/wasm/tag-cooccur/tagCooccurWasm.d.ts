/* tslint:disable */
/* eslint-disable */

/**
 * Type-only import (erased at runtime, no runtime dependency): the raw
 * wasm transfer shapes are owned and validated by the TS wrapper
 * (src/wasm/tag-cooccur/index.ts), so the declarations import them instead
 * of re-declaring the structures here. RawCooccurResult decodes via
 * decodeCooccurResult() into the `computeTagCooccurrence(entries)` reference
 * shape; RawNarrowResult's `joined` re-splits into the
 * `narrowEntriesToTopTags(entries, limit)` reference shape.
 */
import type { RawCooccurResult, RawNarrowResult } from './index.js';

/**
 * Computes tag cooccurrence over `entry_count` raw tags strings
 * `\n`-joined into `joined`, returning the RAW transfer object
 * `{ tags, counts, edgeA, edgeB, weights }` — NOT the decoded
 * `{ nodes, edges }` reference shape; the wrapper decodes that.
 *
 * Mirrors `computeTagCooccurrence(entries)` where each entry contributes
 * its raw `tags` string (`null` normalized to `""` by the wrapper).
 */
export function computeCooccurrence(joined: string, entry_count: number): RawCooccurResult;

/**
 * Narrows records to the top-`limit` cross-record tags, returning the RAW
 * transfer object `{ unchanged, joined }` — NOT the rebuilt `T[]` reference
 * shape; the wrapper re-splits `joined` into it.
 *
 * Mirrors `narrowEntriesToTopTags(entries, limit)`. `limit` arrives as u32;
 * the wrapper bypasses non-integer/negative limits to the TS path because
 * the JS→WASM boundary would silently wrap them via ToUint32.
 */
export function narrowToTopTags(joined: string, entry_count: number, limit: number): RawNarrowResult;

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
