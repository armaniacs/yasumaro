/**
 * Hybrid PII sanitizer: runs the WASM core first (email/creditCard/myNumber/
 * phoneJp/bankAccount — the 5 highest-volume patterns, see
 * wasm/pii-sanitizer/src/lib.rs), then the TS regex path
 * (src/utils/piiSanitizer.ts) over the WASM-masked text to catch the
 * remaining 19 locale-specific patterns (ssn, iban, esDni, ...).
 *
 * Two-pass safety: a `[MASKED:<type>]` placeholder contains no digits, `@`,
 * or characters any of the 24 patterns require, so it can never be
 * re-matched by the second pass — verified by
 * src/background/pipeline/__tests__/piiSanitizeHybrid.test.ts.
 *
 * Falls back to TS-only sanitization if the WASM module fails to
 * initialize (e.g. CSP blocked the fetch, or an unsupported runtime) —
 * PII protection must never silently degrade to "off".
 *
 * Known limitation: `maskedItems[].index` from the TS pass refers to
 * offsets in the WASM-masked text, not the original input (the WASM pass
 * shifts text around before TS ever sees it). No current caller reads
 * `.index` downstream (see PrivacyPipeline.process — only `.type`/
 * `.original`/`.length` are consumed), but a future caller that needs
 * accurate original-text offsets should not use this hybrid path as-is.
 */

import { sanitizeRegex, type SanitizeOptions, type SanitizeResult } from '../../utils/piiSanitizer.js';
import { sanitizePiiWithWasm, initPiiSanitizerWasm } from '../../wasm/pii-sanitizer/index.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { addLog } from '../../utils/logger/core.js';
import { LogType } from '../../utils/logger/types.js';

let wasmAvailable: boolean | null = null;

/**
 * Probes WASM availability once per service worker lifetime (mirrors
 * initPiiSanitizerWasm's own singleton-promise caching) so a permanently
 * broken environment doesn't retry-and-fail on every single sanitize call.
 */
async function isWasmAvailable(): Promise<boolean> {
    if (wasmAvailable !== null) {
        return wasmAvailable;
    }
    try {
        await initPiiSanitizerWasm();
        wasmAvailable = true;
    } catch (error: unknown) {
        wasmAvailable = false;
        addLog(LogType.WARN, 'PII WASM module unavailable, falling back to TS-only sanitization', {
            error: errorMessage(error),
        });
    }
    return wasmAvailable;
}

/**
 * Sanitizes `text` using the WASM core for the 5 highest-volume patterns
 * plus the TS regex path for full pattern coverage. Same signature as
 * sanitizeRegex() so it can be swapped in via PrivacyPipeline's ISanitizers
 * dependency injection without changing call sites.
 */
export async function sanitizePiiHybrid(text: string, options: SanitizeOptions = {}): Promise<SanitizeResult> {
    if (!(await isWasmAvailable())) {
        return sanitizeRegex(text, options);
    }

    try {
        const wasmResult = await sanitizePiiWithWasm(text);
        const tsResult = await sanitizeRegex(wasmResult.text, options);
        return {
            text: tsResult.text,
            maskedItems: [...wasmResult.maskedItems, ...tsResult.maskedItems],
            ...(tsResult.error ? { error: tsResult.error } : {}),
        };
    } catch (error: unknown) {
        // A WASM call failing at runtime (not just at init) is unexpected —
        // log it and fall back to TS-only for this call rather than
        // propagating, since PII masking failing closed (throwing) would
        // abort the whole recording pipeline for a WASM-specific fault.
        addLog(LogType.WARN, 'PII WASM sanitize call failed, falling back to TS regex for this input', {
            error: errorMessage(error),
        });
        return sanitizeRegex(text, options);
    }
}
