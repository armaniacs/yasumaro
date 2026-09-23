// @vitest-environment jsdom
/**
 * perSiteOverrides-seam.test.ts (PBI 2026-09-23-15)
 * Pins the targeted-read migration: every load path (refresh, domain change,
 * save, delete) reads the single overrides key and never issues a full getAll().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedGet = vi.hoisted(() => vi.fn());
const mockedGetAll = vi.hoisted(() => vi.fn());
const mockedSetAll = vi.hoisted(() => vi.fn());

vi.mock('../../../utils/storage/SettingsRepository.js', () => ({
    settingsRepository: {
        get: mockedGet,
        getAll: mockedGetAll,
        setAll: mockedSetAll,
    },
}));

vi.mock('../../../utils/i18n.js', () => ({
    getMessage: vi.fn((key: string) => key),
}));

vi.mock('../../../utils/logger/api.js', () => ({
    logError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../utils/logger/types.js', () => ({
    ErrorCode: { STORAGE_WRITE_FAILURE: 'STRG_WR_001' },
}));

import { initPerSiteOverrides } from '../perSiteOverrides.js';
import { StorageKeys } from '../../../utils/storage/types.js';

function buildDom(): void {
    document.body.innerHTML = `
    <input id="perSiteOverrideDomain" />
    <div id="perSiteOverrideToggles"></div>
    <button id="perSiteOverrideSaveBtn"></button>
    <button id="perSiteOverrideDeleteBtn"></button>
    <div id="perSiteOverrideStatus"></div>
    <div id="perSiteOverrideList"></div>
  `;
}

function flush(times = 8): Promise<void> {
    let chain = Promise.resolve();
    for (let i = 0; i < times; i++) chain = chain.then(() => new Promise((r) => setTimeout(r, 0)));
    return chain;
}

beforeEach(() => {
    vi.clearAllMocks();
    mockedGet.mockResolvedValue([]);
    mockedGetAll.mockResolvedValue({});
    mockedSetAll.mockResolvedValue(undefined);
    buildDom();
});

describe('perSiteOverrides — targeted overrides read (PBI 2026-09-23-15)', () => {
    it('initial refresh reads the single key, never a full getAll()', async () => {
        mockedGet.mockResolvedValue([
            { domain: 'example.com', overrides: { altEnabled: true } },
        ]);
        initPerSiteOverrides();
        await flush();
        expect(mockedGet).toHaveBeenCalledWith(StorageKeys.DOMAIN_CLEANSING_OVERRIDES);
        expect(mockedGetAll).not.toHaveBeenCalled();
        expect(document.getElementById('perSiteOverrideList')!.textContent).toContain('example.com');
    });

    it('domain change re-reads the single key, never a full getAll()', async () => {
        initPerSiteOverrides();
        await flush();
        const before = mockedGet.mock.calls.length;
        (document.getElementById('perSiteOverrideDomain') as HTMLInputElement).value = 'example.com';
        document.getElementById('perSiteOverrideDomain')!.dispatchEvent(new Event('change'));
        await flush();
        expect(mockedGet.mock.calls.length).toBeGreaterThan(before);
        expect(mockedGetAll).not.toHaveBeenCalled();
    });

    it('save loads targeted and persists a delta without any full read', async () => {
        initPerSiteOverrides();
        await flush();
        (document.getElementById('perSiteOverrideDomain') as HTMLInputElement).value = 'example.com';
        (document.getElementById('per-site-override-alt') as HTMLInputElement).checked = true;
        (document.getElementById('perSiteOverrideSaveBtn') as HTMLButtonElement).click();
        await flush();
        expect(mockedGet).toHaveBeenCalledWith(StorageKeys.DOMAIN_CLEANSING_OVERRIDES);
        expect(mockedGetAll).not.toHaveBeenCalled();
        expect(mockedSetAll).toHaveBeenCalledTimes(1);
        const delta = mockedSetAll.mock.calls[0]![0] as Record<string, unknown>;
        expect(Object.keys(delta)).toEqual([StorageKeys.DOMAIN_CLEANSING_OVERRIDES]);
    });

    it('delete loads targeted and persists a delta without any full read', async () => {
        mockedGet.mockResolvedValue([
            { domain: 'example.com', overrides: { altEnabled: true } },
        ]);
        initPerSiteOverrides();
        await flush();
        (document.getElementById('perSiteOverrideDomain') as HTMLInputElement).value = 'example.com';
        (document.getElementById('perSiteOverrideDeleteBtn') as HTMLButtonElement).click();
        await flush();
        expect(mockedGetAll).not.toHaveBeenCalled();
        expect(mockedSetAll).toHaveBeenCalledTimes(1);
    });
});
