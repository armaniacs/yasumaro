/**
 * Parity check: for every corpus input below, the WASM Markdown
 * sanitization core mapped back through src/wasm/md-sanitize/index.ts must
 * reconstruct EXACTLY what the TS reference (src/utils/markdownSanitizer.ts,
 * `sanitizeForObsidian`) returns. This is the regression gate for the WASM
 * port: any wasm/md-sanitize change that breaks parity here must not ship
 * (same gate contract as the pii-sanitizer / sentence-dedup / tag-cooccur
 * parity suites).
 *
 * The corpus covers the TS quirks fixed by the STEP 1 probe
 * (bench/md-sanitize-probe.ts + bench/md-sanitize-probe-result.json):
 * scheme-independent link escaping, the `[^)]+`-stops-at-first-`)`
 * behavior, leftmost-match bracket consumption, `&`-first entity order
 * (incl. intentional double-encoding), repeat-call stability, and the
 * empty/non-string guards. Unlike the tag-cooccur corpus, entries
 * containing `\n` are DELIBERATELY in the exact-parity list: the batch
 * entry points exchange a JS string array via serde_wasm_bindgen (see
 * wasm/md-sanitize/src/lib.rs), so embedded newlines round-trip instead
 * of tripping a split-agreement gate (pinned by the newline test below).
 *
 * Known divergence (documented, out of scope): lone surrogates cannot
 * survive the `&str` boundary and become U+FFFD in WASM while TS keeps
 * them verbatim — same caveat as the other crates. No lone-surrogate
 * input appears in the exact-parity list.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, test, expect, beforeAll } from 'vitest';
import { sanitizeForObsidian } from '../../../utils/markdownSanitizer.js';
import {
    sanitizeForObsidianWithWasm,
    sanitizeBatchWithWasm,
    sanitizeBatchAndJoinWithWasm,
} from '../index.js';

const CORPUS: string[] = [
    '',
    'hello world',
    '[just brackets]',
    '[](https://x.com)',
    '[evil](https://malicious.com)',
    '[A](HTTPS://example.com)',
    // `[^)]+` stops at the FIRST `)`: trailing paren survives verbatim.
    '[t](javascript:alert(1))',
    '[a](b)c(d)',
    '![alt](https://x/y.png)',
    '[[page]]',
    '![[embed]]',
    '[[]]',
    '!![a](b)',
    '!![[a]]',
    // Leftmost match consumes the outer brackets first.
    '[[[a](https://x)]]',
    '[a[b](https://x)',
    // Entity order: `&` first (intentional double-encoding, not idempotent).
    '&<>',
    '&lt;',
    '&amp;',
    '[a](https://x/?a=1&b=2)',
    // Newlines are preserved AND sanitized per line — the batch contract
    // exists precisely so these never touch a `\n`-split gate.
    'line1 [a](https://x)\nline2 [[w]]\nline3 <b>&</b>',
    'a\nb',
    '\n\n',
    '---\ntitle: [t](https://x)\n---\n\n[[w]] & summary\n',
    // Multibyte / astral-plane characters pass through identically.
    'あいう [a](https://x) 🎉',
    'Ｈｅｌｌｏ',
    '#tag with [link](https://x) and [[wiki]] & <html>',
    'a!b !! c[d](e) f[[g]]h',
];

async function initForNode(): Promise<void> {
    const wasmPath = fileURLToPath(new URL('../md_sanitize_bg.wasm', import.meta.url));
    const bytes = await readFile(wasmPath);
    const initWasmModule = (await import('../mdSanitizeWasm.js')).default;
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

const ALPHABET = ['[', ']', '(', ')', '!', '&', '<', '>', '\n', ' ', 'a', 'Z', 'あ', '🎉', ':', '/', '.', '#', ';', '\\'];

function randomStrings(n: number, maxLen: number, seed: number): string[] {
    const rand = mulberry32(seed);
    return Array.from({ length: n }, () => {
        const len = Math.floor(rand() * (maxLen + 1));
        return Array.from({ length: len }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]!).join('');
    });
}

describe('WASM vs TS markdown-sanitize parity', () => {
    beforeAll(async () => {
        await initForNode();
    });

    test.each(CORPUS.map((input) => [input]))(
        'single corpus %# matches TS output exactly',
        async (input) => {
            expect(await sanitizeForObsidianWithWasm(input!)).toBe(sanitizeForObsidian(input!));
        }
    );

    test('batch matches TS element-wise (order + length preserved)', async () => {
        expect(await sanitizeBatchWithWasm(CORPUS)).toEqual(CORPUS.map(sanitizeForObsidian));
    });

    test('batch-and-join matches TS map+join', async () => {
        for (const sep of ['\n---\n', '', '\n']) {
            expect(await sanitizeBatchAndJoinWithWasm(CORPUS, sep)).toBe(
                CORPUS.map(sanitizeForObsidian).join(sep)
            );
        }
    });

    test('entries with embedded newlines round-trip (no split gate)', async () => {
        // The tag-cooccur `\n`-join transfer would reject these at its
        // split-agreement gate; the serde array contract must NOT.
        const bodies = ['summary one\nwith newline', 'a\nb\nc', '[[w]]\n[t](https://x?a=1&b=2)'];
        expect(await sanitizeBatchWithWasm(bodies)).toEqual(bodies.map(sanitizeForObsidian));
        expect(await sanitizeBatchAndJoinWithWasm(bodies, '\n---\n')).toBe(
            bodies.map(sanitizeForObsidian).join('\n---\n')
        );
    });

    test('empty batch round-trips', async () => {
        expect(await sanitizeBatchWithWasm([])).toEqual([]);
        expect(await sanitizeBatchAndJoinWithWasm([], '\n---\n')).toBe('');
    });

    test('non-string inputs stay guarded on the wrapper (TS typeof parity)', async () => {
        // The TS reference returns non-strings as-is; the wrapper must not
        // throw them into WASM.
        expect(await sanitizeForObsidianWithWasm(null as unknown as string)).toBe(null);
        expect(await sanitizeForObsidianWithWasm(undefined as unknown as string)).toBe(undefined);
    });

    test('randomized differential: single + batch match TS on 3 seeds', async () => {
        for (const seed of [1, 7, 42]) {
            const inputs = randomStrings(200, 120, seed);
            for (const input of inputs) {
                expect(await sanitizeForObsidianWithWasm(input)).toBe(sanitizeForObsidian(input));
            }
            expect(await sanitizeBatchWithWasm(inputs)).toEqual(inputs.map(sanitizeForObsidian));
        }
    });
});
