/**
 * TypeScript wrapper around the Rust/WASM PII scanning core.
 *
 * Covers all 21 pattern types from piiSanitizer.ts's PII_PATTERNS (see
 * wasm/pii-sanitizer/src/patterns/{core5,extended}.rs). Callers should
 * still fall back to sanitizeRegex() entirely when the WASM module fails to
 * load — see piiSanitizeHybrid.ts, which is the actual production caller.
 *
 * WASM asset loading: the binary is NOT referenced via
 * `new URL('./pii_sanitizer_bg.wasm', import.meta.url)`. That pattern
 * relies on Vite's static asset analysis emitting a separate fetchable
 * file, but the background entrypoint here builds as a single-file IIFE
 * bundle (wxt.config.ts: `codeSplitting: false`, needed for the Firefox
 * in-page offscreen host) — under that build mode Vite instead **inlines**
 * the wasm as a `data:` URI directly into background.js. The extension CSP
 * (`connect-src 'self'`) blocks `data:` fetches with NetworkError, so the
 * WASM module silently failed to initialize in every real build (Chromium
 * AND Firefox) until this was caught by inspecting the built background.js
 * for the expected filename string and finding a giant base64 blob instead.
 *
 * Fix: the binary is copied to a stable public path (public/wasm/, see
 * wxt.config.ts's `build:publicAssets` hook) and fetched via
 * `chrome.runtime.getURL()`, mirroring the working pattern
 * `sqliteEngine.ts` already uses for `wasm/wa-sqlite-async.wasm`. This
 * sidesteps Vite's asset pipeline entirely — the file is served as an
 * ordinary same-origin extension:// resource, which the CSP already
 * allows.
 */

import initWasmModule, { sanitizePii as sanitizePiiWasm } from './piiSanitizerWasm.js';
import { errorMessage } from '../../utils/errorUtils.js';

let initPromise: Promise<void> | null = null;

/**
 * Resolves the wasm binary's URL. Extension-context only (`chrome.runtime`
 * must exist) — deliberately has NO `new URL(..., import.meta.url)`
 * fallback branch, even for tests/Node, because Vite's static asset scan
 * inlines that pattern as a `data:` URI whenever it appears anywhere in the
 * source, regardless of whether the branch is reachable (see this file's
 * module doc). Tests and bench.ts read the wasm bytes from disk directly
 * and call the underlying initWasmModule() themselves instead of going
 * through this function — see piiSanitizeHybrid.wasm-success.test.ts and
 * bench.ts's own `initForNode()`.
 */
function resolveWasmUrl(): string {
    if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) {
        throw new Error(
            'pii-sanitizer wasm: chrome.runtime.getURL is unavailable — initPiiSanitizerWasm() must run in an ' +
                'extension context (service worker or offscreen document), not directly in Node/tests.'
        );
    }
    return chrome.runtime.getURL('wasm/pii_sanitizer_bg.wasm');
}

/**
 * Initializes the wasm module. Safe to call repeatedly (idempotent) and
 * from multiple call sites — all callers share the same in-flight promise
 * so the ~47KB binary is fetched/compiled exactly once per worker lifetime.
 */
export function initPiiSanitizerWasm(): Promise<void> {
    if (!initPromise) {
        const wasmUrl = resolveWasmUrl();
        initPromise = initWasmModule({ module_or_path: wasmUrl }).then(
            () => undefined,
            (error: unknown) => {
                // Reset so a later call can retry (e.g. transient fetch failure).
                initPromise = null;
                throw error instanceof Error ? error : new Error(errorMessage(error));
            }
        );
    }
    return initPromise;
}

export interface WasmMaskedItem {
    type: string;
    original: string;
    index: number;
}

export interface WasmSanitizeResult {
    text: string;
    maskedItems: WasmMaskedItem[];
}

/**
 * Runs the WASM PII scan/mask pass. Must call initPiiSanitizerWasm() first
 * (or await it here) — throws if the module isn't loaded and initialization
 * fails.
 */
export async function sanitizePiiWithWasm(text: string): Promise<WasmSanitizeResult> {
    await initPiiSanitizerWasm();
    try {
        return sanitizePiiWasm(text) as WasmSanitizeResult;
    } catch (error: unknown) {
        throw error instanceof Error ? error : new Error(errorMessage(error));
    }
}
