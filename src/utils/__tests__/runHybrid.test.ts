/**
 * runHybrid.test.ts
 * Contract tests for the shared hybrid skeleton (runHybrid in
 * src/utils/wasmHybridRuntime.ts): step order (merge → early-return →
 * isSafe → bypass → probe → fallback), no-probe short-circuits, and
 * fail-closed propagation. Pins the mechanism so new cores only declare
 * policy data plus callWasm/callTs adapter rows.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { runHybrid, type HybridProbe, type RunHybridPolicy } from '../wasmHybridRuntime.js';

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    warnSpy.mockRestore();
});

function availableProbe(): HybridProbe & { isAvailable: ReturnType<typeof vi.fn> } {
    return { isAvailable: vi.fn().mockResolvedValue(true) };
}

function basePolicy(overrides: Partial<RunHybridPolicy<string, string>> = {}): RunHybridPolicy<string, string> {
    return {
        probe: availableProbe(),
        fallbackMessage: 'wasm failed',
        mergeDefaults: () => 'merged',
        callWasm: async () => 'wasm',
        callTs: () => 'ts',
        ...overrides,
    };
}

describe('runHybrid step order', () => {
    test('WASM success returns the WASM value without calling TS', async () => {
        const callTs = vi.fn().mockReturnValue('ts');
        const result = await runHybrid(basePolicy({ callTs }));
        expect(result).toBe('wasm');
        expect(callTs).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
    });

    test('earlyReturn short-circuits before probe and both paths', async () => {
        const probe = availableProbe();
        const callWasm = vi.fn();
        const callTs = vi.fn();
        const result = await runHybrid(
            basePolicy({ probe, callWasm, callTs, earlyReturn: () => 'early' })
        );
        expect(result).toBe('early');
        expect(probe.isAvailable).not.toHaveBeenCalled();
        expect(callWasm).not.toHaveBeenCalled();
        expect(callTs).not.toHaveBeenCalled();
    });

    test('earlyReturn undefined continues to the WASM path', async () => {
        const result = await runHybrid(basePolicy({ earlyReturn: () => undefined }));
        expect(result).toBe('wasm');
    });

    test('isSafe false routes to TS without probing', async () => {
        const probe = availableProbe();
        const callWasm = vi.fn();
        const result = await runHybrid(
            basePolicy({ probe, callWasm, isSafe: () => false })
        );
        expect(result).toBe('ts');
        expect(probe.isAvailable).not.toHaveBeenCalled();
        expect(callWasm).not.toHaveBeenCalled();
    });

    test('bypassWasm true routes to TS without probing', async () => {
        const probe = availableProbe();
        const callWasm = vi.fn();
        const result = await runHybrid(
            basePolicy({ probe, callWasm, bypassWasm: () => true })
        );
        expect(result).toBe('ts');
        expect(probe.isAvailable).not.toHaveBeenCalled();
        expect(callWasm).not.toHaveBeenCalled();
    });

    test('unavailable probe routes to TS without calling WASM', async () => {
        const callWasm = vi.fn();
        const result = await runHybrid(
            basePolicy({
                probe: { isAvailable: vi.fn().mockResolvedValue(false) },
                callWasm,
            })
        );
        expect(result).toBe('ts');
        expect(callWasm).not.toHaveBeenCalled();
    });

    test('WASM throw falls back to TS with the policy fallback message', async () => {
        const result = await runHybrid(
            basePolicy({
                fallbackMessage: 'policy fallback msg',
                callWasm: async () => {
                    throw new Error('wasm boom');
                },
            })
        );
        expect(result).toBe('ts');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0]?.[0]).toBe('policy fallback msg');
    });

    test('throwing TS fallback propagates (fail-closed)', async () => {
        await expect(
            runHybrid(
                basePolicy({
                    callWasm: async () => {
                        throw new Error('wasm boom');
                    },
                    callTs: () => {
                        throw new Error('ts cap');
                    },
                })
            )
        ).rejects.toThrow('ts cap');
    });

    test('merged value threads through every step', async () => {
        const seen: string[] = [];
        const result = await runHybrid<string, string>({
            probe: availableProbe(),
            fallbackMessage: 'wasm failed',
            mergeDefaults: () => 'm',
            earlyReturn: (m) => {
                seen.push(`early:${m}`);
                return undefined;
            },
            isSafe: (m) => {
                seen.push(`safe:${m}`);
                return true;
            },
            bypassWasm: (m) => {
                seen.push(`bypass:${m}`);
                return false;
            },
            callWasm: async (m) => `wasm:${m}`,
            callTs: (m) => `ts:${m}`,
        });
        expect(result).toBe('wasm:m');
        expect(seen).toEqual(['early:m', 'safe:m', 'bypass:m']);
    });
});
