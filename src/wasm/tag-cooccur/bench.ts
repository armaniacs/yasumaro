/**
 * Micro-benchmark: TS tag cooccurrence vs. WASM cooccurrence, same inputs.
 *
 * Run with: npx tsx src/wasm/tag-cooccur/bench.ts [--out <json>]
 *
 * Not part of the CI suite — this is a standalone comparison script for
 * manual verification when touching either implementation, mirroring
 * src/wasm/sentence-dedup/bench.ts. See bench/README.md for the project's
 * actual benchmark harness; this script stays separate since it exercises a
 * WASM module the main bench harness's node environment doesn't initialize.
 *
 * Benchmarking idea (what to look for): the dominant cost is the O(T^2)
 * pair scan over per-record tag sets plus one Set<string> allocation per
 * record on the TS path. The WASM side is timed on the production per-call
 * path — transfer (`joinRawTags`), raw core, and the wrapper's
 * validation/decode (`decodeCooccurResult`, which re-merges edge weights
 * by the raw `${a}|${b}` key) — NOT on the raw glue alone, since the
 * wrapper decode is part of every real call. The raw-core row is kept for
 * reference. Expect the gap to widen with
 * record count and tags-per-record (quadratic pair scan), while tiny inputs
 * lose to the fixed wasm-bindgen marshalling cost — those stay on the TS
 * path via the hybrid's size routing (see MIN_WASM_ENTRIES in
 * src/dashboard/tagCooccurrenceHybrid.ts, threshold chosen from this
 * script's small-input rows).
 */

import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { computeTagCooccurrence } from '../../dashboard/tagCooccurrence.js';
import initWasmModule, { computeCooccurrence } from './tagCooccurWasm.js';
import { decodeCooccurResult, joinRawTags } from './index.js';

// Node has no extension-page fetch(file://) support, unlike the dashboard
// page this module targets in production — read the binary directly instead
// of going through initTagCooccurWasm().
async function initForNode(): Promise<void> {
    const wasmPath = fileURLToPath(new URL('./tag_cooccur_bg.wasm', import.meta.url));
    const bytes = await readFile(wasmPath);
    await initWasmModule({ module_or_path: bytes });
}

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const POOL = Array.from({ length: 200 }, (_, i) => `tag${i}`);

function makeEntries(n: number, tagsPer: number): Array<{ tags: string }> {
    const rand = mulberry32(42);
    return Array.from({ length: n }, () => {
        const picked = new Set<string>();
        while (picked.size < tagsPer) picked.add(POOL[Math.floor(rand() * POOL.length)]!);
        return { tags: [...picked].map((t) => `#${t}`).join(' ') };
    });
}

interface RawResult {
    tags: string[];
    counts: number[];
    edgeA: number[];
    edgeB: number[];
    weights: number[];
}

function cooccurCoreWithWasm(entries: Array<{ tags?: string | null }>): RawResult {
    // Raw glue only: transfer + core, no validation/decode. Reported for
    // reference; the production threshold must come from the wrapper row.
    return computeCooccurrence(joinRawTags(entries), entries.length) as RawResult;
}

function cooccurWithWasm(entries: Array<{ tags?: string | null }>): ReturnType<typeof decodeCooccurResult> {
    // Production per-call path: transfer + core + validation/decode
    // (decodeCooccurResult). The one-time module init stays out of the
    // timed loop — same as the extension, where initExtensionWasm is
    // memoized before the first render.
    return decodeCooccurResult(cooccurCoreWithWasm(entries));
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

    const scenarios = [
        { n: 100, tagsPer: 6, iters: 30, label: 'small (100x6)' },
        { n: 500, tagsPer: 8, iters: 15, label: 'medium (500x8)' },
        { n: 1000, tagsPer: 8, iters: 10, label: 'large (1000x8)' },
        { n: 5000, tagsPer: 12, iters: 5, label: 'xlarge (5000x12)' },
        { n: 10000, tagsPer: 20, iters: 3, label: 'max (10000x20)' },
    ];

    const rows: Array<Record<string, number | string | boolean>> = [];
    for (const { n, tagsPer, iters, label } of scenarios) {
        const entries = makeEntries(n, tagsPer);
        console.log(`\n--- ${label} ---`);
        const ts = timeIt('TS   computeTagCooccurrence ', () => computeTagCooccurrence(entries), iters);
        const wasmCore = timeIt('WASM core (raw glue)        ', () => cooccurCoreWithWasm(entries), iters);
        const wasm = timeIt('WASM wrapper (production)   ', () => cooccurWithWasm(entries), iters);

        // Parity spot check on this corpus through the production decode
        // path: identical output, or the difference is a bug in one of the
        // two implementations.
        const tsRes = JSON.stringify(computeTagCooccurrence(entries));
        const wasmRes = JSON.stringify(cooccurWithWasm(entries));
        const parity = tsRes === wasmRes;
        console.log(`parity on this corpus: ${parity ? 'OK' : 'MISMATCH'}`);
        if (!parity) process.exitCode = 1;
        console.log(`speedup (production wrapper path): ${(ts / wasm).toFixed(2)}x`);
        rows.push({
            label,
            n,
            tagsPer,
            iters,
            tsMs: ts,
            wasmCoreMs: wasmCore,
            wasmWrapperMs: wasm,
            speedupProduction: ts / wasm,
            speedupCore: ts / wasmCore,
            parity,
        });
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
