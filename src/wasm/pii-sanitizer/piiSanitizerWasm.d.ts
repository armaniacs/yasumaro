/* tslint:disable */
/* eslint-disable */

/**
 * Type-only import (erased at runtime, no runtime dependency): the return
 * shape is derived from `SanitizeResult` in piiSanitizer.ts instead of being
 * re-declared here, so the two cannot drift apart.
 */
import type { SanitizeResult } from '../../utils/piiSanitizer.js';

/**
 * Sanitizes `text`, returning a JS object `{ text, maskedItems }` matching
 * the shape of `SanitizeResult` in piiSanitizer.ts (minus `error`, which the
 * TS wrapper layers on for size/timeout handling before calling this).
 */
export function sanitizePii(text: string): Omit<SanitizeResult, 'error'>;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly sanitizePii: (a: number, b: number) => [number, number, number];
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
