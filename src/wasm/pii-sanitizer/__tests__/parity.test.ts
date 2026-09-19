/**
 * Parity check: for every real input the existing PII test suites feed to
 * sanitizeRegex() (captured to captured-inputs.ndjson via setup-capture.ts —
 * see that file for how to regenerate), the WASM core's output must exactly
 * match the TS regex output *restricted to the 5 pattern types the WASM core
 * implements* (email, creditCard, myNumber, phoneJp, bankAccount).
 *
 * The WASM core intentionally covers a subset of piiSanitizer.ts's 24
 * patterns (see wasm/pii-sanitizer/src/lib.rs's module doc), so a TS result
 * that also masked e.g. an `ssn` or `iban` span is expected to differ from
 * the WASM result — those are filtered out of the expected value before
 * comparing (see `filterToWasmPatterns`).
 *
 * This is the regression gate for Phase 2 (production pipeline
 * integration): a wasm/lib.rs change that breaks parity here must not be
 * merged into processPrivacyPipelineStep.ts.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test, expect, beforeAll } from 'vitest';
import { sanitizeRegex } from '../../../utils/piiSanitizer.js';
import initWasmModule, { sanitizePii as sanitizePiiWasmRaw } from '../piiSanitizerWasm.js';

const WASM_COVERED_TYPES = new Set(['email', 'creditCard', 'myNumber', 'phoneJp', 'bankAccount']);

interface MaskedItem {
    type: string;
    original: string;
    index?: number;
}

async function initForNode(): Promise<void> {
    const { readFile } = await import('node:fs/promises');
    const wasmPath = fileURLToPath(new URL('../pii_sanitizer_bg.wasm', import.meta.url));
    const bytes = await readFile(wasmPath);
    await initWasmModule({ module_or_path: bytes });
}

function sanitizePiiWasm(text: string): { text: string; maskedItems: MaskedItem[] } {
    return sanitizePiiWasmRaw(text) as { text: string; maskedItems: MaskedItem[] };
}

/**
 * Re-derives what the *masked text* would look like if only the WASM-covered
 * pattern types had been masked, by re-running the TS scan restricted to
 * those types. piiSanitizer.ts doesn't expose a "patterns subset" option, so
 * this reconstructs it from the full result: re-mask the original text using
 * only the maskedItems whose type is WASM-covered, applied in the same
 * right-to-left order sanitizeRegex uses internally.
 */
function filterToWasmPatterns(originalText: string, fullResult: { maskedItems: MaskedItem[] }): {
    text: string;
    maskedItems: MaskedItem[];
} {
    const covered = fullResult.maskedItems.filter((item) => WASM_COVERED_TYPES.has(item.type));
    // Reconstruct masked text by replacing each covered original substring
    // at its recorded index, right-to-left so indices don't shift.
    const sorted = [...covered].sort((a, b) => (b.index ?? 0) - (a.index ?? 0));
    let text = originalText;
    for (const item of sorted) {
        const idx = item.index ?? 0;
        text = text.slice(0, idx) + `[MASKED:${item.type}]` + text.slice(idx + item.original.length);
    }
    return { text, maskedItems: covered.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)) };
}

function loadCapturedInputs(): string[] {
    const path = fileURLToPath(new URL('./captured-inputs.ndjson', import.meta.url));
    if (!existsSync(path)) {
        return [];
    }
    return readFileSync(path, 'utf-8')
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as string);
}

describe('WASM vs TS regex parity (WASM-covered pattern types only)', () => {
    beforeAll(async () => {
        await initForNode();
    });

    const inputs = loadCapturedInputs();

    test('captured-inputs.ndjson exists and is non-empty', () => {
        // If this fails, regenerate via:
        //   npx vitest run --config vitest.capture.config.ts <the 4 pii suites>
        expect(inputs.length).toBeGreaterThan(0);
    });

    test.each(inputs.map((text, i) => [i, text] as const))(
        'input #%i matches WASM-covered subset (len=%s)',
        async (_i, text) => {
            // Inputs over MAX_PII_INPUT_SIZE are rejected by sanitizeRegex's
            // own size guard before any pattern matching — the WASM core has
            // no such guard (that's the TS wrapper's job in Phase 2), so
            // skip inputs that never reach the regex engine on the TS side.
            if (text.length > 64 * 1024) {
                return;
            }

            let tsFull;
            try {
                tsFull = await sanitizeRegex(text, { includeIndices: true });
            } catch {
                // sanitizeRegex throws on timeout / MAX_MATCH_COUNT overflow
                // (see piiSanitizer.ts's catch block) rather than returning
                // an `error` field for these cases. Timeout/match-count
                // limits are exercised by the ReDoS/security suites
                // deliberately; parity on those paths isn't meaningful here
                // since the WASM core has no timeout concept yet (Phase 2
                // will need to decide whether the TS wrapper enforces these
                // limits before or instead of calling into WASM).
                return;
            }
            if (tsFull.error) {
                // Output-truncation case: TS returns a partial result with
                // `error` set rather than throwing. Same rationale as above.
                return;
            }

            const tsExpected = filterToWasmPatterns(text, tsFull);
            const wasmResult = sanitizePiiWasm(text);

            expect(wasmResult.text).toBe(tsExpected.text);
            expect(wasmResult.maskedItems.map((m) => ({ type: m.type, original: m.original }))).toEqual(
                tsExpected.maskedItems.map((m) => ({ type: m.type, original: m.original }))
            );
        }
    );
});
