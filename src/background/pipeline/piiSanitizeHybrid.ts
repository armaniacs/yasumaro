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
 * Size-limit contract: the pure helpers below (piiInputSizeError /
 * piiOutputTruncationError, single-sourced from piiSanitizer.ts's exported
 * MAX_* constants) reproduce sanitizeRegex's
 * three guard paths without running its scan — the input-size rejection
 * (>MAX_INPUT_SIZE, or the 512KB hard cap when skipSizeLimit is set) via the
 * same `error` message, and the output-size truncation (>MAX_OUTPUT_SIZE,
 * reached through mask-placeholder expansion) via the same
 * truncate-and-error result. The WASM core has no size concept by design
 * (see wasm/pii-sanitizer/src/lib.rs's module doc — the TS wrapper owns
 * size/timeout handling). Masking still runs on oversized inputs (same
 * observable behavior as the two-pass revision, where the WASM result
 * reached callers with the error attached).
 *
 * Item contract: `index` is emitted only when includeIndices is set (as in
 * sanitizeRegex), and a WASM index is a byte offset into the UTF-8 input —
 * sanitizeRegex's is a UTF-16 offset. No current caller reads `.index`.
 *
 * A `[MASKED:<type>]` placeholder produced by the WASM pass contains no
 * digits, `@`, or characters any of the 21 patterns require — safe if a
 * caller ever re-sanitizes already-masked text (see
 * src/background/pipeline/__tests__/piiSanitizeHybrid.test.ts).
 */

import {
    sanitizeRegex,
    MAX_INPUT_SIZE,
    MAX_OUTPUT_SIZE,
    MAX_SKIP_SIZE,
    type SanitizeOptions,
    type SanitizeResult,
} from '../../utils/piiSanitizer.js';
import type { MaskedItem } from '../../messaging/types.js';
import { sanitizePiiWithWasm, initPiiSanitizerWasm } from '../../wasm/pii-sanitizer/index.js';
import {
    createHybridProbe,
    runHybrid,
} from '../../utils/wasmHybridRuntime.js';

/**
 * Reproduces sanitizeRegex's input-size rejection message for `text`
 * without running its scan, so the PII WASM path reports the same `error`
 * field the TS path would. Lives here (Checking Team 2026-09-22:
 * Maintainability Medium — the shared runtime owns mechanism only; PII
 * size policy belongs to the hybrid that uses it), single-sourced from
 * piiSanitizer.ts's exported MAX_INPUT_SIZE / MAX_SKIP_SIZE constants.
 * The WASM core itself has no size concept by design (see
 * wasm/pii-sanitizer/src/lib.rs); the TS wrapper owns size handling.
 */
export function piiInputSizeError(text: string, options: SanitizeOptions): string | undefined {
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
 * The `Output truncated to …` error string, single-sourced from
 * piiSanitizer.ts's exported MAX_OUTPUT_SIZE constant.
 */
export function piiOutputTruncationError(): string {
    return `Output truncated to ${MAX_OUTPUT_SIZE} characters`;
}

const probe = createHybridProbe(
    initPiiSanitizerWasm,
    // e2e tests assert on this console.warn directly via Playwright's
    // Worker.on('console', ...) — see
    // testDir/e2e/pii-wasm-initialization.spec.ts, the regression guard for
    // a real bug where this path fired on every single call in every
    // production build (WASM was silently inlined as a CSP-blocked `data:`
    // URI — see wasm/pii-sanitizer/index.ts).
    'PII WASM module unavailable, falling back to TS-only sanitization'
);

/**
 * Strips `index` unless includeIndices is set — sanitizeRegex only emits
 * `index` when asked for it, so the WASM path must not emit it by default.
 * When present, a WASM index is a byte offset into the UTF-8 input (see
 * wasm/pii-sanitizer/src/lib.rs), not sanitizeRegex's UTF-16 offset.
 */
function shapeItems(items: Array<{ type: string; original: string; index: number }>, includeIndices: boolean): MaskedItem[] {
    return items.map((item) =>
        includeIndices
            ? { type: item.type, original: item.original, index: item.index }
            : { type: item.type, original: item.original },
    );
}

/**
 * Sanitizes `text` with the WASM core for full 21-pattern coverage.
 * Same signature as sanitizeRegex() so it can be swapped in via
 * PrivacyPipeline's ISanitizers dependency injection without changing
 * call sites.
 */
export async function sanitizePiiHybrid(text: string, options: SanitizeOptions = {}): Promise<SanitizeResult> {
    // A WASM call failing at runtime (not just at init) falls back to
    // TS-only for this call rather than propagating, since PII masking
    // failing closed (throwing) would abort the whole recording pipeline
    // for a WASM-specific fault. (A throwing TS fallback still propagates
    // — e.g. match-count overflow fails closed.)
    return runHybrid({
        probe,
        fallbackMessage: 'PII WASM sanitize call failed, falling back to TS regex for this input',
        mergeDefaults: () => options,
        callWasm: async (opts) => {
            const wasmResult = await sanitizePiiWithWasm(text);
            // Per-core policy: reproduce sanitizeRegex's size-limit
            // rejection message (single-sourced from the shared runtime, see
            // piiInputSizeError) without running its scan. Masking still
            // runs on oversized inputs (same observable behavior as the
            // two-pass revision), with the input-size error attached and no
            // output truncation — the TS truncation path only ever applies
            // to inputs that passed the pre-scan size gate.
            const inputSizeError = piiInputSizeError(text, opts);
            if (inputSizeError) {
                return {
                    text: wasmResult.text,
                    maskedItems: shapeItems(wasmResult.maskedItems, opts.includeIndices === true),
                    error: inputSizeError,
                };
            }
            // Output-size truncation (mask placeholders expand text, so masked
            // output can exceed the cap even when the input was under it).
            if (wasmResult.text.length > MAX_OUTPUT_SIZE) {
                return {
                    text: wasmResult.text.substring(0, MAX_OUTPUT_SIZE),
                    maskedItems: shapeItems(
                        wasmResult.maskedItems.filter((item) => item.index < MAX_OUTPUT_SIZE),
                        opts.includeIndices === true,
                    ),
                    error: piiOutputTruncationError(),
                };
            }
            return {
                text: wasmResult.text,
                maskedItems: shapeItems(wasmResult.maskedItems, opts.includeIndices === true),
            };
        },
        callTs: (opts) => sanitizeRegex(text, opts),
    });
}
