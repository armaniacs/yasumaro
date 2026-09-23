/**
 * tagCooccurrenceHybrid.test.ts
 * WASM初期化失敗時のフォールバック経路を検証する。Node には
 * chrome.runtime.getURL が無いため initTagCooccurWasm() が失敗し、
 * ハイブリッドは TS 実装にフォールバックする — 全ケースで TS 参照と
 * 完全一致すること (tagCooccurrenceHybrid.wasm-success.test.ts と同じ
 * 二分パターン)。
 */

import { describe, test, expect, vi, afterEach } from 'vitest';
import {
    computeTagCooccurrence,
    narrowEntriesToTopTags,
} from '../tagCooccurrence.js';
import {
    computeTagCooccurrenceHybrid,
    narrowEntriesToTopTagsHybrid,
} from '../tagCooccurrenceHybrid.js';
import { LogType } from '../../utils/logger/types.js';

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

describe('fallback golden pin + u32 boundary (PBI 2026-09-21-19)', () => {
    const COMPUTE_MSG = 'Tag-cooccur WASM call failed, falling back to TS for this input';
    const NARROW_MSG = 'Tag-cooccur narrow WASM call failed, falling back to TS for this input';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    afterEach(() => {
        warnSpy.mockClear();
        vi.doUnmock('../../wasm/tag-cooccur/index.js');
        vi.doUnmock('../../utils/logger/core.js');
    });

    /** Fresh hybrid with a controllable WASM layer (probe succeeds). */
    async function importFresh(mode: 'throw' | 'ok') {
        vi.resetModules();
        const mockAddLog = vi.fn();
        const mockInit = vi.fn().mockResolvedValue(undefined);
        const mockCompute = vi.fn();
        const mockNarrow = vi.fn();
        if (mode === 'throw') {
            mockCompute.mockRejectedValue(new Error('wasm boom'));
            mockNarrow.mockRejectedValue(new Error('wasm boom'));
        } else {
            const sentinel = { nodes: [], edges: [] };
            mockCompute.mockResolvedValue(sentinel);
            mockNarrow.mockImplementation((entries: unknown[]) => Promise.resolve(entries));
        }
        vi.doMock('../../wasm/tag-cooccur/index.js', () => ({
            initTagCooccurWasm: mockInit,
            computeCooccurrenceWithWasm: mockCompute,
            narrowEntriesToTopTagsWithWasm: mockNarrow,
        }));
        vi.doMock('../../utils/logger/core.js', async (importOriginal) => {
            const actual =
                await importOriginal<typeof import('../../utils/logger/core.js')>();
            return { ...actual, addLog: mockAddLog };
        });
        const hybrid = await import('../tagCooccurrenceHybrid.js');
        const ts = await import('../tagCooccurrence.js');
        return { hybrid, ts, mockAddLog, mockCompute, mockNarrow };
    }

    function largeEntries(): Array<{ tags: string }> {
        return Array.from({ length: 40 }, (_, i) => ({
            tags: `#tag${i % 12} #tag${(i * 5) % 12}`,
        }));
    }

    test('compute: WASM throw → runtime-standard warn+addLog once each, TS result', async () => {
        const { hybrid, ts, mockAddLog } = await importFresh('throw');
        const entries = largeEntries();
        await expect(hybrid.computeTagCooccurrenceHybrid(entries)).resolves.toEqual(
            ts.computeTagCooccurrence(entries)
        );
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(COMPUTE_MSG, 'wasm boom');
        expect(mockAddLog).toHaveBeenCalledTimes(1);
        expect(mockAddLog).toHaveBeenCalledWith(LogType.WARN, COMPUTE_MSG, {
            error: 'wasm boom',
        });
    });

    test('narrow: WASM throw → runtime-standard warn+addLog once each, TS result', async () => {
        const { hybrid, ts, mockAddLog } = await importFresh('throw');
        const entries = largeEntries();
        await expect(hybrid.narrowEntriesToTopTagsHybrid(entries, 5)).resolves.toEqual(
            ts.narrowEntriesToTopTags(entries, 5)
        );
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(NARROW_MSG, 'wasm boom');
        expect(mockAddLog).toHaveBeenCalledTimes(1);
        expect(mockAddLog).toHaveBeenCalledWith(LogType.WARN, NARROW_MSG, {
            error: 'wasm boom',
        });
    });

    test.each([-1, 2.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 32])(
        'narrow bypasses WASM without calling it for out-of-u32 limit %s',
        async (limit) => {
            const { hybrid, ts, mockNarrow } = await importFresh('ok');
            const entries = largeEntries();
            await expect(
                hybrid.narrowEntriesToTopTagsHybrid(entries, limit)
            ).resolves.toEqual(ts.narrowEntriesToTopTags(entries, limit));
            expect(mockNarrow).not.toHaveBeenCalled();
            expect(warnSpy).not.toHaveBeenCalled();
        }
    );

    test('narrow with limit 2^32-1 still routes to WASM', async () => {
        const { hybrid, mockNarrow } = await importFresh('ok');
        const entries = largeEntries();
        await expect(
            hybrid.narrowEntriesToTopTagsHybrid(entries, 2 ** 32 - 1)
        ).resolves.toBe(entries);
        expect(mockNarrow).toHaveBeenCalledTimes(1);
    });
});
