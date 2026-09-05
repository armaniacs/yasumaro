// @vitest-environment jsdom
/**
 * settingsPipeline.test.ts
 * Branch-coverage tests for saveDashboardSettings and GENERAL_SETTINGS_VALIDATION_FIELDS.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSettings: hoistedGetSettings, mockSaveSettings: hoistedSaveSettings } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockSaveSettings: vi.fn(),
}));


vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: hoistedGetSettings,
      setAll: hoistedSaveSettings,
      getMany: hoistedGetSettings,
      clearCache: vi.fn(),
    },
    SettingsRepository: class {
      getAll = hoistedGetSettings;
      setAll = hoistedSaveSettings;
      getMany = hoistedGetSettings;
      clearCache = vi.fn();
    },
  };
});

vi.mock('../../utils/storage/domainFilterCache.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    updateDomainFilterCache: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../utils/settingsFormBinding.js', () => ({
  extractSettingsFromInputs: vi.fn(),
  extractLocalMarkdownExportTiming: vi.fn(),
  isProviderConnectionField: (key: string) => /_(base_url|model|api_key)$/i.test(key),
}));

vi.mock('../../utils/settingsSchemas.js', () => ({
  GENERAL_SETTINGS_SCHEMA: [],
}));

vi.mock('../generalSettings/settingsForm.js', () => ({
  collectProviderPrioritySlots: vi.fn().mockReturnValue(['gemini']),
}));

vi.mock('../settings/fieldValidation.js', () => ({
  clearAllFieldErrors: vi.fn(),
  validateAllFields: vi.fn().mockReturnValue(true),
  validateObsidianHost: vi.fn().mockReturnValue(true),
  validateGeminiApiVersion: vi.fn().mockReturnValue(true),
  ErrorPair: class {},
}));

vi.mock('../../utils/i18n.js', () => ({
  getMessage: vi.fn((key: string) => key),
}));

vi.mock('../utils/confirmDialog.js', () => ({
  showConfirmDialog: vi.fn().mockResolvedValue(true),
}));

import { saveDashboardSettings, GENERAL_SETTINGS_VALIDATION_FIELDS } from '../settingsPipeline.js';
import { settingsRepository } from '../../utils/storage/SettingsRepository.js';
import * as formBinding from '../../utils/settingsFormBinding.js';
import * as fieldValidation from '../settings/fieldValidation.js';
import { showConfirmDialog } from '../utils/confirmDialog.js';

const mockGetSettings = vi.mocked(settingsRepository.getAll);
const mockSaveSettings = vi.mocked(settingsRepository.setAll);
const mockExtract = vi.mocked(formBinding.extractSettingsFromInputs);
const mockExtractTiming = vi.mocked(formBinding.extractLocalMarkdownExportTiming);
const mockValidateAll = vi.mocked(fieldValidation.validateAllFields);
const mockValidateObsidianHost = vi.mocked(fieldValidation.validateObsidianHost);
const mockValidateGemini = vi.mocked(fieldValidation.validateGeminiApiVersion);
const mockConfirm = vi.mocked(showConfirmDialog);

function setupInputs(protocol = 'https', obsidianHost = '127.0.0.1', geminiVersion = 'v1beta') {
  document.body.innerHTML = `
    <input id="protocol" value="${protocol}" />
    <input id="port" value="27123" />
    <input id="obsidianHost" value="${obsidianHost}" />
    <input id="geminiApiVersion" value="${geminiVersion}" />
    <input id="minVisitDuration" value="5" />
    <input id="minScrollDepth" value="50" />
    <input id="maxTokensPerPrompt" value="1000" />
  `;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSettings.mockResolvedValue({ existing: 'value' });
  mockSaveSettings.mockResolvedValue(undefined);
  mockExtract.mockReturnValue({});
  mockExtractTiming.mockReturnValue(undefined);
});

describe('saveDashboardSettings', () => {
  it('returns success with defaults', async () => {
    setupInputs('https');
    mockExtract.mockReturnValue({
      sqlite_retention_days: '7',
      sqlite_max_records: '1000',
      content_retention_days: '30',
      content_max_records: '500',
    });

    const result = await saveDashboardSettings();

    expect(result.success).toBe(true);
    expect(mockSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        existing: 'value',
        ai_provider_priority_list: ['gemini'],
        sqlite_retention_days: 7,
        sqlite_max_records: 1000,
        content_retention_days: 30,
        content_max_records: 500,
      }),
    );
  });

  it('does not blank a stored provider connection field with an empty extracted value', async () => {
    setupInputs('https');
    mockGetSettings.mockResolvedValue({
      openai_base_url: 'https://api.ai.sakura.ad.jp/v1',
      openai_model: 'preview/gemma-4-31B-it',
      openai_api_key: { iv: 'x', ciphertext: 'y' },
      openai_2_base_url: '',
    });
    // A broken form yields empty strings for provider fields.
    mockExtract.mockReturnValue({
      openai_base_url: '',
      openai_model: '',
      openai_api_key: '',
      openai_2_base_url: '',
      openai_2_model: 'llama-3',
    });

    await saveDashboardSettings();

    const saved = mockSaveSettings.mock.calls[0][0] as Record<string, unknown>;
    // Stored non-empty values are preserved
    expect(saved.openai_base_url).toBe('https://api.ai.sakura.ad.jp/v1');
    expect(saved.openai_model).toBe('preview/gemma-4-31B-it');
    expect(saved.openai_api_key).toEqual({ iv: 'x', ciphertext: 'y' });
    // A genuinely new non-empty value is still written
    expect(saved.openai_2_model).toBe('llama-3');
    // Empty over empty is harmless
    expect(saved.openai_2_base_url).toBe('');
  });

  it('calls onSuccess callback when provided', async () => {
    setupInputs('https');
    const onSuccess = vi.fn();
    const result = await saveDashboardSettings({ onSuccess });
    expect(result.success).toBe(true);
    expect(onSuccess).toHaveBeenCalled();
  });

  it('uses custom formSelector and passes extraValidationPairs', async () => {
    setupInputs('https');
    const extraPairs: fieldValidation.ErrorPair[] = [
      [null, 'extraError'],
    ];
    mockExtract.mockReturnValue({});
    await saveDashboardSettings({ formSelector: '#custom-form', extraValidationPairs: extraPairs });
    expect(fieldValidation.clearAllFieldErrors).toHaveBeenCalledWith(
      expect.arrayContaining(extraPairs),
    );
  });

  it('returns validation_failed when validateAllFields returns false', async () => {
    setupInputs('https');
    mockValidateAll.mockReturnValueOnce(false);
    const result = await saveDashboardSettings();
    expect(result.success).toBe(false);
    expect(result.error).toBe('validation_failed');
  });

  it('returns invalid_obsidian_host when obsidian host is invalid', async () => {
    setupInputs('https', 'bad host');
    mockValidateObsidianHost.mockReturnValueOnce(false);
    const result = await saveDashboardSettings();
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_obsidian_host');
  });

  it('returns invalid_gemini_api_version when gemini version is invalid', async () => {
    setupInputs('https', '127.0.0.1', 'bad');
    mockValidateGemini.mockReturnValueOnce(false);
    const result = await saveDashboardSettings();
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_gemini_api_version');
  });

  it('returns http_confirm_cancelled when user cancels http protocol', async () => {
    setupInputs('http');
    mockConfirm.mockResolvedValueOnce(false);
    const result = await saveDashboardSettings();
    expect(result.success).toBe(false);
    expect(result.error).toBe('http_confirm_cancelled');
  });

  it('proceeds when http protocol is confirmed', async () => {
    setupInputs('http');
    mockConfirm.mockResolvedValueOnce(true);
    const result = await saveDashboardSettings();
    expect(result.success).toBe(true);
  });

  it('skips timing extraction when includeTiming is false', async () => {
    setupInputs('https');
    await saveDashboardSettings({ includeTiming: false });
    expect(mockExtractTiming).not.toHaveBeenCalled();
  });

  it('includes timing when extractLocalMarkdownExportTiming returns a value', async () => {
    setupInputs('https');
    mockExtractTiming.mockReturnValueOnce('on_save');
    await saveDashboardSettings();
    expect(mockSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ local_markdown_export_timing: 'on_save' }),
    );
  });

  it('converts empty string and undefined retention values to null', async () => {
    setupInputs('https');
    mockExtract.mockReturnValue({
      sqlite_retention_days: '',
      sqlite_max_records: undefined,
      content_retention_days: '30',
      content_max_records: '',
    });
    await saveDashboardSettings();
    expect(mockSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        sqlite_retention_days: null,
        sqlite_max_records: null,
        content_retention_days: 30,
        content_max_records: null,
      }),
    );
  });

  it('converts numeric string retention values to numbers', async () => {
    setupInputs('https');
    mockExtract.mockReturnValue({
      sqlite_retention_days: '14',
      sqlite_max_records: '2000',
      content_retention_days: '60',
      content_max_records: '1000',
    });
    await saveDashboardSettings();
    expect(mockSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        sqlite_retention_days: 14,
        sqlite_max_records: 2000,
        content_retention_days: 60,
        content_max_records: 1000,
      }),
    );
  });

  it('handles missing DOM elements gracefully (null inputs)', async () => {
    document.body.innerHTML = '';
    mockValidateAll.mockReturnValueOnce(true);
    mockExtract.mockReturnValue({});
    const result = await saveDashboardSettings();
    expect(result.success).toBe(true);
  });
});

describe('GENERAL_SETTINGS_VALIDATION_FIELDS', () => {
  it('contains 7 entries', () => {
    expect(GENERAL_SETTINGS_VALIDATION_FIELDS).toHaveLength(7);
  });
});
