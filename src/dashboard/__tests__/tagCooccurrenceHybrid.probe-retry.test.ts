/**
 * tagCooccurrenceHybrid.probe-retry.test.ts
 * PBI 2026-09-21-09: the WASM availability probe must NOT cache a failure
 * permanently. A transient init failure falls back to TS for that call but
 * the next call re-probes; once init succeeds the success stays cached; a
 * consecutive failure burst logs warn + addLog exactly once.
 *
 * (Red-first: all 3 retry tests fail while isWasmAvailable() caches false.)
 */

import { describe, test, expect, vi, afterAll } from 'vitest';
import { computeTagCooccurrence, narrowEntriesToTopTags } from '../tagCooccurrence.js';

const { mockInit, mockCompute, mockNarrow, mockAddLog } = vi.hoisted(() => ({
    mockInit: vi.fn(),
    mockCompute: vi.fn(),
    mockNarrow: vi.fn(),
    mockAddLog: vi.fn(),
}));

vi.mock('../../wasm/tag-cooccur/index.js', () => ({
    initTagCooccurWasm: mockInit,
    computeCooccurrenceWithWasm: mockCompute,
    narrowEntriesToTopTagsWithWasm: mockNarrow,
}));

vi.mock('../../utils/logger/core.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../utils/logger/core.js')>();
    return { ...actual, addLog: mockAddLog };
});

const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

afterAll(() => {
    warnSpy.mockRestore();
});

/** Fresh hybrid module (resets wasmAvailable/probe-guard) with clean mocks. */
async function resetAndImport(): Promise<typeof import('../tagCooccurrenceHybrid.js')> {
    vi.resetModules();
    mockInit.mockReset();
    mockCompute.mockReset();
    mockNarrow.mockReset();
    mockAddLog.mockReset();
    warnSpy.mockClear();
    return await import('../tagCooccurrenceHybrid.js');
}

function largeEntries(): Array<{ tags: string }> {
    return Array.from({ length: 40 }, (_, i) => ({
        tags: `#tag${i % 12} #tag${(i * 5) % 12}`,
    }));
}

describe('computeTagCooccurrenceHybrid probe retry (PBI 2026-09-21-09)', () => {
    test('transient init failure recovers to WASM on the next call; success stays cached', async () => {
        const hybrid = await resetAndImport();
        const entries = largeEntries();
        const tsExpected = computeTagCooccurrence(entries);
        const wasmSentinel = { nodes: [{ id: 'wasm', count: 1 }], edges: [] };
        mockInit
            .mockRejectedValueOnce(new Error('transient fetch failure'))
            .mockResolvedValue(undefined);
        mockCompute.mockResolvedValue(wasmSentinel);

        const first = await hybrid.computeTagCooccurrenceHybrid(entries);
        expect(first).toEqual(tsExpected);
        expect(mockCompute).not.toHaveBeenCalled();
        expect(mockInit).toHaveBeenCalledTimes(1);

        const second = await hybrid.computeTagCooccurrenceHybrid(entries);
        expect(second).toBe(wasmSentinel);
        expect(mockInit).toHaveBeenCalledTimes(2);

        const third = await hybrid.computeTagCooccurrenceHybrid(entries);
        expect(third).toBe(wasmSentinel);
        expect(mockInit).toHaveBeenCalledTimes(2);
    });

    test('consecutive failures re-probe every call but log the burst only once', async () => {
        const hybrid = await resetAndImport();
        const entries = largeEntries();
        const tsExpected = computeTagCooccurrence(entries);
        mockInit.mockRejectedValue(new Error('still down'));

        for (let i = 0; i < 3; i++) {
            await expect(hybrid.computeTagCooccurrenceHybrid(entries)).resolves.toEqual(tsExpected);
        }

        expect(mockInit).toHaveBeenCalledTimes(3);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(mockAddLog).toHaveBeenCalledTimes(1);
    });
});

describe('narrowEntriesToTopTagsHybrid probe retry (PBI 2026-09-21-09)', () => {
    test('transient init failure recovers to WASM on the next call', async () => {
        const hybrid = await resetAndImport();
        const entries = largeEntries();
        const tsExpected = narrowEntriesToTopTags(entries, 5);
        const wasmSentinel = [...entries];
        mockInit
            .mockRejectedValueOnce(new Error('transient fetch failure'))
            .mockResolvedValue(undefined);
        mockNarrow.mockResolvedValue(wasmSentinel);

        const first = await hybrid.narrowEntriesToTopTagsHybrid(entries, 5);
        expect(first).toEqual(tsExpected);
        expect(mockNarrow).not.toHaveBeenCalled();

        const second = await hybrid.narrowEntriesToTopTagsHybrid(entries, 5);
        expect(second).toBe(wasmSentinel);
        expect(mockInit).toHaveBeenCalledTimes(2);
    });
});
