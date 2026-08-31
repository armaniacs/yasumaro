// @vitest-environment jsdom
/**
 * aiSummaryCleansingSettingsV2-coverage.test.ts
 *
 * Targeted branch-coverage tests for aiSummaryCleansingSettingsV2.ts.
 * Focuses on branches not already exercised by the existing test suite.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual };
});

const { mockGetSettingsHoisted, mockSaveSettingsHoisted } = vi.hoisted(() => ({
  mockGetSettingsHoisted: vi.fn(),
  mockSaveSettingsHoisted: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../../utils/storage.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getSettings: mockGetSettingsHoisted,
    saveSettings: mockSaveSettingsHoisted,
  };
});

vi.mock('../../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: mockGetSettingsHoisted,
      setAll: mockSaveSettingsHoisted,
      getMany: mockGetSettingsHoisted,
      clearCache: vi.fn(),
    },
    SettingsRepository: class {
      getAll = mockGetSettingsHoisted;
      setAll = mockSaveSettingsHoisted;
      getMany = mockGetSettingsHoisted;
      clearCache = vi.fn();
    },
  };
});

vi.mock('../../../utils/logger.js', () => ({
  logError: vi.fn(),
  ErrorCode: { STORAGE_WRITE_FAILURE: 'STRG_WR_001', INTERNAL_ERROR: 'INT_001' },
}));

import { CLEANSING_RULES } from '../../../utils/aiSummaryCleaner/rules.js';
import * as storageSettings from '../../../utils/storage.js';
import { logError } from '../../../utils/logger.js';
import {
  getAiSummaryCleansingSettings,
  saveAiSummaryCleansingSettings,
  applyAiSummaryCleansingSettingsToUI,
  getAiSummaryCleansingSettingsFromUI,
  updateAiSummaryCleansingCheckboxStates,
  setupAiSummaryCleansingEventListeners,
  type AiSummaryCleansingSettings,
} from '../aiSummaryCleansingSettingsV2.js';

const mockGetSettings = vi.mocked(storageSettings.getSettings);
const mockSaveSettings = vi.mocked(storageSettings.saveSettings);

function createAllRuleCheckboxes(): string[] {
  return CLEANSING_RULES.map(rule => {
    const id = `ai-summary-cleansing-${rule.key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`;
    return `<input type="checkbox" id="${id}">`;
  });
}

function createFullCleansingDom(): void {
  document.body.innerHTML = [
    '<input type="checkbox" id="ai-summary-cleansing-enabled">',
    ...createAllRuleCheckboxes(),
    '<input type="checkbox" id="whitelist-extraction-enabled">',
    '<input type="checkbox" id="ai-summary-cleansing-body-protection-enabled">',
    '<input type="checkbox" id="popup-body-protection-enabled">',
    '<input type="range" id="ai-summary-cleansing-body-protection-threshold" min="0" max="500">',
    '<span id="ai-summary-cleansing-body-protection-threshold-value"></span>',
    '<input type="range" id="popup-body-protection-threshold" min="0" max="500">',
    '<span id="popup-body-protection-threshold-value"></span>',
    '<input type="range" id="ai-summary-cleansing-link-ratio-threshold" min="0" max="100">',
    '<span id="link-ratio-threshold-value"></span>',
    '<input type="range" id="ai-summary-cleansing-short-text-threshold" min="0" max="500">',
    '<span id="short-text-threshold-value"></span>',
    '<input type="range" id="ai-summary-cleansing-short-seq-count" min="0" max="100">',
    '<span id="short-seq-count-value"></span>',
    '<input type="range" id="ai-summary-cleansing-link-para-threshold" min="0" max="100">',
    '<span id="link-para-threshold-value"></span>',
    '<input type="range" id="ai-summary-cleansing-fallback-ratio" min="0" max="100">',
    '<span id="ai-summary-cleansing-fallback-ratio-value"></span>',
    '<input type="range" id="ai-summary-cleansing-fallback-min-bytes" min="0" max="5000">',
    '<span id="ai-summary-cleansing-fallback-min-bytes-value"></span>',
    '<fieldset id="aiSummaryCleansingFieldset"></fieldset>',
    '<div id="aiSummaryCleansingSubGroup"></div>',
    '<button id="saveAiSummaryCleansingSettings"></button>',
    '<div id="aiSummaryCleansingSettingsStatus"></div>',
  ].join('\n');
}

function createPartialCleansingDomMissingOptional(): void {
  // omits optional elements to drive null branches in apply* and update*
  document.body.innerHTML = [
    '<input type="checkbox" id="ai-summary-cleansing-enabled">',
    ...createAllRuleCheckboxes(),
    // whitelist-extraction-enabled omitted
    '<input type="checkbox" id="ai-summary-cleansing-body-protection-enabled">',
    // popup-body-protection-enabled omitted
    '<input type="range" id="ai-summary-cleansing-body-protection-threshold" min="0" max="500">',
    // ai-summary-cleansing-body-protection-threshold-value omitted
    '<input type="range" id="ai-summary-cleansing-link-ratio-threshold" min="0" max="100">',
    // link-ratio-threshold-value omitted
    '<input type="range" id="ai-summary-cleansing-short-text-threshold" min="0" max="500">',
    // short-text-threshold-value omitted
    '<input type="range" id="ai-summary-cleansing-short-seq-count" min="0" max="100">',
    // short-seq-count-value omitted
    '<input type="range" id="ai-summary-cleansing-link-para-threshold" min="0" max="100">',
    // link-para-threshold-value omitted
    // fallback sliders & values omitted
    '<fieldset id="aiSummaryCleansingFieldset"></fieldset>',
    // aiSummaryCleansingSubGroup omitted
    '<button id="saveAiSummaryCleansingSettings"></button>',
    '<div id="aiSummaryCleansingSettingsStatus"></div>',
  ].join('\n');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSettings.mockResolvedValue({});
  mockSaveSettings.mockResolvedValue(undefined as never);
  vi.stubGlobal('chrome', {
    ...chrome,
    i18n: {
      getMessage: vi.fn((key: string) => {
        const msgs: Record<string, string> = {
          settingsSaved: 'Settings saved',
          settingsSaveError: 'Failed to save settings',
        };
        return msgs[key] || key;
      }),
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// ──────────────────────────────────────────────
// getAiSummaryCleansingSettings — uncovered defaults
// ──────────────────────────────────────────────
describe('getAiSummaryCleansingSettings — defaults', () => {
  it('defaults whitelistExtractionEnabled, fallbackRatio and fallbackMinBytes when absent', async () => {
    mockGetSettings.mockResolvedValueOnce({} as never);
    const s = await getAiSummaryCleansingSettings();
    expect(s.whitelistExtractionEnabled).toBe(true);
    expect(s.fallbackRatio).toBe(0.20);
    expect(s.fallbackMinBytes).toBe(300);
  });

  it('reads stored whitelistExtractionEnabled, fallbackRatio and fallbackMinBytes', async () => {
    mockGetSettings.mockResolvedValueOnce({
      whitelist_extraction_enabled: false,
      ai_summary_cleansing_fallback_ratio: 0.5,
      ai_summary_cleansing_fallback_min_bytes: 1000,
    } as never);
    const s = await getAiSummaryCleansingSettings();
    expect(s.whitelistExtractionEnabled).toBe(false);
    expect(s.fallbackRatio).toBe(0.5);
    expect(s.fallbackMinBytes).toBe(1000);
  });
});

// ──────────────────────────────────────────────
// saveAiSummaryCleansingSettings — missing rule flags branch
// ──────────────────────────────────────────────
describe('saveAiSummaryCleansingSettings — partial settings', () => {
  it('falls back to false for rule flags omitted from the settings object', async () => {
    mockGetSettings.mockResolvedValueOnce({} as never);
    // Only altEnabled is provided; every other rule flag is undefined
    const partial = {
      enabled: true,
      altEnabled: true,
      linkRatioThreshold: 70,
      shortTextThreshold: 30,
      shortSeqCount: 5,
      linkParaThreshold: 50,
      whitelistExtractionEnabled: true,
      bodyProtectionEnabled: true,
      bodyProtectionThreshold: 200,
      fallbackRatio: 0.2,
      fallbackMinBytes: 300,
    } as unknown as AiSummaryCleansingSettings;

    await saveAiSummaryCleansingSettings(partial);

    const saved = mockSaveSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.ai_summary_cleansing_alt).toBe(true);
    // Any rule not present in partialSettings should have been saved as false
    expect(saved.ai_summary_cleansing_metadata).toBe(false);
    expect(saved.ai_summary_cleansing_ads).toBe(false);
  });
});

// ──────────────────────────────────────────────
// applyAiSummaryCleansingSettingsToUI — missing optional elements
// ──────────────────────────────────────────────
describe('applyAiSummaryCleansingSettingsToUI — missing optional elements', () => {
  it('does not throw when optional elements are absent', () => {
    createPartialCleansingDomMissingOptional();
    expect(() =>
      applyAiSummaryCleansingSettingsToUI({
        enabled: true,
        linkRatioThreshold: 70,
        shortTextThreshold: 30,
        shortSeqCount: 5,
        linkParaThreshold: 50,
        whitelistExtractionEnabled: true,
        bodyProtectionEnabled: true,
        bodyProtectionThreshold: 200,
        fallbackRatio: 0.2,
        fallbackMinBytes: 300,
      } as unknown as AiSummaryCleansingSettings),
    ).not.toThrow();
  });
});

// ──────────────────────────────────────────────
// getAiSummaryCleansingSettingsFromUI — missing inputs
// ──────────────────────────────────────────────
describe('getAiSummaryCleansingSettingsFromUI — missing inputs', () => {
  it('falls back to defaults when all UI elements are missing', () => {
    document.body.innerHTML = '';
    const s = getAiSummaryCleansingSettingsFromUI();
    expect(s.enabled).toBe(true);
    expect(s.linkRatioThreshold).toBe(70);
    expect(s.shortTextThreshold).toBe(30);
    expect(s.shortSeqCount).toBe(5);
    expect(s.linkParaThreshold).toBe(50);
    expect(s.whitelistExtractionEnabled).toBe(true);
    expect(s.bodyProtectionEnabled).toBe(true);
    expect(s.bodyProtectionThreshold).toBe(200);
    expect(s.fallbackRatio).toBe(0.2);
    expect(s.fallbackMinBytes).toBe(300);
  });
});

// ──────────────────────────────────────────────
// updateAiSummaryCleansingCheckboxStates — missing elements
// ──────────────────────────────────────────────
describe('updateAiSummaryCleansingCheckboxStates — missing elements', () => {
  it('does not throw when all elements are missing', () => {
    document.body.innerHTML = '';
    expect(() => updateAiSummaryCleansingCheckboxStates(true)).not.toThrow();
    expect(() => updateAiSummaryCleansingCheckboxStates(false)).not.toThrow();
  });
});

// ──────────────────────────────────────────────
// setupAiSummaryCleansingEventListeners — uncovered branches
// ──────────────────────────────────────────────
describe('setupAiSummaryCleansingEventListeners — uncovered branches', () => {
  it('handles missing enabledCheckbox', () => {
    createFullCleansingDom();
    document.getElementById('ai-summary-cleansing-enabled')?.remove();
    expect(() => setupAiSummaryCleansingEventListeners()).not.toThrow();
  });

  it('handles missing saveButton', () => {
    createFullCleansingDom();
    document.getElementById('saveAiSummaryCleansingSettings')?.remove();
    expect(() => setupAiSummaryCleansingEventListeners()).not.toThrow();
  });

  it('logs error and does not throw when save fails and status element is missing', async () => {
    createFullCleansingDom();
    document.getElementById('aiSummaryCleansingSettingsStatus')?.remove();
    mockSaveSettings.mockRejectedValueOnce(new Error('fail'));
    setupAiSummaryCleansingEventListeners();
    const btn = document.getElementById('saveAiSummaryCleansingSettings') as HTMLButtonElement;
    btn.click();
    await vi.waitFor(() => expect(logError).toHaveBeenCalled());
  });

  it('handles range input when valElem is missing', () => {
    createFullCleansingDom();
    document.getElementById('link-ratio-threshold-value')?.remove();
    document.getElementById('short-text-threshold-value')?.remove();
    document.getElementById('short-seq-count-value')?.remove();
    document.getElementById('link-para-threshold-value')?.remove();
    document.getElementById('ai-summary-cleansing-body-protection-threshold-value')?.remove();
    document.getElementById('popup-body-protection-threshold-value')?.remove();
    setupAiSummaryCleansingEventListeners();
    const slider = document.getElementById('ai-summary-cleansing-link-ratio-threshold') as HTMLInputElement;
    slider.value = '90';
    expect(() => slider.dispatchEvent(new Event('input'))).not.toThrow();
  });

  it('handles missing body-protection checkboxes and still saves on rule change', async () => {
    createFullCleansingDom();
    document.getElementById('ai-summary-cleansing-body-protection-enabled')?.remove();
    document.getElementById('popup-body-protection-enabled')?.remove();
    setupAiSummaryCleansingEventListeners();
    const cb = document.getElementById('ai-summary-cleansing-alt') as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(mockSaveSettings).toHaveBeenCalled());
  });
});
