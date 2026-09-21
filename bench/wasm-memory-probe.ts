/**
 * Memory probe: TS vs WASM heap / linear-memory footprint per crate.
 *
 * Run with: NODE_OPTIONS="--expose-gc" npx tsx bench/wasm-memory-probe.ts [--out <json>]
 *
 * NOT part of the CI suite — a standalone measurement script. The
 * performance-focused benches (src/wasm/<crate>/bench.ts) measure wall-clock
 * only; this probe exists because the WASM ports also claim reduced memory
 * pressure (per-sentence Set<string>, per-record Maps, edge Maps, regex
 * match garbage), and no automated test measured that claim until now.
 *
 * Metrics per arm (3 rounds, median):
 * - heapFootprint  : heapUsed delta across K calls WITHOUT an intervening
 *                    GC — the allocation footprint of the calls (peak
 *                    pressure proxy). Garbage collected mid-loop by V8 makes
 *                    this a lower bound, so medians over rounds matter.
 * - heapRetained   : heapUsed delta after forced GC — allocations that
 *                    SURVIVE the call (for both paths this should be ~0
 *                    since outputs are dropped; a large number means the
 *                    arm leaks or holds module-level caches).
 * - rssDelta / arrayBuffersDelta : process-wide growth after forced GC.
 *                    WASM linear memory is NOT in heapUsed — it lands in
 *                    the process RSS (and in arrayBuffers backing stores on
 *                    modern Node), so rising rss on the WASM arm is the
 *                    expected linear-memory cost, while flat heapUsed is the
 *                    claimed JS-heap win.
 *
 * All arms run sequentially in one process (same V8/WASM state); forceGC()
 * between rounds keeps rounds comparable. Parity is checked once per arm.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

import { sanitizeRegex } from '../src/utils/piiSanitizer.js';
import { extractSentences } from '../src/utils/sentenceExtractor.js';
import { splitSentences } from '../src/utils/text/tokenizer.js';
import { deduplicateContent, splitSentencesKeepDelimiters } from '../src/utils/contentDeduplicator.js';
import { computeTagCooccurrence } from '../src/dashboard/tagCooccurrence.js';

import initPiiModule, { sanitizePii as sanitizePiiWasm } from '../src/wasm/pii-sanitizer/piiSanitizerWasm.js';
import initTextrankModule, { extractTopIndices } from '../src/wasm/textrank/textrankWasm.js';
import initDedupModule, { deduplicateIndices } from '../src/wasm/sentence-dedup/sentenceDedupWasm.js';
import initCooccurModule, { computeCooccurrence } from '../src/wasm/tag-cooccur/tagCooccurWasm.js';
import { decodeCooccurResult, joinRawTags } from '../src/wasm/tag-cooccur/index.js';

async function readBinary(relPath: string): Promise<Buffer> {
    const p = fileURLToPath(new URL(relPath, import.meta.url));
    return readFile(p);
}

function forceGC(): void {
    const g = globalThis as { gc?: () => void };
    if (typeof g.gc !== 'function') {
        throw new Error('run with NODE_OPTIONS="--expose-gc" (or node --expose-gc)');
    }
    for (let i = 0; i < 3; i++) g.gc!();
}

interface Snap {
    heapUsed: number;
    rss: number;
    arrayBuffers: number;
}

function snap(): Snap {
    const m = process.memoryUsage();
    return { heapUsed: m.heapUsed, rss: m.rss, arrayBuffers: m.arrayBuffers };
}

interface RoundMetrics {
    /** heapUsed growth across K calls, no intervening GC (peak-pressure proxy). */
    heapFootprint: number;
    /** heapUsed growth still present after forced GC (survivors/caches). */
    heapRetained: number;
    rssDelta: number;
    arrayBuffersDelta: number;
}

function measureRound(runCalls: () => void | Promise<void>, calls: number): Promise<RoundMetrics> {
    return (async () => {
        forceGC();
        const before = snap();
        for (let i = 0; i < calls; i++) await runCalls();
        const afterPre = snap();
        const heapFootprint = afterPre.heapUsed - before.heapUsed;
        forceGC();
        const afterRetained = snap();
        return {
            heapFootprint,
            heapRetained: afterRetained.heapUsed - before.heapUsed,
            rssDelta: afterRetained.rss - before.rss,
            arrayBuffersDelta: afterRetained.arrayBuffers - before.arrayBuffers,
        };
    })();
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
}

interface ArmResult {
    arm: 'TS' | 'WASM';
    heapFootprintPerCall: number;
    heapRetained: number;
    rssDelta: number;
    arrayBuffersDelta: number;
    parity: boolean;
}

/** 3 rounds, median per metric. */
async function measureArm(arm: 'TS' | 'WASM', runCalls: () => void | Promise<void>, calls: number, parity: boolean): Promise<ArmResult> {
    // Warm up (JIT / wasm compile cache / lazy module-level tables).
    for (let i = 0; i < 3; i++) await runCalls();
    forceGC();
    const rounds: RoundMetrics[] = [];
    for (let r = 0; r < 3; r++) rounds.push(await measureRound(runCalls, calls));
    return {
        arm,
        heapFootprintPerCall: median(rounds.map((r) => r.heapFootprint)) / calls,
        heapRetained: median(rounds.map((r) => r.heapRetained)),
        rssDelta: median(rounds.map((r) => r.rssDelta)),
        arrayBuffersDelta: median(rounds.map((r) => r.arrayBuffersDelta)),
        parity,
    };
}

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(2)}MB`;

// ---------------------------------------------------------------------------
// Corpora (mirroring each crate's bench.ts so the numbers are comparable).
// ---------------------------------------------------------------------------

function piiCorpus(): string {
    const line =
        'Contact john.doe@example.com or call 03-1234-5678. ' +
        'Card 4111-1111-1111-1111 was charged. My number 1234-5678-9012. ' +
        'Account 1234567 was credited. Some unrelated prose follows here. ';
    return line.repeat(100);
}

function textrankCorpus(): string {
    const paragraph =
        'The recording pipeline compresses page content before every AI summary request. ' +
        'TextRank builds a sentence similarity graph and ranks each sentence by importance. ' +
        '日本語の文章では単語境界が曖昧なため、文字バイグラムで類似度を計算します。 ' +
        'WebAssembly moves the quadratic similarity matrix out of the JavaScript heap. ';
    return paragraph.repeat(40);
}

function dedupCorpus(): string {
    const paragraph =
        'The recording pipeline compresses page content before every AI summary request. ' +
        'TextRank builds a sentence similarity graph and ranks each sentence by importance. ' +
        '日本語の文章では単語境界が曖昧なため、文字バイグラムで類似度を計算します。 ' +
        'WebAssembly moves the quadratic similarity scan out of the JavaScript heap. ';
    const duplicate =
        'This sentence repeats over and over again to exercise the deduplication scan. ';
    return (paragraph + duplicate).repeat(150);
}

interface TagEntry {
    tags?: string | null;
}

function tagCorpus(n = 10_000, tagsPer = 20): TagEntry[] {
    let s = 42;
    const rand = (): number => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
    };
    const POOL = Array.from({ length: 200 }, (_, i) => `tag${i}`);
    return Array.from({ length: n }, () => {
        const picked = new Set<string>();
        while (picked.size < tagsPer) picked.add(POOL[Math.floor(rand() * POOL.length)]!);
        return { tags: [...picked].map((t) => `#${t}`).join(' ') };
    });
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const outIdx = process.argv.indexOf('--out');
    const outPath = outIdx !== -1 ? process.argv[outIdx + 1] : undefined;

    const rows: Array<Record<string, string | number | boolean>> = [];

    const report = (crate: string, corpus: string, arms: ArmResult[]): void => {
        console.log(`\n=== ${crate} (${corpus}) ===`);
        for (const a of arms) {
            const line =
                `${a.arm.padEnd(4)} heapFootprint/call=${mb(a.heapFootprintPerCall).padStart(9)} ` +
                `heapRetained=${mb(a.heapRetained).padStart(9)} ` +
                `rssDelta=${mb(a.rssDelta).padStart(9)} ` +
                `arrayBuffersDelta=${mb(a.arrayBuffersDelta).padStart(9)} parity=${a.parity ? 'OK' : 'MISMATCH'}`;
            console.log(line);
            rows.push({ crate, corpus, ...a, heapFootprintPerCallMB: +(a.heapFootprintPerCall / 1024 / 1024).toFixed(4), heapRetainedMB: +(a.heapRetained / 1024 / 1024).toFixed(4), rssDeltaMB: +(a.rssDelta / 1024 / 1024).toFixed(4), arrayBuffersDeltaMB: +(a.arrayBuffersDelta / 1024 / 1024).toFixed(4) });
        }
        if (arms.some((a) => !a.parity)) process.exitCode = 1;
    };

    // --- 1. pii-sanitizer (18,600 chars of PII-rich text) -------------------
    {
        const piiText = piiCorpus();
        await initPiiModule({ module_or_path: await readBinary('../src/wasm/pii-sanitizer/pii_sanitizer_bg.wasm') });
        const wasm = (): { text: string; maskedItems: { length: number } } =>
            sanitizePiiWasm(piiText) as { text: string; maskedItems: { length: number } };
        // Full parity is enforced by the dedicated 218-case suite through the
        // hybrid; this probe compares the essentials only (async TS API).
        const tsOut = await sanitizeRegex(piiText);
        const wasmOut = wasm();
        const parity =
            tsOut.text === wasmOut.text && tsOut.maskedItems.length === wasmOut.maskedItems.length;
        report(
            'pii-sanitizer',
            `~${piiText.length} chars`,
            [
                await measureArm('TS', () => sanitizeRegex(piiText), 30, parity),
                await measureArm('WASM', wasm, 30, parity),
            ]
        );
    }

    // --- 2. textrank (~11,160 chars / 160 sentences) ------------------------
    {
        const trText = textrankCorpus();
        await initTextrankModule({ module_or_path: await readBinary('../src/wasm/textrank/textrank_bg.wasm') });
        const sentences = splitSentences(trText);
        const tsRun = (): string[] => extractSentences(trText, { topK: 10 });
        const wasmRun = (): string[] => {
            const result = extractTopIndices(trText, 10, 20, 0.3) as { indices: Uint32Array; sentenceCount: number };
            if (result.sentenceCount !== sentences.length) throw new Error('wasm split mismatch');
            return Array.from(result.indices).map((i) => sentences[i]!);
        };
        const parity = JSON.stringify(tsRun()) === JSON.stringify(wasmRun());
        report(
            'textrank',
            `~${trText.length} chars / ${sentences.length} sentences`,
            [
                await measureArm('TS', tsRun, 10, parity),
                await measureArm('WASM', wasmRun, 10, parity),
            ]
        );
    }

    // --- 3. sentence-dedup (~75KB / ~750 parts, heavy duplicates) -----------
    {
        const ddText = dedupCorpus();
        await initDedupModule({ module_or_path: await readBinary('../src/wasm/sentence-dedup/sentence_dedup_bg.wasm') });
        const parts = splitSentencesKeepDelimiters(ddText);
        const tsRun = (): string => deduplicateContent(ddText);
        const wasmRun = (): string => {
            const result = deduplicateIndices(ddText, 0.7, 10) as { indices: Uint32Array; sentenceCount: number };
            if (result.sentenceCount !== parts.length) throw new Error('wasm split mismatch');
            if (parts.length <= 1) return ddText;
            return Array.from(result.indices).map((i) => parts[i]!.sentence + parts[i]!.delimiter).join('');
        };
        const parity = tsRun() === wasmRun();
        report(
            'sentence-dedup (STAGED)',
            `~${ddText.length} chars / ${parts.length} parts`,
            [
                await measureArm('TS', tsRun, 30, parity),
                await measureArm('WASM', wasmRun, 30, parity),
            ]
        );
    }

    // --- 4. tag-cooccur (10,000 entries × 20 tags) --------------------------
    {
        const entries = tagCorpus();
        await initCooccurModule({ module_or_path: await readBinary('../src/wasm/tag-cooccur/tag_cooccur_bg.wasm') });
        const tsRun = (): { nodes: unknown[]; edges: unknown[] } => computeTagCooccurrence(entries);
        const wasmRun = (): { nodes: unknown[]; edges: unknown[] } =>
            decodeCooccurResult(computeCooccurrence(joinRawTags(entries), entries.length));
        const parity = JSON.stringify(tsRun()) === JSON.stringify(wasmRun());
        report(
            'tag-cooccur',
            `${entries.length} entries × 20 tags`,
            [
                await measureArm('TS', tsRun, 3, parity),
                await measureArm('WASM', wasmRun, 3, parity),
            ]
        );
    }

    if (outPath) {
        writeFileSync(
            outPath,
            JSON.stringify({ node: process.version, date: new Date().toISOString(), rows }, null, 2)
        );
        console.log(`\nwrote ${outPath}`);
    }
}

void main();
