/**
 * markdownSanitizerHybrid.ts
 * Hybrid Markdown sanitization: runs the WASM core (see
 * wasm/md-sanitize/src/sanitize.rs — an exact port of
 * markdownSanitizer.ts's sanitizeForObsidian chain) on the success path and
 * falls back to the TS implementation (src/utils/markdownSanitizer.ts) when
 * the WASM module fails to initialize (e.g. CSP blocked the fetch, or an
 * unsupported runtime), when the input routes to TS by size, or when a WASM
 * call throws at runtime.
 *
 * Output parity: the WASM core reproduces the TS chain bit-identically
 * (link escaping → wikilink escaping → `&`-first entity encoding, including
 * the `[^)]+`-stops-at-first-`)` behavior and the leftmost-match
 * bracket-consumption quirk). The batch entry points exchange a JS string
 * array via serde_wasm_bindgen, so entries with embedded newlines round-trip
 * instead of tripping a split gate (the tag-cooccur `\n`-join transfer is
 * deliberately NOT reused here — see wasm/md-sanitize/src/lib.rs). Any WASM
 * failure re-runs the TS path rather than emitting wrong output.
 *
 * Early-return parity with the TS reference:
 * - empty string → `''` (both paths; the scanners emit nothing).
 * - non-string input → returned as-is (the TS `typeof` guard; the wrapper
 *   never throws non-strings into WASM).
 *
 * HONEST BENCH NOTE (2026-09-21, src/wasm/md-sanitize/bench-result.json):
 * WASM loses to TS at every measured size — single 128B→128KB: 0.31x→
 * 0.77x (best), batch 100x0.5KB: 0.57x, batch 2000x0.5KB (PBI size):
 * 0.64x (TS 5.2ms vs WASM 8.1ms), batch 10000x0.2KB: 0.63x. This workload
 * is memory-bandwidth bound (~1:1 input:output size): the wasm-bindgen
 * UTF-8 encode/decode copies dominate the trivial scan, and V8's string
 * builtins win per byte — so no crossover is expected at larger sizes
 * either. The thresholds below therefore park ALL production sizes on the
 * TS engine (dark-launch wiring): the export path gets identical output
 * with zero regression risk, while the WASM path stays parity-gated in CI
 * and is exercised by the wasm-success suite with over-threshold inputs.
 * Re-enable by lowering the thresholds after transfer optimization
 * (zero-copy/shared-memory input — see the follow-up PBI).
 */

import {
    sanitizeForObsidian,
} from './markdownSanitizer.js';
import {
    sanitizeForObsidianWithWasm,
    sanitizeBatchWithWasm,
    sanitizeBatchAndJoinWithWasm,
    initMdSanitizeWasm,
} from '../wasm/md-sanitize/index.js';
import { errorMessage } from './errorUtils.js';
import { addLog } from './logger/core.js';
import { LogType } from './logger/types.js';

let wasmAvailable: boolean | null = null;

/**
 * Probes WASM availability once per context lifetime (mirrors
 * initMdSanitizeWasm's own singleton-promise caching) so a permanently
 * broken environment doesn't retry-and-fail on every call.
 */
async function isWasmAvailable(): Promise<boolean> {
    if (wasmAvailable !== null) {
        return wasmAvailable;
    }
    try {
        await initMdSanitizeWasm();
        wasmAvailable = true;
    } catch (error: unknown) {
        wasmAvailable = false;
        const message = errorMessage(error);
        console.warn('md-sanitize WASM module unavailable, falling back to TS:', message);
        addLog(LogType.WARN, 'md-sanitize WASM module unavailable, falling back to TS', {
            error: message,
        });
    }
    return wasmAvailable;
}

/**
 * Single-input WASM floor (chars). Per the bench note above, WASM loses at
 * every measured size up to 128KB single / 2MB batch-total, so this floor
 * sits above the measured range: production inputs (export summaries,
 * review titles — single KBs) always take the TS path. Lower it only after
 * transfer optimization flips the bench.
 */
export const MIN_WASM_CHARS = 1_048_576;

/**
 * Batch-total WASM floor (sum of input chars). Same dormancy rationale as
 * MIN_WASM_CHARS: a 2000-entry export (~1MB total) stays on TS.
 */
export const MIN_WASM_TOTAL_CHARS = 2_097_152;

/**
 * Sanitizes one string with the WASM core, falling back to the sync TS
 * sanitizeForObsidian() on any WASM unavailability, size bypass, or runtime
 * error. Async so call sites must await it — exportLogsService.exportMarkdown
 * is already async, so no sync→async migration wave there. Sync callers
 * (reviewSummaryGenerator, markdownFormatter) stay on the direct TS import
 * until their own wiring PBI lands.
 */
export async function sanitizeForObsidianHybrid(content: string): Promise<string> {
    if (typeof content !== 'string') {
        return content;
    }
    if (content.length === 0) {
        return '';
    }
    if (content.length < MIN_WASM_CHARS || !(await isWasmAvailable())) {
        return sanitizeForObsidian(content);
    }
    try {
        return await sanitizeForObsidianWithWasm(content);
    } catch (error: unknown) {
        const message = errorMessage(error);
        console.warn('md-sanitize WASM call failed, falling back to TS for this input:', message);
        addLog(LogType.WARN, 'md-sanitize WASM call failed, falling back to TS for this input', {
            error: message,
        });
        return sanitizeForObsidian(content);
    }
}

/** Sums input chars without materializing a joined string. */
function totalChars(inputs: string[]): number {
    let total = 0;
    for (const s of inputs) total += s.length;
    return total;
}

/**
 * Sanitizes a batch in one WASM call, falling back to the TS map on the
 * same conditions as the single path. Non-string elements are passed
 * through as-is to preserve the TS `typeof` guard element-wise.
 */
export async function sanitizeBatchHybrid(inputs: string[]): Promise<string[]> {
    if (inputs.length === 0) {
        return [];
    }
    if (totalChars(inputs) < MIN_WASM_TOTAL_CHARS || !(await isWasmAvailable())) {
        return inputs.map(sanitizeForObsidian);
    }
    try {
        return await sanitizeBatchWithWasm(inputs);
    } catch (error: unknown) {
        const message = errorMessage(error);
        console.warn('md-sanitize WASM batch failed, falling back to TS for this input:', message);
        addLog(LogType.WARN, 'md-sanitize WASM batch failed, falling back to TS for this input', {
            error: message,
        });
        return inputs.map(sanitizeForObsidian);
    }
}

/**
 * Batch-sanitizes and joins with `separator` in one WASM call, falling back
 * to the TS map+join. Mirrors `inputs.map(sanitizeForObsidian).join(sep)`.
 */
export async function sanitizeBatchAndJoinHybrid(
    inputs: string[],
    separator: string
): Promise<string> {
    if (inputs.length === 0) {
        return '';
    }
    if (totalChars(inputs) < MIN_WASM_TOTAL_CHARS || !(await isWasmAvailable())) {
        return inputs.map(sanitizeForObsidian).join(separator);
    }
    try {
        return await sanitizeBatchAndJoinWithWasm(inputs, separator);
    } catch (error: unknown) {
        const message = errorMessage(error);
        console.warn('md-sanitize WASM batch+join failed, falling back to TS for this input:', message);
        addLog(LogType.WARN, 'md-sanitize WASM batch+join failed, falling back to TS for this input', {
            error: message,
        });
        return inputs.map(sanitizeForObsidian).join(separator);
    }
}
