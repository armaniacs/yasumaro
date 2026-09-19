/**
 * Hybrid PII sanitizer: runs the WASM core first (all 21 pattern types from
 * PII_PATTERNS, see wasm/pii-sanitizer/src/patterns/{core5,extended}.rs),
 * then the TS regex path (src/utils/piiSanitizer.ts) over the WASM-masked
 * text as a second pass. Since the WASM core now covers every pattern, the
 * second TS pass should normally find nothing left to mask — it stays in
 * place as a correctness backstop (e.g. if a future WASM pattern change
 * introduces a regression, TS still catches what WASM misses) and because
 * removing it entirely would need its own dedicated verification pass.
 *
 * Two-pass safety: a `[MASKED:<type>]` placeholder contains no digits, `@`,
 * or characters any of the 21 patterns require, so it can never be
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
        const message = errorMessage(error);
        // addLog() persists to chrome.storage asynchronously (see
        // utils/logger/core.ts) and is not readable from outside the
        // service worker without a dedicated message handler. A plain
        // console.warn is also emitted so this failure is visible in
        // chrome://extensions' "service worker" devtools console during
        // manual debugging, and so e2e tests can assert on it directly via
        // Playwright's Worker.on('console', ...) — see
        // testDir/e2e/pii-wasm-initialization.spec.ts, the regression guard
        // for a real bug where this path fired on every single call in
        // every production build (WASM was silently inlined as a
        // CSP-blocked `data:` URI — see wasm/pii-sanitizer/index.ts).
        console.warn('PII WASM module unavailable, falling back to TS-only sanitization:', message);
        addLog(LogType.WARN, 'PII WASM module unavailable, falling back to TS-only sanitization', {
            error: message,
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
        const message = errorMessage(error);
        console.warn('PII WASM sanitize call failed, falling back to TS regex for this input:', message);
        addLog(LogType.WARN, 'PII WASM sanitize call failed, falling back to TS regex for this input', {
            error: message,
        });
        return sanitizeRegex(text, options);
    }
}
