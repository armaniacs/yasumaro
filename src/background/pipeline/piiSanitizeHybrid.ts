/**
 * Hybrid PII sanitizer: runs the WASM core (all 21 pattern types from
 * PII_PATTERNS, see wasm/pii-sanitizer/src/patterns/{core5,extended}.rs)
 * and nothing else on the success path. Falls back to the TS regex path
 * (src/utils/piiSanitizer.ts) when the WASM module fails to initialize
 * (e.g. CSP blocked the fetch, or an unsupported runtime) or when a WASM
 * call throws at runtime — PII protection must never silently degrade to
 * "off".
 *
 * Why there is no TS "second pass" over the WASM-masked text: an earlier
 * revision re-ran sanitizeRegex after the WASM pass as a correctness
 * backstop. The c8 micro benchmark (bench/micro/c8-pii-sanitize.bench.mjs)
 * showed the second pass costs ~2/3 of total sanitize latency — hybrid ≈
 * TS-only, i.e. the WASM migration delivered no speedup at all while both
 * passes ran (8KB: 0.51ms hybrid vs 0.17ms WASM-only vs 0.38ms TS-only;
 * 60KB: 3.0ms vs 1.0ms vs 3.2ms). The backstop's premise — TS catching a
 * WASM pattern regression at runtime — is covered at build time instead,
 * by gates that run on every CI change: the 218 captured-input parity
 * suite, the 45-case handwritten boundary corpus, 34 Rust unit tests, and
 * the wasm-binary rebuild-diff job. TS is the parity reference, not a
 * runtime oracle: the Rust port itself surfaced 2 latent boundary bugs the
 * captured corpus happened not to hit, so a passing corpus proves
 * equivalence on its inputs, nothing more — but re-scanning every real
 * input with the slower engine to guard against an unproven divergence
 * class traded away the migration's entire purpose. Any future WASM
 * pattern change must keep the parity suites green; that is the gate.
 *
 * Size-limit contract: sanitizeRegex rejects inputs over MAX_INPUT_SIZE
 * (or the 512KB hard cap when skipSizeLimit is set) and reports the breach
 * via its `error` field. The WASM core has no size concept by design (see
 * wasm/pii-sanitizer/src/lib.rs's module doc — the TS wrapper owns
 * size/timeout handling), so this wrapper reproduces the same error
 * semantics without re-running the TS scan. Masking still runs on
 * oversized inputs (same observable behavior as the two-pass revision,
 * where the WASM result reached callers with the error attached).
 *
 * A `[MASKED:<type>]` placeholder produced by the WASM pass contains no
 * digits, `@`, or characters any of the 21 patterns require — safe if a
 * caller ever re-sanitizes already-masked text (see
 * src/background/pipeline/__tests__/piiSanitizeHybrid.test.ts).
 */

import {
    sanitizeRegex,
    MAX_INPUT_SIZE,
    MAX_SKIP_SIZE,
    type SanitizeOptions,
    type SanitizeResult,
} from '../../utils/piiSanitizer.js';
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
 * Reproduces sanitizeRegex's size-limit rejection message for `text`
 * without running its scan, so the WASM path reports the same `error`
 * field the TS path would (the pipeline surfaces maskedItems/text and
 * leaves `error` to its callers).
 */
function sizeLimitError(text: string, options: SanitizeOptions): string | undefined {
    if (options.skipSizeLimit) {
        if (text.length > MAX_SKIP_SIZE) {
            return `Input size exceeds maximum limit of ${MAX_SKIP_SIZE} characters even with skipSizeLimit (actual: ${text.length})`;
        }
        return undefined;
    }
    if (text.length > MAX_INPUT_SIZE) {
        return `Input size exceeds maximum limit of ${MAX_INPUT_SIZE} characters (actual: ${text.length})`;
    }
    return undefined;
}

/**
 * Sanitizes `text` with the WASM core for full 21-pattern coverage.
 * Same signature as sanitizeRegex() so it can be swapped in via
 * PrivacyPipeline's ISanitizers dependency injection without changing
 * call sites.
 */
export async function sanitizePiiHybrid(text: string, options: SanitizeOptions = {}): Promise<SanitizeResult> {
    if (!(await isWasmAvailable())) {
        return sanitizeRegex(text, options);
    }

    try {
        const wasmResult = await sanitizePiiWithWasm(text);
        const error = sizeLimitError(text, options);
        return {
            text: wasmResult.text,
            maskedItems: wasmResult.maskedItems,
            ...(error ? { error } : {}),
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
