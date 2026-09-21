/**
 * wasmHybridRuntime.test.ts
 * Unit tests for the shared hybrid runtime (src/utils/wasmHybridRuntime.ts):
 * probe caching contract, numeric guards, remap gate, PII error
 * single-sourcing, and the fallback wrapper.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    U32_MAX,
    createHybridProbe,
    isWasmSafeF64,
    isWasmSafeU32,
    logWasmFallback,
    piiInputSizeError,
    piiOutputTruncationError,
    remapWasmIndices,
    withWasmFallback,
} from '../wasmHybridRuntime.js';
import {
    sanitizeRegex,
    MAX_INPUT_SIZE,
    MAX_OUTPUT_SIZE,
    MAX_SKIP_SIZE,
} from '../piiSanitizer.js';

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    warnSpy.mockRestore();
});

describe('createHybridProbe', () => {
    test('success is cached permanently: init runs once across calls', async () => {
        const init = vi.fn().mockResolvedValue(undefined);
        const probe = createHybridProbe(init, 'unavailable');

        expect(await probe.isAvailable()).toBe(true);
        expect(await probe.isAvailable()).toBe(true);
        expect(init).toHaveBeenCalledTimes(1);
        expect(warnSpy).not.toHaveBeenCalled();
    });

    test('failure is NOT cached: the next call re-probes', async () => {
        const init = vi.fn().mockRejectedValue(new Error('boom'));
        const probe = createHybridProbe(init, 'unavailable');

        expect(await probe.isAvailable()).toBe(false);
        expect(await probe.isAvailable()).toBe(false);
        expect(init).toHaveBeenCalledTimes(2);
    });

    test('probe-failure warn fires at most once per failure burst', async () => {
        const init = vi.fn().mockRejectedValue(new Error('boom'));
        const probe = createHybridProbe(init, 'unavailable');

        await probe.isAvailable();
        await probe.isAvailable();
        await probe.isAvailable();
        expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    test('a success clears the burst flag so a later burst logs again', async () => {
        let fail = true;
        const init = vi.fn().mockImplementation(() => (fail ? Promise.reject(new Error('boom')) : Promise.resolve()));
        const probe = createHybridProbe(init, 'unavailable');

        await probe.isAvailable();
        expect(warnSpy).toHaveBeenCalledTimes(1);

        // Success path uses a fresh probe (the failing one can never observe
        // a success once cached-true): emulate the next context lifetime.
        fail = false;
        const probe2 = createHybridProbe(init, 'unavailable');
        expect(await probe2.isAvailable()).toBe(true);
        fail = true;
        const probe3 = createHybridProbe(init, 'unavailable');
        await probe3.isAvailable();
        expect(warnSpy).toHaveBeenCalledTimes(2);
    });

    test('a probe that recovers reports available on the re-probe', async () => {
        let calls = 0;
        const init = vi.fn().mockImplementation(() => (++calls === 1 ? Promise.reject(new Error('transient')) : Promise.resolve()));
        const probe = createHybridProbe(init, 'unavailable');

        expect(await probe.isAvailable()).toBe(false);
        expect(await probe.isAvailable()).toBe(true);
        expect(await probe.isAvailable()).toBe(true);
        expect(init).toHaveBeenCalledTimes(2);
    });
});

describe('numeric guards', () => {
    test('isWasmSafeU32 accepts the u32 boundary and rejects the rest', () => {
        expect(isWasmSafeU32(0)).toBe(true);
        expect(isWasmSafeU32(1)).toBe(true);
        expect(isWasmSafeU32(U32_MAX)).toBe(true);
        expect(U32_MAX).toBe(0xffffffff);
        expect(isWasmSafeU32(-1)).toBe(false);
        expect(isWasmSafeU32(1.5)).toBe(false);
        expect(isWasmSafeU32(2 ** 32)).toBe(false);
        expect(isWasmSafeU32(2 ** 32 + 1)).toBe(false);
        expect(isWasmSafeU32(Number.MAX_SAFE_INTEGER)).toBe(false);
        expect(isWasmSafeU32(Number.NaN)).toBe(false);
        expect(isWasmSafeU32(Number.POSITIVE_INFINITY)).toBe(false);
    });

    test('isWasmSafeF64 accepts finite values and rejects NaN/Infinity', () => {
        expect(isWasmSafeF64(0)).toBe(true);
        expect(isWasmSafeF64(0.7)).toBe(true);
        expect(isWasmSafeF64(-0.5)).toBe(true);
        expect(isWasmSafeF64(Number.NaN)).toBe(false);
        expect(isWasmSafeF64(Number.POSITIVE_INFINITY)).toBe(false);
        expect(isWasmSafeF64(Number.NEGATIVE_INFINITY)).toBe(false);
    });
});

describe('remapWasmIndices', () => {
    test('agreeing splits return the validated indices', () => {
        expect(remapWasmIndices({ indices: [2, 0], sentenceCount: 3 }, ['a', 'b', 'c'], 'textrank', 'sentences')).toEqual([2, 0]);
        expect(remapWasmIndices({ indices: [], sentenceCount: 1 }, ['only'], 'sentence-dedup', 'parts')).toEqual([]);
    });

    test('count mismatch throws with the core-qualified message', () => {
        expect(() => remapWasmIndices({ indices: [0], sentenceCount: 5 }, ['a', 'b'], 'textrank', 'sentences')).toThrow(
            'textrank wasm split mismatch (wasm 5 vs js 2 sentences)'
        );
        expect(() => remapWasmIndices({ indices: [0], sentenceCount: 1 }, ['a', 'b'], 'sentence-dedup', 'parts')).toThrow(
            'sentence-dedup wasm split mismatch (wasm 1 vs js 2 parts)'
        );
    });

    test('out-of-range indices throw with the core-qualified message', () => {
        expect(() => remapWasmIndices({ indices: [0, 9], sentenceCount: 2 }, ['a', 'b'], 'textrank', 'sentences')).toThrow(
            'textrank wasm returned out-of-range indices (got 2 indices, 2 sentences)'
        );
        expect(() => remapWasmIndices({ indices: [-1], sentenceCount: 1 }, ['a'], 'sentence-dedup', 'parts')).toThrow(
            'sentence-dedup wasm returned out-of-range indices (got 1 indices, 1 parts)'
        );
    });
});

describe('PII error single-sourcing', () => {
    test('piiInputSizeError matches sanitizeRegex on both size gates', async () => {
        const over = 'x'.repeat(MAX_INPUT_SIZE + 1);
        expect(piiInputSizeError(over, {})).toBe((await sanitizeRegex(over)).error);

        const under = 'x'.repeat(100);
        expect(piiInputSizeError(under, {})).toBeUndefined();
        expect((await sanitizeRegex(under)).error).toBeUndefined();

        const skipOk = 'x'.repeat(MAX_INPUT_SIZE + 1);
        expect(piiInputSizeError(skipOk, { skipSizeLimit: true })).toBeUndefined();

        const skipOver = 'x'.repeat(MAX_SKIP_SIZE + 1);
        expect(piiInputSizeError(skipOver, { skipSizeLimit: true })).toBe(
            (await sanitizeRegex(skipOver, { skipSizeLimit: true })).error
        );
    });

    test('piiOutputTruncationError comes from the shared constant', () => {
        expect(piiOutputTruncationError()).toBe(`Output truncated to ${MAX_OUTPUT_SIZE} characters`);
    });
});

describe('withWasmFallback / logWasmFallback', () => {
    test('returns the WASM value without logging on success', async () => {
        const runTs = vi.fn().mockReturnValue('ts');
        await expect(withWasmFallback('failed', async () => 'wasm', runTs)).resolves.toBe('wasm');
        expect(runTs).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
    });

    test('logs once and returns the TS value when WASM throws', async () => {
        await expect(
            withWasmFallback('failed for input', async () => { throw new Error('wasm boom'); }, () => 'ts')
        ).resolves.toBe('ts');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0]?.[0]).toBe('failed for input');
    });

    test('a throwing TS fallback propagates (fail-closed)', async () => {
        await expect(
            withWasmFallback(
                'failed',
                async () => { throw new Error('wasm boom'); },
                () => { throw new Error('ts cap'); }
            )
        ).rejects.toThrow('ts cap');
    });

    test('logWasmFallback emits the message plus the error detail', () => {
        logWasmFallback('call failed', new Error('detail'));
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0]?.[0]).toBe('call failed');
        expect(warnSpy.mock.calls[0]?.[1]).toBe('detail');
    });
});
