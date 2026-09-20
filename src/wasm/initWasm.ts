/**
 * Shared WASM initialization utilities for extension contexts.
 *
 * Extension WASM modules (pii-sanitizer, textrank) share the same loading
 * contract: the binary lives at a stable public path (`public/wasm/`, copied
 * into dist/wasm/ by wxt.config.ts's build:publicAssets hook), is fetched
 * via `chrome.runtime.getURL()` (NOT via `new URL(..., import.meta.url)` —
 * under the single-file IIFE background build Vite inlines that as a
 * CSP-blocked `data:` URI; see postprocess-wasm-glue.mjs), and each module's
 * init is a singleton promise per service-worker / document lifetime with
 * reset-on-failure so a transient fetch error can be retried.
 *
 * This module centralizes the URL resolution and the singleton/retry logic
 * so each wrapper (`src/wasm/<crate>/index.ts`) only supplies its own glue's
 * init function. Node/tests bypass this module and feed the wasm bytes to
 * the glue directly, mirroring the pii-sanitizer pattern.
 */

import { errorMessage } from '../utils/errorUtils.js';

/**
 * Resolves a wasm binary's extension URL. Extension-context only
 * (`chrome.runtime` must exist) — deliberately has NO
 * `new URL(..., import.meta.url)` fallback branch, even for tests/Node,
 * because Vite's static asset scan inlines that pattern as a `data:` URI
 * whenever it appears anywhere in the source, regardless of whether the
 * branch is reachable (see src/wasm/pii-sanitizer/index.ts's module doc).
 */
export function extensionWasmUrl(fileName: string): string {
    if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) {
        throw new Error(
            `wasm init (${fileName}): chrome.runtime.getURL is unavailable — WASM init must run in an ` +
                'extension context (service worker or offscreen document), not directly in Node/tests.'
        );
    }
    return chrome.runtime.getURL(`wasm/${fileName}`);
}

const initPromises = new Map<string, Promise<void>>();

/**
 * Runs `load` exactly once per `fileName` per context lifetime. Concurrent
 * callers share the in-flight promise; a failure resets the singleton so a
 * later call can retry (e.g. transient fetch failure), matching the
 * pii-sanitizer wrapper's behavior.
 *
 * @param fileName - wasm binary name under the public `wasm/` path (e.g.
 *   `textrank_bg.wasm`).
 * @param load - receives the resolved extension URL and must drive the
 *   crate's wasm-bindgen glue `__wbg_init({ module_or_path: url })`.
 */
export function initExtensionWasm(
    fileName: string,
    load: (url: string) => Promise<unknown>
): Promise<void> {
    const existing = initPromises.get(fileName);
    if (existing) {
        return existing;
    }
    const url = extensionWasmUrl(fileName);
    const promise = load(url).then(
        () => undefined,
        (error: unknown) => {
            initPromises.delete(fileName);
            throw error instanceof Error ? error : new Error(errorMessage(error));
        }
    );
    initPromises.set(fileName, promise);
    return promise;
}
