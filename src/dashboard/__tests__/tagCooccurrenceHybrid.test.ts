/**
 * tagCooccurrenceHybrid.test.ts
 * WASM初期化失敗時のフォールバック経路を検証する。Node には
 * chrome.runtime.getURL が無いため initTagCooccurWasm() が失敗し、
 * ハイブリッドは TS 実装にフォールバックする — 全ケースで TS 参照と
 * 完全一致すること (tagCooccurrenceHybrid.wasm-success.test.ts と同じ
 * 二分パターン)。
 */

import { describe, test, expect } from 'vitest';
import {
    computeTagCooccurrence,
    narrowEntriesToTopTags,
} from '../tagCooccurrence.js';
import {
    computeTagCooccurrenceHybrid,
    narrowEntriesToTopTagsHybrid,
} from '../tagCooccurrenceHybrid.js';

describe('computeTagCooccurrenceHybrid (WASM unavailable → TS fallback)', () => {
    test('empty entries return empty nodes/edges', async () => {
        await expect(computeTagCooccurrenceHybrid([])).resolves.toEqual({ nodes: [], edges: [] });
    });

    test.each([
        [[{ tags: '#tech #ai' }]],
        [[{ tags: '#a|b #c' }]],
        [[{ tags: '# , tech, ai' }]],
        [[{ tags: '#b #a' }, { tags: '#c #a' }]],
        [[{ tags: '#a\n#b' }]],
        [[{ tags: null }, { tags: '' }, {}]],
    ])('small input %#: matches TS exactly', async (entries) => {
        await expect(computeTagCooccurrenceHybrid(entries)).resolves.toEqual(
            computeTagCooccurrence(entries)
        );
    });

    test('large input via fallback still matches TS', async () => {
        const entries = Array.from({ length: 300 }, (_, i) => ({
            tags: `#tag${i % 40} #tag${(i * 7) % 40}`,
        }));
        await expect(computeTagCooccurrenceHybrid(entries)).resolves.toEqual(
            computeTagCooccurrence(entries)
        );
    });
});

describe('narrowEntriesToTopTagsHybrid (WASM unavailable → TS fallback)', () => {
    test.each([
        { entries: [{ tags: '#a' }], limit: 50 },
        { entries: [{ tags: '#b' }, { tags: '#a' }, { tags: '#c' }], limit: 2 },
        { entries: [{ tags: 'b, a' }, { tags: 'a, c' }], limit: 2 },
        { entries: [{ tags: '#a\n#b' }], limit: 1 },
        { entries: [{ tags: '#a' }, { tags: '#b' }], limit: -1 },
        { entries: [{ tags: '#a' }, { tags: '#b' }], limit: 2.5 },
        // 2^32 would wrap to 0 at the u32 boundary — the wrapper rejects it
        // and the hybrid must fall back to TS (which keeps everything).
        { entries: [{ tags: '#a' }, { tags: '#b' }], limit: 2 ** 32 },
    ])('case %#: matches TS exactly', async ({ entries, limit }) => {
        await expect(narrowEntriesToTopTagsHybrid(entries, limit)).resolves.toEqual(
            narrowEntriesToTopTags(entries, limit)
        );
    });

    test('within-limit input returns the same reference', async () => {
        const entries = [{ tags: '#a' }];
        await expect(narrowEntriesToTopTagsHybrid(entries, 50)).resolves.toBe(entries);
    });
});
