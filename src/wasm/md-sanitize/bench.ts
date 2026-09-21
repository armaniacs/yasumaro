/**
 * Micro-benchmark: TS sanitizeForObsidian vs. WASM core, same inputs.
 *
 * Run with: npx tsx src/wasm/md-sanitize/bench.ts [--out <json>]
 *
 * Not part of the CI suite — a standalone comparison script for manual
 * verification when touching either implementation, mirroring
 * src/wasm/tag-cooccur/bench.ts. See bench/README.md for the project's
 * actual benchmark harness; this script stays separate since it exercises a
 * WASM module the main bench harness's node environment doesn't initialize.
 *
 * Benchmarking idea (what to look for): the dominant cost is the per-entry
 * three-stage scan plus one intermediate-string allocation per stage on the
 * TS path. The WASM side is timed on the production per-call path — the
 * wrapper functions in ./index.ts (transfer + core + shape validation),
 * NOT on the raw glue alone. The batch entry points amortize the fixed
 * wasm-bindgen marshalling cost over N entries, so expect the single-call
 * rows to show a small-input crossover (tiny inputs stay on the TS path
 * via the hybrid's size routing — see MIN_WASM_CHARS in
 * src/utils/markdownSanitizerHybrid.ts, threshold chosen from this
 * script's single-input rows) while the batch rows should win at every
 * production size.
 */

import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sanitizeForObsidian } from '../../utils/markdownSanitizer.js';
import initWasmModule, {
    sanitizeForObsidian as sanitizeSingleWasm,
    sanitizeBatch as sanitizeBatchWasm,
    sanitizeBatchAndJoin as sanitizeBatchAndJoinWasm,
} from './mdSanitizeWasm.js';

// Node has no extension-page fetch(file://) support, unlike the dashboard
// page and service worker this module targets in production — read the
// binary directly instead of going through initMdSanitizeWasm().
async function initForNode(): Promise<void> {
    const wasmPath = fileURLToPath(new URL('./md_sanitize_bg.wasm', import.meta.url));
    const bytes = await readFile(wasmPath);
    await initWasmModule({ module_or_path: bytes });
}

function makeSummary(i: number, bytes: number): string {
    const base = `Entry ${i} summary with [link${i}](https://example.com/p/${i}?a=1&b=2) and [[wiki${i}]] plus <b>html</b> & entities.\nSecond line of body text.\n`;
    return base.repeat(Math.ceil(bytes / base.length)).slice(0, bytes);
}

function timeIt(label: string, fn: () => unknown, iterations: number): number {
    for (let i = 0; i < 3; i++) fn(); // warm up (JIT / wasm compile cache)
    if (typeof globalThis.gc === 'function') globalThis.gc();
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    const duration = performance.now() - start;
    const perOp = duration / iterations;
    console.log(`${label}: ${perOp.toFixed(3)} ms/op (${iterations} ops)`);
    return perOp;
}

async function main(): Promise<void> {
    await initForNode();

    const rows: Array<Record<string, number | string | boolean>> = [];

    // --- Single-input crossover sweep (drives MIN_WASM_CHARS) ---
    console.log('\n=== single-input crossover ===');
    for (const bytes of [128, 512, 1024, 4096, 16384, 131072]) {
        const input = makeSummary(0, bytes);
        const iters = bytes < 2048 ? 200 : 20;
        const ts = timeIt(`TS   single ${String(bytes).padStart(7)}B  `, () => sanitizeForObsidian(input), iters);
        const wasm = timeIt(`WASM single ${String(bytes).padStart(7)}B  `, () => sanitizeSingleWasm(input), iters);
        const parity = (sanitizeSingleWasm(input) as unknown as string) === sanitizeForObsidian(input);
        console.log(`parity: ${parity ? 'OK' : 'MISMATCH'}, speedup: ${(ts / wasm).toFixed(2)}x\n`);
        if (!parity) process.exitCode = 1;
        rows.push({ kind: 'single', bytes, iters, tsMs: ts, wasmMs: wasm, speedup: ts / wasm, parity });
    }

    // --- Batch rows (production export path: 2000 x 0.5KB per PBI) ---
    console.log('=== batch (production path) ===');
    for (const [n, bytes, iters, label] of [
        [100, 512, 30, 'batch 100x0.5KB'],
        [2000, 512, 10, 'batch 2000x0.5KB (PBI)'],
        [10000, 200, 3, 'batch 10000x0.2KB'],
    ] as Array<[number, number, number, string]>) {
        const entries = Array.from({ length: n }, (_, i) => makeSummary(i, bytes));
        const ts = timeIt(`TS   ${label} `, () => entries.map(sanitizeForObsidian), iters);
        const wasmBatch = timeIt(`WASM ${label} (batch array) `, () => sanitizeBatchWasm(entries), iters);
        const wasmJoin = timeIt(`WASM ${label} (batch+join)  `, () => sanitizeBatchAndJoinWasm(entries, '\n---\n'), iters);
        const tsJoined = entries.map(sanitizeForObsidian).join('\n---\n');
        const parity =
            JSON.stringify(sanitizeBatchWasm(entries)) === JSON.stringify(entries.map(sanitizeForObsidian)) &&
            (sanitizeBatchAndJoinWasm(entries, '\n---\n') as unknown as string) === tsJoined;
        console.log(`parity: ${parity ? 'OK' : 'MISMATCH'}, speedup (batch): ${(ts / wasmBatch).toFixed(2)}x\n`);
        if (!parity) process.exitCode = 1;
        rows.push({ kind: label, n, bytes, iters, tsMs: ts, wasmBatchMs: wasmBatch, wasmJoinMs: wasmJoin, speedup: ts / wasmBatch, parity });
    }

    const outIdx = process.argv.indexOf('--out');
    if (outIdx !== -1 && process.argv[outIdx + 1]) {
        writeFileSync(
            process.argv[outIdx + 1]!,
            JSON.stringify({ node: process.version, date: new Date().toISOString(), rows }, null, 2)
        );
    }
}

void main();
