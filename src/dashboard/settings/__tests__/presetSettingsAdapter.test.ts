/**
 * presetSettingsAdapter.test.ts (PBI 2026-09-23-15)
 * Pins the repository-seam adapter: blob-first preset read, read-only legacy
 * top-level fallback, targeted overrides read, and seam observe forwarding.
 */
import { describe, it, expect, vi } from 'vitest';

import { observePreset, readOverrides, readStoredPreset, writePreset } from '../presetSettingsAdapter.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import type { SettingsRepository } from '../../../utils/storage/SettingsRepository.js';

function seam(partial: Record<string, unknown>): SettingsRepository {
    return partial as unknown as SettingsRepository;
}

describe('readStoredPreset — repository blob first, legacy top-level fallback', () => {
    it('returns the blob value without consulting the legacy top-level key', async () => {
        const portGet = vi.fn(async (keys: string[]) => (
            keys.includes('settings')
                ? { settings: { [StorageKeys.CLEANSING_PRESET]: 'balanced' } }
                : {}
        ));
        const result = await readStoredPreset(seam({ getPort: () => ({ get: portGet }) }));
        expect(result).toBe('balanced');
        expect(portGet).toHaveBeenCalledTimes(1);
        expect(portGet).toHaveBeenCalledWith(['settings']);
    });

    it('falls back to the legacy scattered top-level key when the blob has no preset', async () => {
        const portGet = vi.fn(async (keys: string[]) => (
            keys.includes('settings')
                ? { settings: {} }
                : { [StorageKeys.CLEANSING_PRESET]: 'aggressive' }
        ));
        const result = await readStoredPreset(seam({ getPort: () => ({ get: portGet }) }));
        expect(result).toBe('aggressive');
        expect(portGet).toHaveBeenCalledTimes(2);
    });

    it('returns undefined when neither location holds a preset (fresh user → migration runs)', async () => {
        const portGet = vi.fn().mockResolvedValue({});
        const result = await readStoredPreset(seam({ getPort: () => ({ get: portGet }) }));
        expect(result).toBeUndefined();
    });

    it('rejects unrecognized stored values instead of surfacing them as presets', async () => {
        const portGet = vi.fn(async (keys: string[]) => (
            keys.includes('settings')
                ? { settings: { [StorageKeys.CLEANSING_PRESET]: ' turbo ' } }
                : {}
        ));
        expect(await readStoredPreset(seam({ getPort: () => ({ get: portGet }) }))).toBeUndefined();
    });

    it('supports partial seams exposing getAll only (present key counts, absent means unset)', async () => {
        const withKey = seam({ getAll: async () => ({ [StorageKeys.CLEANSING_PRESET]: 'minimal' }) });
        expect(await readStoredPreset(withKey)).toBe('minimal');
        const withoutKey = seam({ getAll: async () => ({}) });
        expect(await readStoredPreset(withoutKey)).toBeUndefined();
    });
});

describe('writePreset — delta write through the repository lock', () => {
    it('prefers the typed single-key write', async () => {
        const set = vi.fn().mockResolvedValue(undefined);
        const setAll = vi.fn().mockResolvedValue(undefined);
        await writePreset('balanced', seam({ set, setAll }));
        expect(set).toHaveBeenCalledWith(StorageKeys.CLEANSING_PRESET, 'balanced');
        expect(setAll).not.toHaveBeenCalled();
    });

    it('falls back to a single-key delta on seams without set', async () => {
        const setAll = vi.fn().mockResolvedValue(undefined);
        await writePreset('custom', seam({ setAll }));
        expect(setAll).toHaveBeenCalledWith({ [StorageKeys.CLEANSING_PRESET]: 'custom' });
    });
});

describe('readOverrides — targeted single-key read', () => {
    const entries = [{ domain: 'example.com', overrides: { altEnabled: true } }];

    it('uses get() and never touches getAll() on full seams', async () => {
        const get = vi.fn().mockResolvedValue(entries);
        const getAll = vi.fn().mockResolvedValue({});
        const result = await readOverrides(seam({ get, getAll }));
        expect(get).toHaveBeenCalledWith(StorageKeys.DOMAIN_CLEANSING_OVERRIDES);
        expect(getAll).not.toHaveBeenCalled();
        expect(result).toEqual(entries);
    });

    it('returns [] for missing or non-array payloads', async () => {
        expect(await readOverrides(seam({ get: async () => undefined }))).toEqual([]);
        expect(await readOverrides(seam({ get: async () => 'nope' as unknown as never }))).toEqual([]);
    });

    it('falls back to getAll() on partial seams', async () => {
        const getAll = vi.fn().mockResolvedValue({ [StorageKeys.DOMAIN_CLEANSING_OVERRIDES]: entries });
        expect(await readOverrides(seam({ getAll }))).toEqual(entries);
        expect(getAll).toHaveBeenCalledTimes(1);
    });
});

describe('observePreset — seam subscription', () => {
    it('forwards preset changes and ignores unrelated keys', async () => {
        let captured: ((changes: Record<string, unknown>) => void) | null = null;
        const listener = vi.fn();
        observePreset(listener, seam({ observe: (cb: (c: Record<string, unknown>) => void) => { captured = cb; } }));
        expect(captured).not.toBeNull();
        captured!({ [StorageKeys.CLEANSING_PRESET]: 'minimal' });
        captured!({ someOtherKey: 1 });
        captured!({ [StorageKeys.CLEANSING_PRESET]: 'bogus' });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith('minimal');
    });

    it('uses onChange when observe is unavailable, and is a safe noop otherwise', () => {
        let captured: ((changes: Record<string, unknown>) => void) | null = null;
        const listener = vi.fn();
        const stop = observePreset(listener, seam({ onChange: (cb: (c: Record<string, unknown>) => void) => { captured = cb; } }));
        captured!({ [StorageKeys.CLEANSING_PRESET]: 'custom' });
        expect(listener).toHaveBeenCalledWith('custom');
        stop();
        captured!({ [StorageKeys.CLEANSING_PRESET]: 'minimal' });
        expect(listener).toHaveBeenCalledTimes(1);

        const noop = observePreset(vi.fn(), seam({}));
        expect(() => noop()).not.toThrow();
    });
});
