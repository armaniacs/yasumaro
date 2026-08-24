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

vi.mock('../../utils/i18n.js', () => ({ getMessage: vi.fn((k: string) => k) }));
vi.mock('../settings/domainFilter.js', () => ({ init: vi.fn() }));
vi.mock('../settings/privacySettings.js', () => ({ init: vi.fn() }));
vi.mock('../settings/contentSettings.js', () => ({ init: vi.fn() }));
vi.mock('../settings/trustSettings.js', () => ({ init: vi.fn(), loadTrustSettings: vi.fn() }));
vi.mock('../settings/customPromptManager.js', () => ({ initCustomPromptManager: vi.fn() }));
vi.mock('../settings/aiSummaryCleansingSettingsV2.js', () => ({
    getAiSummaryCleansingSettings: vi.fn().mockResolvedValue({}),
    applyAiSummaryCleansingSettingsToUI: vi.fn(),
    setupAiSummaryCleansingEventListeners: vi.fn(),
}));
vi.mock('../settings/aiProvider.js', () => ({
    setupAIProviderChangeListener: vi.fn(),
    updateAIProviderVisibility: vi.fn(),
    updateAIProviderVisibilityMulti: vi.fn(),
    // Moved here from dashboard.ts alongside AIProviderElements (PBI-24).
    getAiProviderElements: vi.fn(() => ({
        select: document.getElementById('aiProvider'),
    })),
}));
vi.mock('../settings/fieldValidation.js', () => ({
    clearAllFieldErrors: vi.fn(),
    validateAllFields: vi.fn().mockReturnValue(true),
    setupAllFieldValidations: vi.fn(),
}));
vi.mock('../../popup/privacyConsent.js', () => ({
    getPrivacyConsent: vi.fn().mockResolvedValue(null),
    withdrawPrivacyConsent: vi.fn(),
}));
vi.mock('../cspSettings.js', () => ({ cspSettings: { loadCSPSettings: vi.fn() } }));

const { mockGetAll, mockSetAll } = vi.hoisted(() => ({
    mockGetAll: vi.fn(),
    mockSetAll: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
  };
});

vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: mockGetAll,
      setAll: mockSetAll,
      getMany: vi.fn(),
    },
    SettingsRepository: class {
      getAll = mockGetAll;
      setAll = mockSetAll;
      getMany = vi.fn();
    },
  };
});

import {
    loadGeneralSettings,
} from '../generalSettings/settingsForm.js';
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
        mockGetAll.mockResolvedValue({
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
        mockGetAll.mockResolvedValue({
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
