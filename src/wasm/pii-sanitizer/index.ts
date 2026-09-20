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
 * allows. The URL resolution and singleton/retry logic live in the shared
 * `../initWasm.ts` so every wasm wrapper follows one implementation of
 * that CSP-safe contract.
 */

import initWasmModule, { sanitizePii as sanitizePiiWasm } from './piiSanitizerWasm.js';
import { initExtensionWasm } from '../initWasm.js';
import { errorMessage } from '../../utils/errorUtils.js';

/**
 * Initializes the wasm module. Safe to call repeatedly (idempotent) and
 * from multiple call sites — all callers share the same in-flight promise
 * (managed by initExtensionWasm) so the ~47KB binary is fetched/compiled
 * exactly once per worker lifetime, with reset-on-failure so a transient
 * fetch error can be retried.
 */
export function initPiiSanitizerWasm(): Promise<void> {
    return initExtensionWasm('pii_sanitizer_bg.wasm', (url) =>
        initWasmModule({ module_or_path: url })
    );
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
