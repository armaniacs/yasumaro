/**
 * cleansingPresetStore.test.ts (PBI 2026-09-23-15)
 * Pins the repository-seam migration: blob-first reads with read-only legacy
 * fallback, single locked-delta writes, the apply-epoch race guard, and the
 * busy-window / custom-transition Depth — with no raw chrome.storage access.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakePortGet = vi.hoisted(() => vi.fn());
const fakeGetAll = vi.hoisted(() => vi.fn());
const fakeSetAll = vi.hoisted(() => vi.fn());
const fakeSet = vi.hoisted(() => vi.fn());
const observeCallbacks = vi.hoisted(() => [] as Array<(changes: Record<string, unknown>) => void>);

vi.mock('../../../utils/storage/SettingsRepository.js', () => ({
    settingsRepository: {
        getAll: fakeGetAll,
        setAll: fakeSetAll,
        set: fakeSet,
        getPort: () => ({ get: fakePortGet }),
        observe: (cb: (changes: Record<string, unknown>) => void) => { observeCallbacks.push(cb); },
    },
}));

vi.mock('../../../utils/logger/api.js', () => ({
    logError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../utils/logger/types.js', () => ({
    ErrorCode: { STORAGE_WRITE_FAILURE: 'STORAGE_WRITE_FAILURE' },
}));

import { createCleansingPresetStore } from '../cleansingPresetStore.js';
import { StorageKeys } from '../../../utils/storage/types.js';

/** In-memory blob standing in for the repository; writes converge into it. */
let blob: Record<string, unknown>;
let legacyTopLevel: Record<string, unknown>;

function flush(times = 5): Promise<void> {
    let chain = Promise.resolve();
    for (let i = 0; i < times; i++) chain = chain.then(() => new Promise((r) => setTimeout(r, 0)));
    return chain;
}

beforeEach(() => {
    vi.clearAllMocks();
    observeCallbacks.length = 0;
    blob = {};
    legacyTopLevel = {};
    // No raw storage anywhere: the seam fakes are the only backend, and even
    // the global chrome namespace must be absent for these tests to pass.
    delete (globalThis as unknown as Record<string, unknown>)['chrome'];
    fakePortGet.mockImplementation(async (keys: string[]) => {
        if (keys.includes('settings')) return { settings: { ...blob } };
        const out: Record<string, unknown> = {};
        for (const k of keys) {
            if (k in legacyTopLevel) out[k] = legacyTopLevel[k];
        }
        return out;
    });
    fakeGetAll.mockImplementation(async () => ({ ...blob }));
    fakeSetAll.mockImplementation(async (delta: Record<string, unknown>) => {
        blob = { ...blob, ...delta };
    });
    fakeSet.mockImplementation(async (key: string, value: unknown) => {
        blob = { ...blob, [key]: value };
    });
});

describe('cleansingPresetStore — seam reads (read-first with fallback)', () => {
    it('getPreset returns the stored blob value without any migration write', async () => {
        blob = { [StorageKeys.CLEANSING_PRESET]: 'balanced' };
        const store = createCleansingPresetStore();
        expect(await store.getPreset()).toBe('balanced');
        expect(fakeSet).not.toHaveBeenCalled();
        expect(fakeSetAll).not.toHaveBeenCalled();
    });

    it('honors the legacy scattered top-level key when the blob has no preset', async () => {
        legacyTopLevel = { [StorageKeys.CLEANSING_PRESET]: 'aggressive' };
        const store = createCleansingPresetStore();
        expect(await store.getPreset()).toBe('aggressive');
        expect(fakeSet).not.toHaveBeenCalled();
        expect(fakeSetAll).not.toHaveBeenCalled();
    });

    it('migrates a fresh user to custom and persists through the seam (never top-level)', async () => {
        const store = createCleansingPresetStore();
        const seen: string[] = [];
        store.subscribe((pid) => seen.push(pid));
        expect(await store.getPreset()).toBe('custom');
        expect(fakeSet).toHaveBeenCalledWith(StorageKeys.CLEANSING_PRESET, 'custom');
        expect(seen).toEqual(['custom']);
        expect(legacyTopLevel).toEqual({});
    });
});

describe('cleansingPresetStore — stale-overwrite window (epoch guard)', () => {
    it('a migration racing applyPreset abandons its write', async () => {
        let releaseGetAll!: (value: Record<string, unknown>) => void;
        const gate = new Promise<Record<string, unknown>>((resolve) => { releaseGetAll = resolve; });
        fakeGetAll.mockReturnValueOnce(gate);

        const store = createCleansingPresetStore();
        const migration = store.ensureMigrated();
        await flush(2);
        await store.applyPreset('balanced');
        expect(fakeSetAll).toHaveBeenCalledTimes(1);
        releaseGetAll({});
        await migration;
        await flush();

        // Only the applyPreset delta landed; the stale migration wrote nothing.
        expect(fakeSet).not.toHaveBeenCalled();
        expect(fakeSetAll).toHaveBeenCalledTimes(1);
        expect(blob[StorageKeys.CLEANSING_PRESET]).toBe('balanced');
    });
});

describe('cleansingPresetStore — busy window and custom transition (Depth kept)', () => {
    it('markCustomOnManualEdit is a noop inside the busy window', async () => {
        blob = { [StorageKeys.CLEANSING_PRESET]: 'balanced' };
        const store = createCleansingPresetStore();
        store.holdBusy();
        await store.markCustomOnManualEdit();
        expect(fakeSet).not.toHaveBeenCalled();
        expect(fakeSetAll).not.toHaveBeenCalled();
        expect(blob[StorageKeys.CLEANSING_PRESET]).toBe('balanced');
    });

    it('a manual edit outside the window transitions a stored preset to custom', async () => {
        blob = { [StorageKeys.CLEANSING_PRESET]: 'balanced' };
        const store = createCleansingPresetStore();
        const seen: string[] = [];
        store.subscribe((pid) => seen.push(pid));
        await store.markCustomOnManualEdit();
        expect(fakeSet).toHaveBeenCalledWith(StorageKeys.CLEANSING_PRESET, 'custom');
        expect(seen).toEqual(['custom']);
    });

    it('applyPreset then manual edit round-trips balanced → custom through one seam', async () => {
        const store = createCleansingPresetStore();
        await store.applyPreset('balanced');
        await flush();
        expect(blob[StorageKeys.CLEANSING_PRESET]).toBe('balanced');
        await store.markCustomOnManualEdit();
        expect(blob[StorageKeys.CLEANSING_PRESET]).toBe('custom');
    });
});

describe('cleansingPresetStore — single locked-delta writes, zero raw storage', () => {
    it('applyPreset carries preset + owned rule keys in one setAll delta', async () => {
        const store = createCleansingPresetStore();
        await store.applyPreset('minimal');
        expect(fakeSetAll).toHaveBeenCalledTimes(1);
        const delta = fakeSetAll.mock.calls[0]![0] as Record<string, unknown>;
        expect(delta[StorageKeys.CLEANSING_PRESET]).toBe('minimal');
        expect(Object.keys(delta).length).toBeGreaterThan(1);
        expect((globalThis as unknown as Record<string, unknown>)['chrome']).toBeUndefined();
    });

    it('forwards external seam changes to subscribers but drops own-write echoes', async () => {
        const store = createCleansingPresetStore();
        const seen: string[] = [];
        store.subscribe((pid) => seen.push(pid));
        expect(observeCallbacks.length).toBe(1);
        observeCallbacks[0]!({ [StorageKeys.CLEANSING_PRESET]: 'minimal' });
        expect(seen).toEqual(['minimal']);
        await store.applyPreset('balanced');
        await flush();
        observeCallbacks[0]!({ [StorageKeys.CLEANSING_PRESET]: 'balanced' });
        expect(seen).toEqual(['minimal', 'balanced']);
    });
});
