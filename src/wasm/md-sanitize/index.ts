/**
 * TypeScript wrapper around the Rust/WASM Markdown sanitization core.
 *
 * Ports `sanitizeForObsidian` from src/utils/markdownSanitizer.ts (see
 * wasm/md-sanitize/src/sanitize.rs for the parity contracts, including the
 * `[^)]+`-stops-at-first-`)` behavior and the leftmost-match
 * bracket-consumption quirk). The intended caller is
 * src/utils/markdownSanitizerHybrid.ts, which falls back to the TS
 * implementation when this module fails to load.
 *
 * Data-transfer shape (newline-safe by design): export bodies contain `\n`,
 * so the tag-cooccur `\n`-joined single-string transfer with its
 * split-agreement gate is unusable here — an embedded newline would trip
 * the gate and force every export through the TS fallback. Instead the
 * batch entry points exchange a JS string ARRAY via serde_wasm_bindgen
 * (`Vec<String>` in both directions): embedded newlines, `]`/`)`
 * delimiters, and empty strings cross without escaping or ambiguity, and
 * the array length is the record count (no gate, no split, no shift risk).
 * Single-string inputs use the plain `String` boundary, equally
 * newline-safe. See wasm/md-sanitize/src/lib.rs for the full contract.
 *
 * Loading follows the shared contract in `../initWasm.ts`: binary at the
 * stable public path `wasm/md_sanitize_bg.wasm` (fetched via
 * `chrome.runtime.getURL()`). Shipped: the binary is committed to BOTH
 * `src/wasm/md-sanitize/` (parity suites + bench read it) and `public/wasm/`
 * (wxt's publicAssets hook distributes it to `dist/wasm/`), and the
 * production call site is src/dashboard/exportLogsService.ts via
 * src/utils/markdownSanitizerHybrid.ts. Do NOT switch this to
 * `new URL('./md_sanitize_bg.wasm', import.meta.url)` — under the
 * single-file IIFE background build Vite inlines that as a CSP-blocked
 * `data:` URI and the module silently fails in every real build (see
 * src/wasm/pii-sanitizer/index.ts's module doc for the full story).
 */

import initWasmModule, {
    sanitizeForObsidian as sanitizeForObsidianWasm,
    sanitizeBatch as sanitizeBatchWasm,
    sanitizeBatchAndJoin as sanitizeBatchAndJoinWasm,
} from './mdSanitizeWasm.js';
import { initExtensionWasm } from '../initWasm.js';
import { errorMessage } from '../../utils/errorUtils.js';

/**
 * Initializes the wasm module. Safe to call repeatedly (idempotent) and
 * from multiple call sites — all callers share the same in-flight promise
 * so the binary is fetched/compiled exactly once per worker lifetime,
 * with reset-on-failure so a transient fetch error can be retried.
 */
export function initMdSanitizeWasm(): Promise<void> {
    return initExtensionWasm('md_sanitize_bg.wasm', (url) =>
        initWasmModule({ module_or_path: url })
    );
}

/**
 * Guards the TS `typeof content !== 'string'` early return at the boundary:
 * non-strings cannot cross into WASM and are returned as-is, exactly like
 * the TS reference (`sanitizeForObsidian` returns its input unchanged).
 */
function guardNonString<T>(input: T): input is T {
    return typeof input !== 'string';
}

/**
 * Runs the WASM single-string sanitization. Must call initMdSanitizeWasm()
 * first (or await it here) — throws if the module isn't loaded or the call
 * fails; callers treat any throw as "fall back to the TS path".
 */
export async function sanitizeForObsidianWithWasm(input: string): Promise<string> {
    await initMdSanitizeWasm();
    try {
        if (guardNonString(input)) {
            return input;
        }
        const out = sanitizeForObsidianWasm(input);
        if (typeof out !== 'string') {
            throw new Error('md-sanitize wasm returned a non-string result');
        }
        return out;
    } catch (error: unknown) {
        throw error instanceof Error ? error : new Error(errorMessage(error));
    }
}

/**
 * Sanitizes a batch of strings in a single WASM call. Validates the
 * round-trip shape (same order, same length, all strings) so a corrupt
 * core result falls back to TS instead of emitting shifted output.
 */
export async function sanitizeBatchWithWasm(inputs: string[]): Promise<string[]> {
    await initMdSanitizeWasm();
    try {
        const out = sanitizeBatchWasm(inputs) as unknown;
        if (!Array.isArray(out) || out.length !== inputs.length || out.some((s) => typeof s !== 'string')) {
            throw new Error(
                `md-sanitize wasm batch shape mismatch (wasm ${Array.isArray(out) ? out.length : 'non-array'} vs js ${inputs.length} records)`
            );
        }
        return out as string[];
    } catch (error: unknown) {
        throw error instanceof Error ? error : new Error(errorMessage(error));
    }
}

/**
 * Sanitizes a batch and joins the results with `separator` inside WASM.
 * Mirrors `inputs.map(sanitizeForObsidian).join(separator)`.
 */
export async function sanitizeBatchAndJoinWithWasm(
    inputs: string[],
    separator: string
): Promise<string> {
    await initMdSanitizeWasm();
    try {
        const out = sanitizeBatchAndJoinWasm(inputs, separator) as unknown;
        if (typeof out !== 'string') {
            throw new Error('md-sanitize wasm batch-and-join returned a non-string result');
        }
        return out;
    } catch (error: unknown) {
        throw error instanceof Error ? error : new Error(errorMessage(error));
    }
}
