// @vitest-environment jsdom
/**
 * retention-settings.test.ts
 * TDD: Retention policy UI — load settings into selects, save on submit.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.stubGlobal('chrome', {
    i18n: { getMessage: vi.fn((k: string) => k), getUILanguage: vi.fn(() => 'en') },
    runtime: { sendMessage: vi.fn().mockResolvedValue({}) },
    storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
});

vi.mock('../../popup/i18n.js', () => ({ getMessage: vi.fn((k: string) => k) }));
vi.mock('../../popup/domainFilter.js', () => ({ init: vi.fn() }));
vi.mock('../../popup/privacySettings.js', () => ({ init: vi.fn() }));
vi.mock('../../popup/contentSettings.js', () => ({ init: vi.fn() }));
vi.mock('../../popup/trustSettings.js', () => ({ init: vi.fn(), loadTrustSettings: vi.fn() }));
vi.mock('../../popup/customPromptManager.js', () => ({ initCustomPromptManager: vi.fn() }));
vi.mock('../../popup/aiSummaryCleansingSettingsV2.js', () => ({
    getAiSummaryCleansingSettings: vi.fn().mockResolvedValue({}),
    applyAiSummaryCleansingSettingsToUI: vi.fn(),
    setupAiSummaryCleansingEventListeners: vi.fn(),
}));
vi.mock('../../popup/settings/aiProvider.js', () => ({
    setupAIProviderChangeListener: vi.fn(),
    updateAIProviderVisibility: vi.fn(),
    updateAIProviderVisibilityMulti: vi.fn(),
}));
vi.mock('../../popup/settings/fieldValidation.js', () => ({
    clearAllFieldErrors: vi.fn(),
    validateAllFields: vi.fn().mockReturnValue(true),
    setupAllFieldValidations: vi.fn(),
}));
vi.mock('../../popup/privacyConsent.js', () => ({
    getPrivacyConsent: vi.fn().mockResolvedValue(null),
    withdrawPrivacyConsent: vi.fn(),
}));
vi.mock('../../dashboard/cspSettings.js', () => ({ CSPSettings: class { load = vi.fn(); } }));

const { mockGetSettings, mockSaveSettings } = vi.hoisted(() => ({
    mockGetSettings: vi.fn(),
    mockSaveSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/storage.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../utils/storage.js')>();
    return {
        ...actual,
        getSettings: mockGetSettings,
        saveSettingsWithAllowedUrls: mockSaveSettings,
    };
});

import {
    loadGeneralSettings,
} from '../dashboard.js';
import { StorageKeys } from '../../utils/storage.js';

function buildRetentionDom() {
    document.body.innerHTML = `
        <div id="panel-general">
        <select id="sqliteRetentionDays" data-storage-key="sqlite_retention_days">
            <option value="">unlimited</option>
            <option value="30">30</option>
            <option value="90">90</option>
            <option value="180">180</option>
            <option value="365">365</option>
        </select>
        <select id="sqliteMaxRecords" data-storage-key="sqlite_max_records">
            <option value="">unlimited</option>
            <option value="1000">1,000</option>
            <option value="10000">10,000</option>
            <option value="100000">100,000</option>
        </select>
        </div>
    `;
}

describe('Retention settings UI', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        buildRetentionDom();
    });

    const baseSettings = {
        [StorageKeys.DOMAIN_FILTER_MODE]: 'blacklist',
        [StorageKeys.UBLOCK_SOURCES]: [],
        [StorageKeys.PRIVACY_MODE]: 'masked_cloud',
        [StorageKeys.AI_PROVIDER]: 'openai',
        [StorageKeys.AI_PROVIDER_PRIORITY_LIST]: [],
        [StorageKeys.OBSIDIAN_ENABLED]: false,
    };

    it('loadGeneralSettings sets retention selects to null (unlimited) by default', async () => {
        mockGetSettings.mockResolvedValue({
            ...baseSettings,
            [StorageKeys.SQLITE_RETENTION_DAYS]: null,
            [StorageKeys.SQLITE_MAX_RECORDS]: null,
        });

        await loadGeneralSettings();

        const daysEl = document.getElementById('sqliteRetentionDays') as HTMLSelectElement;
        const maxEl  = document.getElementById('sqliteMaxRecords')    as HTMLSelectElement;
        expect(daysEl.value).toBe('');
        expect(maxEl.value).toBe('');
    });

    it('loadGeneralSettings populates selects with stored numeric values', async () => {
        mockGetSettings.mockResolvedValue({
            ...baseSettings,
            [StorageKeys.SQLITE_RETENTION_DAYS]: 90,
            [StorageKeys.SQLITE_MAX_RECORDS]: 10000,
        });

        await loadGeneralSettings();

        const daysEl = document.getElementById('sqliteRetentionDays') as HTMLSelectElement;
        const maxEl  = document.getElementById('sqliteMaxRecords')    as HTMLSelectElement;
        expect(daysEl.value).toBe('90');
        expect(maxEl.value).toBe('10000');
    });
});
