/**
 * markdownSanitizerHybrid.wasm-success.test.ts
 * WASMが正常に初期化・動作する経路を検証する。Node の file 読み込みで
 * WASM初期化を成功させ（wasm wrapper を vi.mock）、TS実装との完全一致を
 * 確認する。
 *
 * markdownSanitizerHybrid.test.ts はWASM初期化失敗時のフォールバック経路を
 * 検証する（二分パターン）。
 *
 * 重要: WASM経路の検証は MIN_WASM_CHARS / MIN_WASM_TOTAL_CHARS を上回る
 * 大入力ケースを必ず含める — 閾値未満はハイブリッドのサイズルーティングで
 * TS経由になり、検証が無意味化する (lessons-learned)。 bench が全サイズで
 * WASM敗北を示したため閾値は production 帯の上にあり、このスイートだけが
 * 本番コード経由で WASM コアを叩く。各テストは入力が閾値を上回っていること
 * 自体を assert し、将来の閾値変更で検証が空洞化したら赤になるようにする。
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, test, expect, vi, beforeAll } from 'vitest';
import initWasmModule from '../../wasm/md-sanitize/mdSanitizeWasm.js';

vi.mock('../../wasm/md-sanitize/index.js', async () => {
    const wasmPath = fileURLToPath(
        new URL('../../wasm/md-sanitize/md_sanitize_bg.wasm', import.meta.url)
    );
    let initPromise: Promise<void> | null = null;

    async function initMdSanitizeWasm(): Promise<void> {
        if (!initPromise) {
            initPromise = readFile(wasmPath).then(async (bytes) => {
                await initWasmModule({ module_or_path: bytes });
            });
        }
        return initPromise;
    }

    const actual = await vi.importActual('../../wasm/md-sanitize/index.js') as typeof import(
        '../../wasm/md-sanitize/index.js'
    );

    return {
        ...actual,
        initMdSanitizeWasm,
    };
});

function makeBody(i: number, bytes: number): string {
    const base = `Entry ${i} body [link${i}](https://example.com/p/${i}?a=1&b=2) [[wiki${i}]] <b>html</b> & entities.\nSecond line.\n`;
    return base.repeat(Math.ceil(bytes / base.length)).slice(0, bytes);
}

describe('sanitizeForObsidianHybrid (WASM available)', () => {
    beforeAll(async () => {
        const { initMdSanitizeWasm } = await import('../../wasm/md-sanitize/index.js');
        await initMdSanitizeWasm();
    });

    test('small input still matches TS (TS size-routing)', async () => {
        const { sanitizeForObsidian } = await import('../markdownSanitizer.js');
        const { sanitizeForObsidianHybrid } = await import('../markdownSanitizerHybrid.js');
        const input = '[a](https://x) [[w]] & <b>';
        await expect(sanitizeForObsidianHybrid(input)).resolves.toBe(sanitizeForObsidian(input));
    });

    test('over-threshold single input exercises the real WASM path and matches TS', async () => {
        const { sanitizeForObsidian } = await import('../markdownSanitizer.js');
        const { sanitizeForObsidianHybrid, MIN_WASM_CHARS } = await import('../markdownSanitizerHybrid.js');
        const input = makeBody(0, 1_300_000);
        // Pin the routing: if a future threshold change drops this input
        // back to the TS path, this test must fail loudly, not go hollow.
        expect(input.length).toBeGreaterThan(MIN_WASM_CHARS);
        await expect(sanitizeForObsidianHybrid(input)).resolves.toBe(sanitizeForObsidian(input));
    });
});

describe('sanitizeBatchHybrid / sanitizeBatchAndJoinHybrid (WASM available)', () => {
    test('over-threshold batch exercises the real WASM path and matches TS', async () => {
        const { sanitizeForObsidian } = await import('../markdownSanitizer.js');
        const { sanitizeBatchHybrid, MIN_WASM_TOTAL_CHARS } = await import('../markdownSanitizerHybrid.js');
        const inputs = Array.from({ length: 5 }, (_, i) => makeBody(i, 500_000));
        const total = inputs.reduce((n, s) => n + s.length, 0);
        expect(total).toBeGreaterThan(MIN_WASM_TOTAL_CHARS);
        await expect(sanitizeBatchHybrid(inputs)).resolves.toEqual(inputs.map(sanitizeForObsidian));
    });

    test('over-threshold batch+join matches TS map+join', async () => {
        const { sanitizeForObsidian } = await import('../markdownSanitizer.js');
        const { sanitizeBatchAndJoinHybrid, MIN_WASM_TOTAL_CHARS } = await import(
            '../markdownSanitizerHybrid.js'
        );
        const inputs = Array.from({ length: 5 }, (_, i) => makeBody(i, 500_000));
        const total = inputs.reduce((n, s) => n + s.length, 0);
        expect(total).toBeGreaterThan(MIN_WASM_TOTAL_CHARS);
        await expect(sanitizeBatchAndJoinHybrid(inputs, '\n---\n')).resolves.toBe(
            inputs.map(sanitizeForObsidian).join('\n---\n')
        );
    });
});
