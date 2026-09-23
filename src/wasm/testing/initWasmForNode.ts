/**
 * Node-side WASM loader for tests and benches (test/bench-only support —
 * production extension contexts must use `initExtensionWasm` in
 * `src/wasm/initWasm.ts` instead).
 *
 * Node has no extension-page fetch(file://) support, so the wasm binary is
 * read from disk and fed to the wasm-bindgen glue directly as
 * `{ module_or_path: bytes }`. The caller supplies the binary's URL
 * (resolved against its own `import.meta.url`); this module owns the
 * `fileURLToPath` + `readFile` + `module_or_path` ritual in one place.
 *
 * The helper deliberately never names a `.wasm` file itself, so no
 * `new URL('...wasm', import.meta.url)` pattern appears here that Vite's
 * static asset scan could inline as a `data:` URI into the extension
 * bundle (see `src/wasm/initWasm.ts` and `postprocess-wasm-glue.mjs`).
 * It is only imported from `__tests__` / `bench.ts`, never from
 * production wrappers, so it stays out of the shipped bundle.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** A wasm-bindgen glue default export (`__wbg_init`). */
export type NodeWasmGlueInit = (initInput: { module_or_path: Uint8Array }) => Promise<unknown>;

/**
 * Reads the wasm binary at `wasmUrl` and initializes the glue with its
 * bytes. Behavior-equal to the inlined ritual it replaces: same bytes,
 * same `{ module_or_path: bytes }` call shape.
 */
export async function initWasmForNode(
    glueInit: NodeWasmGlueInit,
    wasmUrl: URL | string
): Promise<void> {
    const wasmPath = typeof wasmUrl === 'string' ? wasmUrl : fileURLToPath(wasmUrl);
    const bytes = await readFile(wasmPath);
    await glueInit({ module_or_path: bytes });
}

/**
 * Memoized variant for `vi.mock` factories, where each mocked wrapper
 * exposes its own named init (`initSentenceDedupWasm`, `initTextrankWasm`,
 * …) with singleton/retry semantics. Concurrent callers share the
 * in-flight promise; use a fresh factory per mock so failures do not leak
 * across suites.
 */
export function createNodeWasmInit(
    glueInit: NodeWasmGlueInit,
    wasmUrl: URL | string
): () => Promise<void> {
    let initPromise: Promise<void> | null = null;
    return (): Promise<void> => {
        if (!initPromise) {
            initPromise = initWasmForNode(glueInit, wasmUrl);
        }
        return initPromise;
    };
}
