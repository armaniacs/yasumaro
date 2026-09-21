/**
 * PBI-23 transfer-optimization probe: compares batch transfer contracts for
 * the md-sanitize WASM core, isolated from production wiring.
 *
 * Run with: npx tsx bench/pbi23-transfer-probe.ts [--out <json>]
 *
 * Arms (batch only — the single-string path already IS direct ptr+len via
 * passStringToWasm0/getStringFromWasm0, i.e. candidate (a) by construction,
 * so it has no transfer headroom left; see the final report):
 *
 * - TS baseline: entries.map(sanitizeForObsidian) / map+join (production
 *   dark-launch path — the time to beat).
 * - W0 baseline: sanitizeBatch / sanitizeBatchAndJoin via serde_wasm_bindgen
 *   string arrays (current production WASM path, newline-safe).
 * - A framed-bytes: entries → ONE bulk Uint8Array ([u32LE len][UTF-8]...
 *   frames, length-delimited so embedded `\n` is payload, never framing) →
 *   sanitizeBatchFramed → decode frames. 2 bulk wasm mallocs, no externref.
 * - A2 framed-bytes+join: framed in, single String out (export aggregation).
 * - B serde-bytes: entries pre-encoded to Uint8Array[] via serde
 *   Vec<Vec<u8>> (keeps serde reflection, drops glue string transcoding).
 * - C shared-staging: same as A but the input staging buffer is
 *   preallocated ONCE per size and reused via encodeInto (emulates a shared-
 *   memory input ring; wasm-side malloc per call necessarily remains since
 *   wasm-bindgen owns allocation).
 * - floor-codec: TextEncoder.encode × N + TextDecoder.decode × N with NO
 *   wasm call — the inherent transcoding floor any byte-transfer must pay
 *   on top of the core scan.
 *
 * Parity: every arm is checked against the TS reference on an attack
 * corpus (javascript: links, wikilinks, raw HTML, double-encoded entities,
 * non-BMP/astral chars, embedded newlines, empty strings, hostile
 * separators) before timing. Any mismatch exits non-zero.
 */

import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sanitizeForObsidian } from '../src/utils/markdownSanitizer.js';
import initWasmModule, {
    sanitizeBatch as sanitizeBatchWasm,
    sanitizeBatchFramed as sanitizeBatchFramedWasm,
    sanitizeBatchFramedAndJoin as sanitizeBatchFramedAndJoinWasm,
    sanitizeBatchBytes as sanitizeBatchBytesWasm,
} from '../src/wasm/md-sanitize/mdSanitizeWasm.js';

async function initForNode(): Promise<void> {
    const wasmPath = fileURLToPath(
        new URL('../src/wasm/md-sanitize/md_sanitize_bg.wasm', import.meta.url)
    );
    const bytes = await readFile(wasmPath);
    await initWasmModule({ module_or_path: bytes });
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

function makeSummary(i: number, bytes: number): string {
    const base = `Entry ${i} summary with [link${i}](https://example.com/p/${i}?a=1&b=2) and [[wiki${i}]] plus <b>html</b> & entities.\nSecond line of body text.\n`;
    return base.repeat(Math.ceil(bytes / base.length)).slice(0, bytes);
}

/** Length-delimited framing: [u32LE byte-len][UTF-8 bytes]... Newline-safe by construction. */
function encodeFramed(entries: string[]): Uint8Array {
    const parts = entries.map((s) => enc.encode(s));
    let total = 0;
    for (const p of parts) total += 4 + p.length;
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    let pos = 0;
    for (const p of parts) {
        dv.setUint32(pos, p.length, true);
        pos += 4;
        out.set(p, pos);
        pos += p.length;
    }
    return out;
}

function decodeFramed(buf: Uint8Array): string[] {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const out: string[] = [];
    let pos = 0;
    while (pos < buf.length) {
        const len = dv.getUint32(pos, true);
        pos += 4;
        out.push(dec.decode(buf.subarray(pos, pos + len)));
        pos += len;
    }
    return out;
}

/** Arm C helper: preallocated staging reused across calls (shared-memory emulation). */
function makeStaging(maxBytes: number): { buf: Uint8Array; encode: (entries: string[]) => Uint8Array } {
    const buf = new Uint8Array(maxBytes);
    const dv = new DataView(buf.buffer);
    const encode = (entries: string[]): Uint8Array => {
        let pos = 0;
        for (const s of entries) {
            const target = buf.subarray(pos + 4);
            const { written } = enc.encodeInto(s, target);
            dv.setUint32(pos, written!, true);
            pos += 4 + written!;
        }
        return buf.subarray(0, pos);
    };
    return { buf, encode };
}

const ATTACK_CORPUS: string[] = [
    '',
    '[t](javascript:alert(1))',
    '[A](HTTPS://example.com)',
    '[[page]]',
    '![[embed]]',
    '[[[a](https://x)]]',
    '<script>alert(1)</script> & <b>bold</b>',
    '&lt;',
    '&amp;',
    '&lt;script&gt;',
    '[a](https://x/?a=1&b=2)',
    'line1 [a](https://x)\nline2 [[w]]\nline3 <b>&</b>',
    'a\nb\nc',
    '\n\n',
    'あいう [a](https://x) 🎉',
    'Ｈｅｌｌｏ',
    '🎉🎉🎉 [[w🎉]]',
    'separator-bait: \n---\n & ]( ) [',
];

const SEPARATORS = ['\n---\n', '', '\n', ']()&<>'];

function checkParity(): void {
    const expected = ATTACK_CORPUS.map(sanitizeForObsidian);
    const framed = decodeFramed(
        sanitizeBatchFramedWasm(encodeFramed(ATTACK_CORPUS)) as unknown as Uint8Array
    );
    const byteBlobs = ATTACK_CORPUS.map((s) => enc.encode(s));
    const serdeBytes = (sanitizeBatchBytesWasm(byteBlobs) as unknown as Uint8Array[]).map(
        (b) => dec.decode(Uint8Array.from(b as unknown as number[]))
    );
    let ok = true;
    const eq = (label: string, got: string[]): void => {
        const match = JSON.stringify(got) === JSON.stringify(expected);
        console.log(`parity ${label}: ${match ? 'OK' : 'MISMATCH'}`);
        if (!match) {
            ok = false;
            for (let i = 0; i < got.length; i++) {
                if (got[i] !== expected[i]) {
                    console.log(`  [${i}] input=${JSON.stringify(ATTACK_CORPUS[i])}`);
                    console.log(`    ts   =${JSON.stringify(expected[i])}`);
                    console.log(`    wasm =${JSON.stringify(got[i])}`);
                }
            }
        }
    };
    eq('A framed-bytes         ', framed);
    eq('B serde-bytes          ', serdeBytes);
    for (const sep of SEPARATORS) {
        const tsJoined = ATTACK_CORPUS.map(sanitizeForObsidian).join(sep);
        const framedJoin = sanitizeBatchFramedAndJoinWasm(
            encodeFramed(ATTACK_CORPUS),
            sep
        ) as unknown as string;
        const match = framedJoin === tsJoined;
        console.log(`parity A2 framed+join sep=${JSON.stringify(sep)}: ${match ? 'OK' : 'MISMATCH'}`);
        if (!match) {
            ok = false;
            console.log(`  ts   =${JSON.stringify(tsJoined.slice(0, 200))}`);
            console.log(`  wasm =${JSON.stringify(framedJoin.slice(0, 200))}`);
        }
    }
    // Randomized differential on framed path (multibyte/newline-heavy alphabet).
    let seed = 12345;
    const rand = (): number => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        return seed / 4294967296;
    };
    const alphabet = ['[', ']', '(', ')', '!', '&', '<', '>', '\n', ' ', 'a', 'あ', '🎉', ':', '/', ';', '\\'];
    const randomInputs = Array.from({ length: 200 }, () => {
        const len = Math.floor(rand() * 121);
        return Array.from({ length: len }, () => alphabet[Math.floor(rand() * alphabet.length)]!).join('');
    });
    const randExpected = randomInputs.map(sanitizeForObsidian);
    const randFramed = decodeFramed(
        sanitizeBatchFramedWasm(encodeFramed(randomInputs)) as unknown as Uint8Array
    );
    const randMatch = JSON.stringify(randFramed) === JSON.stringify(randExpected);
    console.log(`parity A framed randomized differential (200 inputs): ${randMatch ? 'OK' : 'MISMATCH'}`);
    if (!randMatch) ok = false;
    if (!ok) {
        console.log('PARITY FAILURE — aborting benchmark');
        process.exitCode = 1;
        throw new Error('parity failure');
    }
}

function timeIt(label: string, fn: () => unknown, iterations: number): number {
    for (let i = 0; i < 3; i++) fn(); // warm up
    if (typeof globalThis.gc === 'function') globalThis.gc();
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    const perOp = (performance.now() - start) / iterations;
    console.log(`${label}: ${perOp.toFixed(3)} ms/op (${iterations} ops)`);
    return perOp;
}

async function main(): Promise<void> {
    await initForNode();
    console.log('=== parity (attack corpus + randomized differential) ===');
    checkParity();

    const rows: Array<Record<string, number | string | boolean>> = [];
    for (const [n, bytes, iters, label] of [
        [100, 512, 30, 'batch 100x0.5KB'],
        [2000, 512, 10, 'batch 2000x0.5KB (PBI)'],
        [10000, 200, 3, 'batch 10000x0.2KB'],
    ] as Array<[number, number, number, string]>) {
        console.log(`\n=== ${label} ===`);
        const entries = Array.from({ length: n }, (_, i) => makeSummary(i, bytes));
        const tsExpected = entries.map(sanitizeForObsidian);
        const tsJoined = tsExpected.join('\n---\n');

        const ts = timeIt('TS   map            ', () => entries.map(sanitizeForObsidian), iters);
        const w0 = timeIt('W0   serde strings  ', () => sanitizeBatchWasm(entries), iters);
        const a = timeIt('A    framed bytes   ', () => decodeFramed(
            sanitizeBatchFramedWasm(encodeFramed(entries)) as unknown as Uint8Array
        ), iters);
        const a2 = timeIt('A2   framed+join    ', () => sanitizeBatchFramedAndJoinWasm(
            encodeFramed(entries), '\n---\n'
        ), iters);
        const blobs = entries.map((s) => enc.encode(s));
        const b = timeIt('B    serde bytes    ', () => (sanitizeBatchBytesWasm(blobs) as unknown as Uint8Array[]).map(
            (x) => dec.decode(Uint8Array.from(x as unknown as number[]))
        ), iters);
        const staging = makeStaging(encodeFramed(entries).length + 16);
        const c = timeIt('C    shared staging ', () => decodeFramed(
            sanitizeBatchFramedWasm(staging.encode(entries)) as unknown as Uint8Array
        ), iters);
        const floor = timeIt('floor codec only  ', () => entries.map((s) => dec.decode(enc.encode(s))), iters);

        // Correctness of each timed arm (checked once, outside the timer).
        const armParity =
            JSON.stringify(decodeFramed(sanitizeBatchFramedWasm(encodeFramed(entries)) as unknown as Uint8Array)) === JSON.stringify(tsExpected) &&
            (sanitizeBatchFramedAndJoinWasm(encodeFramed(entries), '\n---\n') as unknown as string) === tsJoined &&
            JSON.stringify((sanitizeBatchBytesWasm(blobs) as unknown as Uint8Array[]).map((x) => dec.decode(Uint8Array.from(x as unknown as number[])))) === JSON.stringify(tsExpected);
        console.log(`arm parity: ${armParity ? 'OK' : 'MISMATCH'}`);
        if (!armParity) process.exitCode = 1;

        const row = { kind: label, n, bytes, iters, tsMs: ts, w0Ms: w0, aMs: a, a2Ms: a2, bMs: b, cMs: c, floorMs: floor,
            speedupW0: ts / w0, speedupA: ts / a, speedupA2: ts / a2, speedupB: ts / b, speedupC: ts / c,
            parity: armParity };
        rows.push(row);
        console.log(
            `speedups vs TS: W0=${(ts / w0).toFixed(2)}x A=${(ts / a).toFixed(2)}x A2=${(ts / a2).toFixed(2)}x B=${(ts / b).toFixed(2)}x C=${(ts / c).toFixed(2)}x`
        );
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
