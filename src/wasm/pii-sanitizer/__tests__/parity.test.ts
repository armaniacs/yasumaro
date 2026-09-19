/**
 * Parity check: for every real input the existing PII test suites feed to
 * sanitizeRegex() (captured to captured-inputs.ndjson via setup-capture.ts —
 * see that file for how to regenerate), the WASM core's output must exactly
 * match the full TS regex output. The WASM core now implements all 21
 * pattern types from PII_PATTERNS in piiSanitizer.ts (see
 * wasm/pii-sanitizer/src/patterns/{core5,extended}.rs), so no filtering of
 * the TS result is needed — full-fidelity comparison.
 *
 * This is the regression gate for both Phase 2 (production pipeline
 * integration) and Phase 3 (the 16-pattern extension): a wasm/*.rs change
 * that breaks parity here must not ship.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test, expect, beforeAll } from 'vitest';
import { sanitizeRegex } from '../../../utils/piiSanitizer.js';
import initWasmModule, { sanitizePii as sanitizePiiWasmRaw } from '../piiSanitizerWasm.js';

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

describe('WASM vs TS regex parity (all 21 pattern types)', () => {
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
        'input #%i matches TS regex output exactly (len=%s)',
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

            const wasmResult = sanitizePiiWasm(text);

            expect(wasmResult.text).toBe(tsFull.text);
            expect(wasmResult.maskedItems.map((m) => ({ type: m.type, original: m.original }))).toEqual(
                tsFull.maskedItems.map((m) => ({ type: m.type, original: m.original }))
            );
        }
    );
});
