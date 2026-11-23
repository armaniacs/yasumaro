/**
 * Parity pins for PBI 2026-11-11-03 (log-path-unify): wasmHybridRuntime route.
 *
 * The probe-failure warning and the per-call WASM fallback must travel the
 * structured-logger seam (logWarn) carrying the exact message + error detail
 * the old `console.warn + addLog` pair carried — exactly once per burst, with
 * no direct console emission from this module.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { logWarn } from '../logger/api.js';
import {
    createHybridProbe,
    logWasmFallback,
    withWasmFallback,
} from '../wasmHybridRuntime.js';

vi.mock('../logger/api.js', () => ({
    logWarn: vi.fn().mockResolvedValue(undefined),
}));

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    vi.mocked(logWarn).mockClear();
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    consoleWarnSpy.mockRestore();
});

describe('wasmHybridRuntime seam parity (PBI 2026-11-11-03)', () => {
    test('probe failure routes via logWarn with the unavailable message + error detail', async () => {
        const probe = createHybridProbe(
            () => Promise.reject(new Error('boom')),
            'wasm unavailable for test'
        );

        await expect(probe.isAvailable()).resolves.toBe(false);

        expect(logWarn).toHaveBeenCalledTimes(1);
        expect(logWarn).toHaveBeenCalledWith(
            'wasm unavailable for test',
            { error: 'boom' },
            undefined,
            'wasmHybridRuntime'
        );
        expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    test('probe-failure burst still emits exactly one seam line', async () => {
        const probe = createHybridProbe(
            () => Promise.reject(new Error('boom')),
            'wasm unavailable for test'
        );

        await probe.isAvailable();
        await probe.isAvailable();
        await probe.isAvailable();

        expect(logWarn).toHaveBeenCalledTimes(1);
        expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    test('logWasmFallback routes via logWarn with the fallback message + error detail', () => {
        logWasmFallback('test fallback for input', new Error('wasm boom'));

        expect(logWarn).toHaveBeenCalledTimes(1);
        expect(logWarn).toHaveBeenCalledWith(
            'test fallback for input',
            { error: 'wasm boom' },
            undefined,
            'wasmHybridRuntime'
        );
        expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    test('withWasmFallback success path stays silent', async () => {
        const runTs = vi.fn().mockReturnValue('ts');

        await expect(
            withWasmFallback('failed', async () => 'wasm', runTs)
        ).resolves.toBe('wasm');

        expect(runTs).not.toHaveBeenCalled();
        expect(logWarn).not.toHaveBeenCalled();
        expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    test('withWasmFallback failure path logs once via the seam and returns the TS value', async () => {
        await expect(
            withWasmFallback(
                'failed for input',
                async () => {
                    throw new Error('wasm boom');
                },
                () => 'ts'
            )
        ).resolves.toBe('ts');

        expect(logWarn).toHaveBeenCalledTimes(1);
        expect(logWarn).toHaveBeenCalledWith(
            'failed for input',
            { error: 'wasm boom' },
            undefined,
            'wasmHybridRuntime'
        );
        expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
});
