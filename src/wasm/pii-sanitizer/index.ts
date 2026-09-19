/**
 * TypeScript wrapper around the Rust/WASM PII scanning core.
 *
 * Covers the five highest-volume pattern types from piiSanitizer.ts (email,
 * creditCard, myNumber, phoneJp, bankAccount). Locale-specific patterns
 * (ssn, iban, esDni, ...) stay in the TS regex path — they are cold paths
 * where the WASM round-trip cost isn't worth it. Callers that need full
 * pattern coverage should run both and merge, or fall back to
 * sanitizeRegex() entirely when the WASM module fails to load (e.g. an
 * older Firefox build without the async wasm CSP grant).
 */

import initWasmModule, { sanitizePii as sanitizePiiWasm } from './piiSanitizerWasm.js';
import { errorMessage } from '../../utils/errorUtils.js';

let initPromise: Promise<void> | null = null;

/**
 * Initializes the wasm module. Safe to call repeatedly (idempotent) and
 * from multiple call sites — all callers share the same in-flight promise
 * so the ~50KB binary is fetched/compiled exactly once per worker lifetime.
 */
export function initPiiSanitizerWasm(): Promise<void> {
    if (!initPromise) {
        // Service worker + offscreen doc are the two contexts this runs in;
        // both fetch same-origin extension:// URLs the CSP already allows.
        const wasmUrl = new URL('./pii_sanitizer_bg.wasm', import.meta.url);
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
