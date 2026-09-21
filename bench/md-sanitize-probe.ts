/**
 * STEP 1 probe for PBI-18 (md-sanitize WASM migration).
 *
 * Fixes the TS reference behavior of sanitizeForObsidian() BEFORE writing
 * the Rust port (per rust-wasm-migration STEP 2 rule: probe first, never
 * write test expectations from prediction). Also re-measures the batch cost
 * quoted in the PBI (2000 entries ≈ 11ms) on this machine.
 *
 * Run with: npx tsx bench/md-sanitize-probe.ts [--out bench/md-sanitize-probe-result.json]
 */
import { writeFileSync } from 'node:fs';
import {
    sanitizeAllMarkdownLinks,
    sanitizeForObsidian,
    escapeObsidianWikilinks,
} from '../src/utils/markdownSanitizer.js';

interface QuirkCheck {
    name: string;
    input: string;
    expected: string | null; // null = record actual only (no prediction)
    actual: string;
    match: boolean | null;
}

const checks: QuirkCheck[] = [];
function check(name: string, input: string, expected: string | null = null): void {
    const actual = sanitizeForObsidian(input) as string;
    checks.push({ name, input, expected, actual, match: expected === null ? null : actual === expected });
}

// --- Order semantics: link -> wikilink -> entity (& first) ---
check('plain-text-passthrough', 'hello world', 'hello world');
check('md-link-https', '[evil](https://malicious.com)', '\\[evil\\]\\(https://malicious.com\\)');
check('md-link-uppercase-scheme', '[A](HTTPS://example.com)', '\\[A\\]\\(HTTPS://example.com\\)');
check('md-link-javascript-scheme', '[t](javascript:alert(1))', '\\[t\\]\\(javascript:alert(1)\\)');
check('md-link-image', '![alt](https://x/y.png)', '!\\[alt\\]\\(https://x/y.png\\)');
check('md-link-no-url-parens', '[just brackets]', '[just brackets]');
check('md-link-empty-text', '[](https://x.com)', '\\[\\]\\(https://x.com\\)');
check('wikilink', '[[page]]', '\\[\\[page\\]\\]');
check('wikilink-embed', '![[embed]]', '!\\[\\[embed\\]\\]');
check('entity-order', '&<>', '&amp;&lt;&gt;');
check('entity-double-encode', '&lt;', '&amp;lt;');
check('entity-amp-in-link-url', '[a](https://x/?a=1&b=2)', '\\[a\\]\\(https://x/?a=1&amp;b=2\\)');
check('link-inside-wikilink-order', '[[[a](https://x)]]', null);
check('multiline-preserved', 'line1 [a](https://x)\nline2 [[w]]\nline3 <b>&</b>', null);
check('stops-at-first-close-paren', '[a](b)c(d)', '\\[a\\](b)c(d)');
check('nested-bracket', '[a[b](https://x)', null);
check('empty-inner-wikilink', '[[]]', '\\[\\[\\]\\]');
check('lone-surrogate', 'a\uD800b', null);

// --- g-flag statefulness: same input twice must give same output ---
const repeatInput = '[a](https://x.com) [[w]] &';
const r1 = sanitizeForObsidian(repeatInput);
const r2 = sanitizeForObsidian(repeatInput);
const r3 = sanitizeAllMarkdownLinks(sanitizeAllMarkdownLinks(repeatInput));
checks.push({
    name: 'repeat-call-stable',
    input: repeatInput,
    expected: r1,
    actual: r2,
    match: r1 === r2,
});
checks.push({
    name: 'double-apply-not-idempotent',
    input: repeatInput,
    expected: null,
    actual: r3,
    match: null,
});

// --- non-string / empty guards (TS returns input as-is) ---
const guardCases: Array<{ name: string; input: unknown; actual: unknown }> = [
    { name: 'empty-string', input: '', actual: sanitizeForObsidian('') },
    { name: 'null', input: null, actual: sanitizeForObsidian(null as unknown as string) },
    { name: 'undefined', input: undefined, actual: sanitizeForObsidian(undefined as unknown as string) },
    { name: 'number', input: 123 as unknown as string, actual: sanitizeForObsidian(123 as unknown as string) },
];

// --- sub-function isolation: escapeObsidianWikilinks does NOT entity-encode ---
const wikilinkOnly = escapeObsidianWikilinks('[[a]] & <b>');

// --- perf: batch sizes around the PBI quote (2000 x 0.5KB) + single large ---
function makeSummary(i: number, bytes: number): string {
    const base = `Entry ${i} summary with [link${i}](https://example.com/p/${i}?a=1&b=2) and [[wiki${i}]] plus <b>html</b> & entities. `;
    return base.repeat(Math.ceil(bytes / base.length)).slice(0, bytes);
}

function timeIt(fn: () => void, iters: number): { min: number; p50: number; max: number } {
    for (let i = 0; i < 3; i++) fn(); // warmup
    const samples: number[] = [];
    for (let i = 0; i < iters; i++) {
        const t0 = performance.now();
        fn();
        samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    return {
        min: samples[0]!,
        p50: samples[Math.floor(samples.length / 2)]!,
        max: samples[samples.length - 1]!,
    };
}

const batch2000 = Array.from({ length: 2000 }, (_, i) => makeSummary(i, 512));
const batchPerf = timeIt(() => {
    for (const s of batch2000) sanitizeForObsidian(s);
}, 10);

const single128k = makeSummary(0, 128 * 1024);
const singlePerf = timeIt(() => {
    sanitizeForObsidian(single128k);
}, 20);

const result = {
    node: process.version,
    date: new Date().toISOString(),
    quirks: checks,
    quirkMismatches: checks.filter((c) => c.match === false),
    guards: guardCases,
    wikilinkOnlyNoEntityEncode: wikilinkOnly,
    perf: {
        batch2000x512B_ms: batchPerf,
        single128KB_ms: singlePerf,
    },
};

console.log(JSON.stringify(result, null, 2));

const outIdx = process.argv.indexOf('--out');
if (outIdx !== -1 && process.argv[outIdx + 1]) {
    writeFileSync(process.argv[outIdx + 1]!, JSON.stringify(result, null, 2));
    console.log(`\nwrote ${process.argv[outIdx + 1]}`);
}
