/**
 * STEP 0 probe: is the local-Markdown export render path (per-row sanitize +
 * template render over up to DATE_RANGE_QUERY_LIMIT rows) compute-bound or
 * transfer-bound for a WASM port?
 *
 * Compares buildTemplateEntryData + renderFileTemplate wall-clock against the
 * transfer-only floor (TextEncoder encode of the row JSON + decode of the
 * rendered markdown — the unavoidable JS<->WASM boundary copy). If the floor
 * is a large share of the render time, a WASM port cannot win (same structural
 * finding that removed md-sanitize and prompt-sanitize).
 *
 * Run with: npx tsx bench/export-render-probe.ts
 */

import { writeFileSync } from 'node:fs';
import { buildTemplateEntryData } from '../src/utils/markdownFormatter.js';
import { renderFileTemplate, getActiveTemplate } from '../src/utils/markdownTemplateUtils.js';
import type { MarkdownExportTemplate } from '../src/utils/types.js';

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

const TITLE =
    'Understanding Rust async runtimes: tokio vs async-std performance characteristics ';
const URL_BASE = 'https://example.com/articles/rust-async-runtimes-compared-in-depth-guide-';
const SUMMARY =
    'The recording pipeline compresses page content before every AI summary request. ' +
    'TextRank builds a sentence similarity graph and ranks each sentence by importance. ' +
    '日本語の要約文では単語境界が曖昧なため文字バイグラムで類似度を計算します。';
const TAGS = '#rust #async #performance #Web開発 #ブラウザ拡張';

interface Row {
    title: string;
    url: string;
    summary: string;
    tags: string;
    created_at: number;
}

function buildRows(n: number): Row[] {
    const rand = mulberry32(20261015);
    const rows: Row[] = [];
    const base = Date.now() - n * 3600_000;
    for (let i = 0; i < n; i++) {
        const variant = Math.floor(rand() * 500);
        rows.push({
            title: `${TITLE} part ${variant} [brackets] (parens) "quotes"`,
            url: `${URL_BASE}${variant}?q=hello world&lang=ja#frag-ment`,
            summary: rand() < 0.9 ? `${SUMMARY} [[wiki-link]] additional context ${variant}.` : '',
            tags: rand() < 0.7 ? TAGS : '',
            created_at: base + i * 3600_000,
        });
    }
    return rows;
}

function stats(samples: number[]): { min: number; p50: number; max: number } {
    const s = [...samples].sort((a, b) => a - b);
    return { min: s[0]!, p50: s[Math.floor(s.length / 2)]!, max: s[s.length - 1]! };
}

async function main(): Promise<void> {
    const template: MarkdownExportTemplate = getActiveTemplate([], undefined);
    const sizes = [1000, 5000, 10000];
    const iters = 7;
    const enc = new TextEncoder();
    const dec = new TextDecoder();
    const out: Record<string, unknown> = {
        meta: {
            date: new Date().toISOString(),
            iters,
            note: 'renderDateFile-equivalent: rows -> buildTemplateEntryData map -> renderFileTemplate. Transfer floor = encode(row JSON) + decode(rendered md).',
        },
        cases: [] as unknown[],
    };

    for (const n of sizes) {
        const rows = buildRows(n);
        const renderSamples: number[] = [];
        const mapSamples: number[] = [];
        const floorSamples: number[] = [];
        let rendered = '';
        for (let k = 0; k < iters; k++) {
            const t0 = performance.now();
            const entries = rows.map((r) =>
                buildTemplateEntryData(
                    { title: r.title, url: r.url, summary: r.summary, tags: r.tags, createdAt: r.created_at },
                    { tagChain: 'obsidian' },
                ),
            );
            const t1 = performance.now();
            rendered = renderFileTemplate(template, entries, '2026-10-15');
            const t2 = performance.now();
            // Transfer floor: the bytes that must cross the JS<->WASM boundary.
            const f0 = performance.now();
            const bytes = enc.encode(JSON.stringify(rows));
            const back = dec.decode(enc.encode(rendered));
            const f1 = performance.now();
            if (back.length !== rendered.length) throw new Error('round-trip length mismatch');
            mapSamples.push(t1 - t0);
            renderSamples.push(t2 - t0);
            floorSamples.push(f1 - f0);
            void bytes;
        }
        const render = stats(renderSamples);
        const map = stats(mapSamples);
        const floor = stats(floorSamples);
        (out.cases as unknown[]).push({
            rows: n,
            renderedChars: rendered.length,
            mapMs: map,
            totalRenderMs: render,
            transferFloorMs: floor,
            floorShareP50: floor.p50 / render.p50,
        });
        console.log(
            `rows=${n} rendered=${(rendered.length / 1024).toFixed(0)}KB ` +
                `map p50=${map.p50.toFixed(1)}ms total p50=${render.p50.toFixed(1)}ms ` +
                `floor p50=${floor.p50.toFixed(1)}ms share=${(floor.p50 / render.p50).toFixed(2)}`,
        );
    }

    writeFileSync('bench/export-render-probe-result.json', JSON.stringify(out, null, 2) + '\n');
    console.log('wrote bench/export-render-probe-result.json');
}

await main();
