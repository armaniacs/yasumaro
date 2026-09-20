/**
 * tagCooccurrenceHybrid.wasm-success.test.ts
 * WASMが正常に初期化・動作する経路を検証する。Node の file 読み込みで
 * WASM初期化を成功させ（wasm wrapper を vi.mock）、TS実装との完全一致を
 * 確認する。
 *
 * tagCooccurrenceHybrid.test.ts はWASM初期化失敗時のフォールバック経路を
 * 検証する（contentDedupHybrid と同じ二分パターン）。
 *
 * 重要: WASM経路の検証は MIN_WASM_ENTRIES (32) 以上の大入力ケースを必ず
 * 含める — 小入力はハイブリッドのサイズルーティングでTS経由になり、
 * 検証が無意味化する (lessons-learned)。
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, test, expect, vi, beforeAll } from 'vitest';
import initWasmModule from '../../wasm/tag-cooccur/tagCooccurWasm.js';

vi.mock('../../wasm/tag-cooccur/index.js', async () => {
    const wasmPath = fileURLToPath(
        new URL('../../wasm/tag-cooccur/tag_cooccur_bg.wasm', import.meta.url)
    );
    let initPromise: Promise<void> | null = null;

    async function initTagCooccurWasm(): Promise<void> {
        if (!initPromise) {
            initPromise = readFile(wasmPath).then(async (bytes) => {
                await initWasmModule({ module_or_path: bytes });
            });
        }
        return initPromise;
    }

    const actual = await vi.importActual('../../wasm/tag-cooccur/index.js') as typeof import(
        '../../wasm/tag-cooccur/index.js'
    );

    return {
        ...actual,
        initTagCooccurWasm,
    };
});

describe('computeTagCooccurrenceHybrid (WASM available)', () => {
    beforeAll(async () => {
        const { initTagCooccurWasm } = await import('../../wasm/tag-cooccur/index.js');
        await initTagCooccurWasm();
    });

    test('large input exercises the real WASM path and matches TS', async () => {
        const { computeTagCooccurrence } = await import('../tagCooccurrence.js');
        const { computeTagCooccurrenceHybrid } = await import('../tagCooccurrenceHybrid.js');
        const entries = Array.from({ length: 500 }, (_, i) => ({
            tags: `#tag${i % 60} #tag${(i * 13) % 60} #tag${(i * 29) % 60}`,
        }));
        await expect(computeTagCooccurrenceHybrid(entries)).resolves.toEqual(
            computeTagCooccurrence(entries)
        );
    });

    test('pipe-tag quirk survives the WASM path bit-identically', async () => {
        const { computeTagCooccurrence } = await import('../tagCooccurrence.js');
        const { computeTagCooccurrenceHybrid } = await import('../tagCooccurrenceHybrid.js');
        const entries = Array.from({ length: 100 }, () => ({ tags: '#a|b #c' }));
        await expect(computeTagCooccurrenceHybrid(entries)).resolves.toEqual(
            computeTagCooccurrence(entries)
        );
    });

    test('embedded newline falls back to TS with identical output', async () => {
        const { computeTagCooccurrence } = await import('../tagCooccurrence.js');
        const { computeTagCooccurrenceHybrid } = await import('../tagCooccurrenceHybrid.js');
        // 32+ entries so the hybrid attempts WASM first; the gate rejects
        // and the fallback owns the result.
        const entries = Array.from({ length: 40 }, (_, i) =>
            i === 20 ? { tags: '#a\n#b' } : { tags: '#a #c' }
        );
        await expect(computeTagCooccurrenceHybrid(entries)).resolves.toEqual(
            computeTagCooccurrence(entries)
        );
    });
});

describe('narrowEntriesToTopTagsHybrid (WASM available)', () => {
    test('large input exercises the real WASM path and matches TS', async () => {
        const { narrowEntriesToTopTags } = await import('../tagCooccurrence.js');
        const { narrowEntriesToTopTagsHybrid } = await import('../tagCooccurrenceHybrid.js');
        const entries = Array.from({ length: 300 }, (_, i) => ({
            tags: `#tag${i % 80} #tag${(i * 3) % 80}`,
        }));
        await expect(narrowEntriesToTopTagsHybrid(entries, 50)).resolves.toEqual(
            narrowEntriesToTopTags(entries, 50)
        );
    });

    test('within-limit input returns the same reference via WASM unchanged flag', async () => {
        const { narrowEntriesToTopTagsHybrid } = await import('../tagCooccurrenceHybrid.js');
        const entries = Array.from({ length: 40 }, () => ({ tags: '#a #b' }));
        await expect(narrowEntriesToTopTagsHybrid(entries, 50)).resolves.toBe(entries);
    });
});
