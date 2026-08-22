/**
 * aiSummaryCleansingSettings.test.ts
 * Tests for src/popup/aiSummaryCleansingSettingsV2.ts
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      StorageKeys: {
          AI_SUMMARY_CLEANSING_ENABLED: 'ai_summary_cleansing_enabled',
          AI_SUMMARY_CLEANSING_ALT: 'ai_summary_cleansing_alt',
          AI_SUMMARY_CLEANSING_METADATA: 'ai_summary_cleansing_metadata',
          AI_SUMMARY_CLEANSING_ADS: 'ai_summary_cleansing_ads',
          AI_SUMMARY_CLEANSING_NAV: 'ai_summary_cleansing_nav',
          AI_SUMMARY_CLEANSING_SOCIAL: 'ai_summary_cleansing_social',
          AI_SUMMARY_CLEANSING_DEEP: 'ai_summary_cleansing_deep',
          AI_SUMMARY_CLEANSING_LINK_DENSITY: 'ai_summary_cleansing_link_density',
          AI_SUMMARY_CLEANSING_JSON_LD: 'ai_summary_cleansing_json_ld',
          AI_SUMMARY_CLEANSING_LAZY_LOAD: 'ai_summary_cleansing_lazy_load',
          AI_SUMMARY_CLEANSING_SKIP_LINK: 'ai_summary_cleansing_skip_link',
          AI_SUMMARY_CLEANSING_CARD: 'ai_summary_cleansing_card',
      },
      DEFAULT_SETTINGS: {},
      getSettings: vi.fn(),
      saveSettings: vi.fn(() => Promise.resolve()),

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../../utils/storage/defaults.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      StorageKeys: {
          AI_SUMMARY_CLEANSING_ENABLED: 'ai_summary_cleansing_enabled',
          AI_SUMMARY_CLEANSING_ALT: 'ai_summary_cleansing_alt',
          AI_SUMMARY_CLEANSING_METADATA: 'ai_summary_cleansing_metadata',
          AI_SUMMARY_CLEANSING_ADS: 'ai_summary_cleansing_ads',
          AI_SUMMARY_CLEANSING_NAV: 'ai_summary_cleansing_nav',
          AI_SUMMARY_CLEANSING_SOCIAL: 'ai_summary_cleansing_social',
          AI_SUMMARY_CLEANSING_DEEP: 'ai_summary_cleansing_deep',
          AI_SUMMARY_CLEANSING_LINK_DENSITY: 'ai_summary_cleansing_link_density',
          AI_SUMMARY_CLEANSING_JSON_LD: 'ai_summary_cleansing_json_ld',
          AI_SUMMARY_CLEANSING_LAZY_LOAD: 'ai_summary_cleansing_lazy_load',
          AI_SUMMARY_CLEANSING_SKIP_LINK: 'ai_summary_cleansing_skip_link',
          AI_SUMMARY_CLEANSING_CARD: 'ai_summary_cleansing_card',
      },
      DEFAULT_SETTINGS: {},
      getSettings: vi.fn(),
      saveSettings: vi.fn(() => Promise.resolve()),

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../../utils/storage/encryptionSession.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      StorageKeys: {
          AI_SUMMARY_CLEANSING_ENABLED: 'ai_summary_cleansing_enabled',
          AI_SUMMARY_CLEANSING_ALT: 'ai_summary_cleansing_alt',
          AI_SUMMARY_CLEANSING_METADATA: 'ai_summary_cleansing_metadata',
          AI_SUMMARY_CLEANSING_ADS: 'ai_summary_cleansing_ads',
          AI_SUMMARY_CLEANSING_NAV: 'ai_summary_cleansing_nav',
          AI_SUMMARY_CLEANSING_SOCIAL: 'ai_summary_cleansing_social',
          AI_SUMMARY_CLEANSING_DEEP: 'ai_summary_cleansing_deep',
          AI_SUMMARY_CLEANSING_LINK_DENSITY: 'ai_summary_cleansing_link_density',
          AI_SUMMARY_CLEANSING_JSON_LD: 'ai_summary_cleansing_json_ld',
          AI_SUMMARY_CLEANSING_LAZY_LOAD: 'ai_summary_cleansing_lazy_load',
          AI_SUMMARY_CLEANSING_SKIP_LINK: 'ai_summary_cleansing_skip_link',
          AI_SUMMARY_CLEANSING_CARD: 'ai_summary_cleansing_card',
      },
      DEFAULT_SETTINGS: {},
      getSettings: vi.fn(),
      saveSettings: vi.fn(() => Promise.resolve()),

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../../utils/storage/settingsStore.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      StorageKeys: {
          AI_SUMMARY_CLEANSING_ENABLED: 'ai_summary_cleansing_enabled',
          AI_SUMMARY_CLEANSING_ALT: 'ai_summary_cleansing_alt',
          AI_SUMMARY_CLEANSING_METADATA: 'ai_summary_cleansing_metadata',
          AI_SUMMARY_CLEANSING_ADS: 'ai_summary_cleansing_ads',
          AI_SUMMARY_CLEANSING_NAV: 'ai_summary_cleansing_nav',
          AI_SUMMARY_CLEANSING_SOCIAL: 'ai_summary_cleansing_social',
          AI_SUMMARY_CLEANSING_DEEP: 'ai_summary_cleansing_deep',
          AI_SUMMARY_CLEANSING_LINK_DENSITY: 'ai_summary_cleansing_link_density',
          AI_SUMMARY_CLEANSING_JSON_LD: 'ai_summary_cleansing_json_ld',
          AI_SUMMARY_CLEANSING_LAZY_LOAD: 'ai_summary_cleansing_lazy_load',
          AI_SUMMARY_CLEANSING_SKIP_LINK: 'ai_summary_cleansing_skip_link',
          AI_SUMMARY_CLEANSING_CARD: 'ai_summary_cleansing_card',
      },
      DEFAULT_SETTINGS: {},
      getSettings: vi.fn(),
      saveSettings: vi.fn(() => Promise.resolve()),

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../../utils/storage/savedUrlRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      StorageKeys: {
          AI_SUMMARY_CLEANSING_ENABLED: 'ai_summary_cleansing_enabled',
          AI_SUMMARY_CLEANSING_ALT: 'ai_summary_cleansing_alt',
          AI_SUMMARY_CLEANSING_METADATA: 'ai_summary_cleansing_metadata',
          AI_SUMMARY_CLEANSING_ADS: 'ai_summary_cleansing_ads',
          AI_SUMMARY_CLEANSING_NAV: 'ai_summary_cleansing_nav',
          AI_SUMMARY_CLEANSING_SOCIAL: 'ai_summary_cleansing_social',
          AI_SUMMARY_CLEANSING_DEEP: 'ai_summary_cleansing_deep',
          AI_SUMMARY_CLEANSING_LINK_DENSITY: 'ai_summary_cleansing_link_density',
          AI_SUMMARY_CLEANSING_JSON_LD: 'ai_summary_cleansing_json_ld',
          AI_SUMMARY_CLEANSING_LAZY_LOAD: 'ai_summary_cleansing_lazy_load',
          AI_SUMMARY_CLEANSING_SKIP_LINK: 'ai_summary_cleansing_skip_link',
          AI_SUMMARY_CLEANSING_CARD: 'ai_summary_cleansing_card',
      },
      DEFAULT_SETTINGS: {},
      getSettings: vi.fn(),
      saveSettings: vi.fn(() => Promise.resolve()),

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../../utils/storage/domainFilterCache.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      StorageKeys: {
          AI_SUMMARY_CLEANSING_ENABLED: 'ai_summary_cleansing_enabled',
          AI_SUMMARY_CLEANSING_ALT: 'ai_summary_cleansing_alt',
          AI_SUMMARY_CLEANSING_METADATA: 'ai_summary_cleansing_metadata',
          AI_SUMMARY_CLEANSING_ADS: 'ai_summary_cleansing_ads',
          AI_SUMMARY_CLEANSING_NAV: 'ai_summary_cleansing_nav',
          AI_SUMMARY_CLEANSING_SOCIAL: 'ai_summary_cleansing_social',
          AI_SUMMARY_CLEANSING_DEEP: 'ai_summary_cleansing_deep',
          AI_SUMMARY_CLEANSING_LINK_DENSITY: 'ai_summary_cleansing_link_density',
          AI_SUMMARY_CLEANSING_JSON_LD: 'ai_summary_cleansing_json_ld',
          AI_SUMMARY_CLEANSING_LAZY_LOAD: 'ai_summary_cleansing_lazy_load',
          AI_SUMMARY_CLEANSING_SKIP_LINK: 'ai_summary_cleansing_skip_link',
          AI_SUMMARY_CLEANSING_CARD: 'ai_summary_cleansing_card',
      },
      DEFAULT_SETTINGS: {},
      getSettings: vi.fn(),
      saveSettings: vi.fn(() => Promise.resolve()),

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../../utils/storage/quota.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      StorageKeys: {
          AI_SUMMARY_CLEANSING_ENABLED: 'ai_summary_cleansing_enabled',
          AI_SUMMARY_CLEANSING_ALT: 'ai_summary_cleansing_alt',
          AI_SUMMARY_CLEANSING_METADATA: 'ai_summary_cleansing_metadata',
          AI_SUMMARY_CLEANSING_ADS: 'ai_summary_cleansing_ads',
          AI_SUMMARY_CLEANSING_NAV: 'ai_summary_cleansing_nav',
          AI_SUMMARY_CLEANSING_SOCIAL: 'ai_summary_cleansing_social',
          AI_SUMMARY_CLEANSING_DEEP: 'ai_summary_cleansing_deep',
          AI_SUMMARY_CLEANSING_LINK_DENSITY: 'ai_summary_cleansing_link_density',
          AI_SUMMARY_CLEANSING_JSON_LD: 'ai_summary_cleansing_json_ld',
          AI_SUMMARY_CLEANSING_LAZY_LOAD: 'ai_summary_cleansing_lazy_load',
          AI_SUMMARY_CLEANSING_SKIP_LINK: 'ai_summary_cleansing_skip_link',
          AI_SUMMARY_CLEANSING_CARD: 'ai_summary_cleansing_card',
      },
      DEFAULT_SETTINGS: {},
      getSettings: vi.fn(),
      saveSettings: vi.fn(() => Promise.resolve()),

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;

import * as storage from '../../../utils/storage/types.js';
import * as storageSettings from '../../../utils/storage/settingsStore.js';
import {
    getAiSummaryCleansingSettings,
    saveAiSummaryCleansingSettings,
    type AiSummaryCleansingSettings,
} from '../aiSummaryCleansingSettingsV2.js';

const mockGetSettings = vi.mocked(storageSettings.getSettings);
const mockSaveSettings = vi.mocked(storageSettings.saveSettings);

const baseStorageValues = {
    ai_summary_cleansing_enabled: true,
    ai_summary_cleansing_alt: true,
    ai_summary_cleansing_metadata: true,
    ai_summary_cleansing_ads: true,
    ai_summary_cleansing_nav: true,
    ai_summary_cleansing_social: true,
    ai_summary_cleansing_deep: false,
    ai_summary_cleansing_link_density: false,
};

beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockSaveSettings.mockResolvedValue(undefined as any);
});

describe('getAiSummaryCleansingSettings', () => {
    test('returns jsonLdEnabled true when storage has true', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockGetSettings.mockResolvedValueOnce({
            ...baseStorageValues,
            ai_summary_cleansing_json_ld: true,
            ai_summary_cleansing_lazy_load: false,
            ai_summary_cleansing_skip_link: false,
            ai_summary_cleansing_card: false,
        } as any);

        const settings = await getAiSummaryCleansingSettings();

        expect(settings.jsonLdEnabled).toBe(true);
    });

    test('returns lazyLoadEnabled true when storage has true', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockGetSettings.mockResolvedValueOnce({
            ...baseStorageValues,
            ai_summary_cleansing_json_ld: false,
            ai_summary_cleansing_lazy_load: true,
            ai_summary_cleansing_skip_link: false,
            ai_summary_cleansing_card: false,
        } as any);

        const settings = await getAiSummaryCleansingSettings();

        expect(settings.lazyLoadEnabled).toBe(true);
    });

    test('returns skipLinkEnabled true when storage has true', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockGetSettings.mockResolvedValueOnce({
            ...baseStorageValues,
            ai_summary_cleansing_json_ld: false,
            ai_summary_cleansing_lazy_load: false,
            ai_summary_cleansing_skip_link: true,
            ai_summary_cleansing_card: false,
        } as any);

        const settings = await getAiSummaryCleansingSettings();

        expect(settings.skipLinkEnabled).toBe(true);
    });

    test('returns cardEnabled true when storage has true', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockGetSettings.mockResolvedValueOnce({
            ...baseStorageValues,
            ai_summary_cleansing_json_ld: false,
            ai_summary_cleansing_lazy_load: false,
            ai_summary_cleansing_skip_link: false,
            ai_summary_cleansing_card: true,
        } as any);

        const settings = await getAiSummaryCleansingSettings();

        expect(settings.cardEnabled).toBe(true);
    });

    test('defaults all 4 new fields to false when absent from storage', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockGetSettings.mockResolvedValueOnce({ ...baseStorageValues } as any);

        const settings = await getAiSummaryCleansingSettings();

        expect(settings.jsonLdEnabled).toBe(false);
        expect(settings.lazyLoadEnabled).toBe(false);
        expect(settings.skipLinkEnabled).toBe(false);
        expect(settings.cardEnabled).toBe(false);
    });
});

describe('saveAiSummaryCleansingSettings', () => {
    const baseSettings: AiSummaryCleansingSettings = {
        enabled: true,
        altEnabled: true,
        metadataEnabled: true,
        adsEnabled: true,
        navEnabled: true,
        socialEnabled: true,
        deepEnabled: false,
        linkDensityEnabled: false,
        jsonLdEnabled: false,
        lazyLoadEnabled: false,
        skipLinkEnabled: false,
        cardEnabled: false,
    };

    test('saves jsonLdEnabled to storage', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockGetSettings.mockResolvedValueOnce({} as any);

        await saveAiSummaryCleansingSettings({ ...baseSettings, jsonLdEnabled: true });

        expect(mockSaveSettings).toHaveBeenCalledWith(
            expect.objectContaining({ ai_summary_cleansing_json_ld: true })
        );
    });

    test('saves lazyLoadEnabled to storage', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockGetSettings.mockResolvedValueOnce({} as any);

        await saveAiSummaryCleansingSettings({ ...baseSettings, lazyLoadEnabled: true });

        expect(mockSaveSettings).toHaveBeenCalledWith(
            expect.objectContaining({ ai_summary_cleansing_lazy_load: true })
        );
    });

    test('saves skipLinkEnabled to storage', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockGetSettings.mockResolvedValueOnce({} as any);

        await saveAiSummaryCleansingSettings({ ...baseSettings, skipLinkEnabled: true });

        expect(mockSaveSettings).toHaveBeenCalledWith(
            expect.objectContaining({ ai_summary_cleansing_skip_link: true })
        );
    });

    test('saves cardEnabled to storage', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockGetSettings.mockResolvedValueOnce({} as any);

        await saveAiSummaryCleansingSettings({ ...baseSettings, cardEnabled: true });

        expect(mockSaveSettings).toHaveBeenCalledWith(
            expect.objectContaining({ ai_summary_cleansing_card: true })
        );
    });
});
