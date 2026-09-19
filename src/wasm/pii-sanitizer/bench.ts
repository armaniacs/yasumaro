/**
 * Micro-benchmark: TS regex sanitizer vs. WASM sanitizer, same inputs.
 *
 * Run with: npx tsx src/wasm/pii-sanitizer/bench.ts
 *
 * Not part of the CI suite — this is a standalone comparison script for
 * manual verification when touching either implementation. See
 * bench/README.md for the project's actual benchmark harness; this script
 * intentionally stays separate since it exercises a WASM module the main
 * bench harness's node environment doesn't yet initialize.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sanitizeRegex } from '../../utils/piiSanitizer.js';
import initWasmModule, { sanitizePii as sanitizePiiWasm } from './piiSanitizerWasm.js';

// Node has no extension-page fetch(file://) support, unlike the Chrome
// service worker / offscreen doc this module targets in production — read
// the binary directly instead of going through initPiiSanitizerWasm().
async function initForNode(): Promise<void> {
    const wasmPath = fileURLToPath(new URL('./pii_sanitizer_bg.wasm', import.meta.url));
    const bytes = await readFile(wasmPath);
    await initWasmModule({ module_or_path: bytes });
}

function sanitizePiiWithWasm(text: string): { text: string; maskedItems: unknown[] } {
    return sanitizePiiWasm(text) as { text: string; maskedItems: unknown[] };
}

function buildSampleText(repeats: number): string {
    const line =
        'Contact john.doe@example.com or call 03-1234-5678. ' +
        'Card 4111-1111-1111-1111 was charged. My number 1234-5678-9012. ' +
        'Account 1234567 was credited. Some unrelated prose follows here. ';
    return line.repeat(repeats);
}

async function timeIt(label: string, fn: () => Promise<unknown> | unknown, iterations: number): Promise<void> {
    // Warm up (JIT / wasm compile cache).
    await fn();
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
        await fn();
    }
    const elapsed = performance.now() - start;
    console.log(`${label}: ${elapsed.toFixed(2)}ms total, ${(elapsed / iterations).toFixed(4)}ms/iter`);
}

async function main(): Promise<void> {
    await initForNode();

    for (const repeats of [1, 10, 100]) {
        const text = buildSampleText(repeats);
        console.log(`\n--- input size: ${text.length} chars (repeats=${repeats}) ---`);
        await timeIt('TS regex  ', () => sanitizeRegex(text), 50);
        await timeIt('WASM      ', () => sanitizePiiWithWasm(text), 50);
    }
}

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
