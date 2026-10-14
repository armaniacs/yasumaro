/**
 * STEP 0 breakdown probe: which per-row component dominates the ~34us/row
 * export render cost measured in bench/export-render-probe.ts?
 *
 * Components: toLocaleTimeString (ICU per row), getHostname (WHATWG URL
 * parse per row), sanitizeForObsidian x3 + sanitizeForMarkdownLinkText
 * (regex chains), template {{key}} replace.
 *
 * Run with: NPM_CONFIG_CACHE=/tmp/npm-cache-501 npx --yes tsx bench/export-render-breakdown-probe.ts
 */

import { writeFileSync } from 'node:fs';
import {
    sanitizeForObsidian,
    sanitizeForMarkdownLinkText,
    sanitizeUrlForMarkdownTarget,
} from '../src/utils/markdownSanitizer.js';
import { getHostname } from '../src/utils/markdownTemplateUtils.js';

const TITLE =
    'Understanding Rust async runtimes: tokio vs async-std performance characteristics part 123 [brackets] (parens) "quotes"';
const URL = 'https://example.com/articles/rust-async-runtimes-compared-in-depth-guide-123?q=hello world&lang=ja#frag-ment';
const SUMMARY =
    'The recording pipeline compresses page content before every AI summary request. ' +
    'TextRank builds a sentence similarity graph and ranks each sentence by importance. ' +
    '日本語の要約文では単語境界が曖昧なため文字バイグラムで類似度を計算します。 [[wiki-link]] extra.';
const TAGS = '#rust #async #performance #Web開発 #ブラウザ拡張';
const ENTRY_TEMPLATE = '- {{timestamp}} [{{title}}]({{url}})\n    - {{tags}}{{summary}}';

function stats(s: number[]): { min: number; p50: number; max: number } {
    const a = [...s].sort((x, y) => x - y);
    return { min: a[0]!, p50: a[Math.floor(a.length / 2)]!, max: a[a.length - 1]! };
}

async function main(): Promise<void> {
    const N = 10000;
    const iters = 7;
    const stamps = Array.from({ length: N }, (_, i) => Date.now() - i * 3600_000);
    const out: Record<string, unknown> = { meta: { rows: N, iters }, components: {} as Record<string, unknown> };

    const bench = (name: string, fn: () => void): void => {
        const samples: number[] = [];
        for (let k = 0; k < iters; k++) {
            const t0 = performance.now();
            fn();
            samples.push(performance.now() - t0);
        }
        const s = stats(samples);
        (out.components as Record<string, unknown>)[name] = { ...s, perRowNs: Math.round((s.p50 / N) * 1e6) };
        console.log(`${name}: p50=${s.p50.toFixed(1)}ms (${Math.round((s.p50 / N) * 1e6)}ns/row)`);
    };

    bench('toLocaleTimeString-ja-JP', () => {
        for (const t of stamps) {
            void new Date(t).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        }
    });
    bench('getHostname-new-URL', () => {
        for (let i = 0; i < N; i++) void getHostname(URL);
    });
    bench('sanitizeForObsidian-title+summary+url', () => {
        for (let i = 0; i < N; i++) {
            void sanitizeForObsidian(TITLE);
            void sanitizeForObsidian(SUMMARY);
            void sanitizeUrlForMarkdownTarget(URL);
        }
    });
    bench('sanitizeForMarkdownLinkText', () => {
        for (let i = 0; i < N; i++) void sanitizeForMarkdownLinkText(TITLE);
    });
    bench('template-replace-callback', () => {
        for (let i = 0; i < N; i++) {
            void ENTRY_TEMPLATE.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
                switch (key) {
                    case 'timestamp': return '12:34';
                    case 'title': return TITLE;
                    case 'url': return URL;
                    case 'tags': return TAGS;
                    case 'summary': return SUMMARY;
                    default: return '';
                }
            });
        }
    });

    writeFileSync('bench/export-render-breakdown-probe-result.json', JSON.stringify(out, null, 2) + '\n');
    console.log('wrote bench/export-render-breakdown-probe-result.json');
}

await main();
