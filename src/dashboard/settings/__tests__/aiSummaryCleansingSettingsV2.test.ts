// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetSettings = vi.hoisted(() => vi.fn());
const mockSaveSettings = vi.hoisted(() => vi.fn());
const mockLogError = vi.hoisted(() => vi.fn());

vi.mock('../../../utils/storage.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, getSettings: mockGetSettings, saveSettings: mockSaveSettings };
});
vi.mock('../../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: mockGetSettings,
      setAll: mockSaveSettings,
      getMany: mockGetSettings,
      clearCache: vi.fn(),
    },
    SettingsRepository: class {
      getAll = mockGetSettings;
      setAll = mockSaveSettings;
      getMany = mockGetSettings;
      clearCache = vi.fn();
    },
  };
});
vi.mock('../../../utils/logger.js', () => ({
  logError: mockLogError,
  ErrorCode: { STORAGE_WRITE_FAILURE: 'STORAGE_WRITE_FAILURE' },
}));

// Keep real StorageKeys, CLEANSING_RULES, and other utils
import {
  getAiSummaryCleansingSettings,
  saveAiSummaryCleansingSettings,
  applyAiSummaryCleansingSettingsToUI,
  getAiSummaryCleansingSettingsFromUI,
  updateAiSummaryCleansingCheckboxStates,
  setupAiSummaryCleansingEventListeners,
  type AiSummaryCleansingSettings,
} from '../aiSummaryCleansingSettingsV2.js';
import { CLEANSING_RULES } from '../../../utils/aiSummaryCleaner/rules.js';
import { StorageKeys } from '../../../utils/storage/types.js';

function makeFullSettings(overrides: Partial<AiSummaryCleansingSettings> = {}): AiSummaryCleansingSettings {
  const ruleFlags = Object.fromEntries(
    CLEANSING_RULES.map((r) => [`${r.key}Enabled`, r.defaultEnabled]),
  );
  return {
    enabled: true,
    ...ruleFlags,
    linkRatioThreshold: 70,
    shortTextThreshold: 30,
    shortSeqCount: 5,
    linkParaThreshold: 50,
    whitelistExtractionEnabled: true,
    bodyProtectionEnabled: true,
    bodyProtectionThreshold: 200,
    fallbackRatio: 0.2,
    fallbackMinBytes: 300,
    ...overrides,
  } as unknown as AiSummaryCleansingSettings;
}

function ruleHtmlId(key: string): string {
  return `ai-summary-cleansing-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

function createFullDom(includeSubGroup = true): void {
  const ruleCheckboxes = CLEANSING_RULES.map((r) => `<input type="checkbox" id="${ruleHtmlId(r.key)}">`).join('');
  document.body.innerHTML = `
    <input type="checkbox" id="ai-summary-cleansing-enabled">
    ${ruleCheckboxes}
    <input type="checkbox" id="whitelist-extraction-enabled">
    <input type="checkbox" id="ai-summary-cleansing-body-protection-enabled">
    <input type="range" id="ai-summary-cleansing-body-protection-threshold" min="0" max="500">
    <span id="ai-summary-cleansing-body-protection-threshold-value"></span>
    <input type="checkbox" id="popup-body-protection-enabled">
    <input type="range" id="popup-body-protection-threshold" min="0" max="500">
    <span id="popup-body-protection-threshold-value"></span>
    <input type="range" id="ai-summary-cleansing-link-ratio-threshold" min="0" max="100">
    <span id="link-ratio-threshold-value"></span>
    <input type="range" id="ai-summary-cleansing-short-text-threshold" min="0" max="200">
    <span id="short-text-threshold-value"></span>
    <input type="range" id="ai-summary-cleansing-short-seq-count" min="0" max="20">
    <span id="short-seq-count-value"></span>
    <input type="range" id="ai-summary-cleansing-link-para-threshold" min="10" max="200">
    <span id="link-para-threshold-value"></span>
    <input type="range" id="ai-summary-cleansing-fallback-ratio" min="0" max="100">
    <span id="ai-summary-cleansing-fallback-ratio-value"></span>
    <input type="range" id="ai-summary-cleansing-fallback-min-bytes" min="0" max="5000">
    <span id="ai-summary-cleansing-fallback-min-bytes-value"></span>
    <fieldset id="aiSummaryCleansingFieldset"></fieldset>
    ${includeSubGroup ? '<div id="aiSummaryCleansingSubGroup"></div>' : ''}
    <button id="saveAiSummaryCleansingSettings"></button>
    <div id="aiSummaryCleansingSettingsStatus"></div>
  `;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSettings.mockResolvedValue({});
  mockSaveSettings.mockResolvedValue(undefined as never);
  // reset chrome.i18n to vitest.setup default (backed by messages.json)
  // but ensure getMessage exists for fallback tests
  if (!(globalThis as unknown as Record<string, unknown>).chrome) {
    (globalThis as unknown as Record<string, unknown>).chrome = {};
  }
  const gChrome = globalThis.chrome as unknown as Record<string, unknown>;
  gChrome.i18n = {
    getMessage: vi.fn((key: string) => {
      const map: Record<string, string> = { settingsSaved: 'Settings saved', settingsSaveError: 'Save error' };
      return map[key] ?? key;
    }),
    getUILanguage: vi.fn(() => 'en'),
  } as unknown as typeof chrome.i18n;
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

// ── getAiSummaryCleansingSettings ──
describe('getAiSummaryCleansingSettings', () => {
  it('returns all defaults when storage empty', async () => {
    mockGetSettings.mockResolvedValueOnce({} as never);
    const s = await getAiSummaryCleansingSettings() as unknown as Record<string, unknown>;
    expect(s['enabled']).toBe(true);
    expect(s['linkRatioThreshold']).toBe(70);
    expect(s['shortTextThreshold']).toBe(30);
    expect(s['shortSeqCount']).toBe(5);
    expect(s['linkParaThreshold']).toBe(50);
    expect(s['whitelistExtractionEnabled']).toBe(true);
    expect(s['bodyProtectionEnabled']).toBe(true);
    expect(s['bodyProtectionThreshold']).toBe(200);
    expect(s['fallbackRatio']).toBe(0.2);
    expect(s['fallbackMinBytes']).toBe(300);
    for (const rule of CLEANSING_RULES) {
      expect(s[`${rule.key}Enabled`]).toBe(rule.defaultEnabled);
    }
  });

  it('reads stored values overriding defaults including thresholds and fallbacks', async () => {
    mockGetSettings.mockResolvedValueOnce({
      [StorageKeys.AI_SUMMARY_CLEANSING_ENABLED]: false,
      [StorageKeys.AI_SUMMARY_CLEANSING_LINK_RATIO_THRESHOLD]: 80,
      [StorageKeys.AI_SUMMARY_CLEANSING_SHORT_TEXT_THRESHOLD]: 15,
      [StorageKeys.AI_SUMMARY_CLEANSING_SHORT_SEQ_COUNT]: 9,
      [StorageKeys.AI_SUMMARY_CLEANSING_LINK_PARA_THRESHOLD]: 60,
      [StorageKeys.WHITELIST_EXTRACTION_ENABLED]: false,
      [StorageKeys.AI_SUMMARY_CLEANSING_BODY_PROTECTION_ENABLED]: false,
      [StorageKeys.AI_SUMMARY_CLEANSING_BODY_PROTECTION_THRESHOLD]: 123,
      [StorageKeys.AI_SUMMARY_CLEANSING_FALLBACK_RATIO]: 0.5,
      [StorageKeys.AI_SUMMARY_CLEANSING_FALLBACK_MIN_BYTES]: 999,
      [StorageKeys.AI_SUMMARY_CLEANSING_ALT]: false,
      [StorageKeys.AI_SUMMARY_CLEANSING_AFFILIATE]: true,
      [StorageKeys.AI_SUMMARY_CLEANSING_VIDEO_SITE]: true,
    } as never);
    const s = await getAiSummaryCleansingSettings();
    expect(s.enabled).toBe(false);
    expect(s.linkRatioThreshold).toBe(80);
    expect(s.shortTextThreshold).toBe(15);
    expect(s.shortSeqCount).toBe(9);
    expect(s.linkParaThreshold).toBe(60);
    expect(s.whitelistExtractionEnabled).toBe(false);
    expect(s.bodyProtectionEnabled).toBe(false);
    expect(s.bodyProtectionThreshold).toBe(123);
    expect(s.fallbackRatio).toBe(0.5);
    expect(s.fallbackMinBytes).toBe(999);
    // rule flag overridden
    expect((s as unknown as Record<string, boolean>).altEnabled).toBe(false);
    expect((s as unknown as Record<string, boolean>).affiliateEnabled).toBe(true);
    expect((s as unknown as Record<string, boolean>).videoSiteEnabled).toBe(true);
  });

  it('fallback for affiliate/newsMedia/ecSite/qaSite/videoSite uses defaultEnabled', async () => {
    mockGetSettings.mockResolvedValueOnce({} as never);
    const s = await getAiSummaryCleansingSettings() as unknown as Record<string, boolean>;
    const lookup = Object.fromEntries(CLEANSING_RULES.map((r) => [r.key, r.defaultEnabled]));
    expect(s['affiliateEnabled']).toBe(lookup['affiliate']);
    expect(s['newsMediaEnabled']).toBe(lookup['newsMedia']);
    expect(s['ecSiteEnabled']).toBe(lookup['ecSite']);
    expect(s['qaSiteEnabled']).toBe(lookup['qaSite']);
    expect(s['videoSiteEnabled']).toBe(lookup['videoSite']);
  });
});

// ── saveAiSummaryCleansingSettings ──
describe('saveAiSummaryCleansingSettings', () => {
  it('saves all rule flags and falls back to false when flag missing', async () => {
    mockGetSettings.mockResolvedValueOnce({ keep: 'yes' } as never);
    const partial = { enabled: false, linkRatioThreshold: 77, shortTextThreshold: 11, shortSeqCount: 2, linkParaThreshold: 33, whitelistExtractionEnabled: false, bodyProtectionEnabled: false, bodyProtectionThreshold: 111, fallbackRatio: 0.33, fallbackMinBytes: 321 } as unknown as AiSummaryCleansingSettings;
    // leave all rule flags undefined to hit ?? false
    await saveAiSummaryCleansingSettings(partial);
    const saved = mockSaveSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(saved.keep).toBe('yes');
    expect(saved[StorageKeys.AI_SUMMARY_CLEANSING_ENABLED]).toBe(false);
    for (const rule of CLEANSING_RULES) {
      expect(saved[rule.storageKey]).toBe(false);
    }
  });

  it('saves true rule flags when provided', async () => {
    mockGetSettings.mockResolvedValueOnce({} as never);
    const full = makeFullSettings({ altEnabled: true } as Partial<AiSummaryCleansingSettings>);
    // ensure one rule true
    (full as unknown as Record<string, boolean>).altEnabled = true;
    await saveAiSummaryCleansingSettings(full);
    const saved = mockSaveSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(saved[StorageKeys.AI_SUMMARY_CLEANSING_ALT]).toBe(true);
  });

  it('saves numeric thresholds and whitelist/body/fallback fields', async () => {
    mockGetSettings.mockResolvedValueOnce({} as never);
    const s = makeFullSettings({ linkRatioThreshold: 88, shortTextThreshold: 22, shortSeqCount: 7, linkParaThreshold: 66, whitelistExtractionEnabled: false, bodyProtectionEnabled: false, bodyProtectionThreshold: 150, fallbackRatio: 0.15, fallbackMinBytes: 450 });
    await saveAiSummaryCleansingSettings(s);
    const saved = mockSaveSettings.mock.calls[0][0] as Record<string, unknown>;
    expect(saved[StorageKeys.AI_SUMMARY_CLEANSING_LINK_RATIO_THRESHOLD]).toBe(88);
    expect(saved[StorageKeys.AI_SUMMARY_CLEANSING_SHORT_TEXT_THRESHOLD]).toBe(22);
    expect(saved[StorageKeys.AI_SUMMARY_CLEANSING_SHORT_SEQ_COUNT]).toBe(7);
    expect(saved[StorageKeys.AI_SUMMARY_CLEANSING_LINK_PARA_THRESHOLD]).toBe(66);
    expect(saved[StorageKeys.WHITELIST_EXTRACTION_ENABLED]).toBe(false);
    expect(saved[StorageKeys.AI_SUMMARY_CLEANSING_BODY_PROTECTION_ENABLED]).toBe(false);
    expect(saved[StorageKeys.AI_SUMMARY_CLEANSING_BODY_PROTECTION_THRESHOLD]).toBe(150);
    expect(saved[StorageKeys.AI_SUMMARY_CLEANSING_FALLBACK_RATIO]).toBe(0.15);
    expect(saved[StorageKeys.AI_SUMMARY_CLEANSING_FALLBACK_MIN_BYTES]).toBe(450);
  });
});

// ── applyAiSummaryCleansingSettingsToUI ──
describe('applyAiSummaryCleansingSettingsToUI', () => {
  it('applies enabled and rule checkbox states with full DOM', () => {
    createFullDom();
    const s = makeFullSettings({ enabled: true });
    (s as unknown as Record<string, boolean>).altEnabled = false;
    (s as unknown as Record<string, boolean>).deepEnabled = true;
    applyAiSummaryCleansingSettingsToUI(s);
    expect((document.getElementById('ai-summary-cleansing-enabled') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById(ruleHtmlId('alt')) as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById(ruleHtmlId('deep')) as HTMLInputElement).checked).toBe(true);
  });

  it('handles missing rule checkbox gracefully', () => {
    createFullDom();
    document.getElementById(ruleHtmlId('alt'))!.remove();
    const s = makeFullSettings();
    expect(() => applyAiSummaryCleansingSettingsToUI(s)).not.toThrow();
  });

  it('sets whitelist and body protection checkboxes', () => {
    createFullDom();
    const s = makeFullSettings({ whitelistExtractionEnabled: false, bodyProtectionEnabled: false });
    applyAiSummaryCleansingSettingsToUI(s);
    expect((document.getElementById('whitelist-extraction-enabled') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('ai-summary-cleansing-body-protection-enabled') as HTMLInputElement).checked).toBe(false);
  });

  it('sets body protection slider and value when present', () => {
    createFullDom();
    const s = makeFullSettings({ bodyProtectionThreshold: 175 });
    applyAiSummaryCleansingSettingsToUI(s);
    expect((document.getElementById('ai-summary-cleansing-body-protection-threshold') as HTMLInputElement).value).toBe('175');
    expect(document.getElementById('ai-summary-cleansing-body-protection-threshold-value')!.textContent).toBe('175');
  });

  it('handles body protection slider present but value span missing', () => {
    createFullDom();
    document.getElementById('ai-summary-cleansing-body-protection-threshold-value')!.remove();
    const s = makeFullSettings({ bodyProtectionThreshold: 180 });
    expect(() => applyAiSummaryCleansingSettingsToUI(s)).not.toThrow();
    expect((document.getElementById('ai-summary-cleansing-body-protection-threshold') as HTMLInputElement).value).toBe('180');
  });

  it('handles popup body protection elements', () => {
    createFullDom();
    const s = makeFullSettings({ bodyProtectionEnabled: true, bodyProtectionThreshold: 210 });
    applyAiSummaryCleansingSettingsToUI(s);
    expect((document.getElementById('popup-body-protection-enabled') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('popup-body-protection-threshold') as HTMLInputElement).value).toBe('210');
    expect(document.getElementById('popup-body-protection-threshold-value')!.textContent).toBe('210');
  });

  it('handles popup threshold value missing', () => {
    createFullDom();
    document.getElementById('popup-body-protection-threshold-value')!.remove();
    expect(() => applyAiSummaryCleansingSettingsToUI(makeFullSettings())).not.toThrow();
  });

  it('sets linkRatio threshold and handles missing valElem', () => {
    createFullDom();
    applyAiSummaryCleansingSettingsToUI(makeFullSettings({ linkRatioThreshold: 85 }));
    expect((document.getElementById('ai-summary-cleansing-link-ratio-threshold') as HTMLInputElement).value).toBe('85');
    expect(document.getElementById('link-ratio-threshold-value')!.textContent).toBe('85');
    // missing value element
    createFullDom();
    document.getElementById('link-ratio-threshold-value')!.remove();
    expect(() => applyAiSummaryCleansingSettingsToUI(makeFullSettings({ linkRatioThreshold: 85 }))).not.toThrow();
  });

  it('sets shortText, shortSeq, linkPara thresholds', () => {
    createFullDom();
    const s = makeFullSettings({ shortTextThreshold: 12, shortSeqCount: 9, linkParaThreshold: 77 });
    applyAiSummaryCleansingSettingsToUI(s);
    expect((document.getElementById('ai-summary-cleansing-short-text-threshold') as HTMLInputElement).value).toBe('12');
    expect(document.getElementById('short-text-threshold-value')!.textContent).toBe('12');
    expect((document.getElementById('ai-summary-cleansing-short-seq-count') as HTMLInputElement).value).toBe('9');
    expect(document.getElementById('short-seq-count-value')!.textContent).toBe('9');
    expect((document.getElementById('ai-summary-cleansing-link-para-threshold') as HTMLInputElement).value).toBe('77');
    expect(document.getElementById('link-para-threshold-value')!.textContent).toBe('77');
  });

  it('handles shortText value span missing', () => {
    createFullDom();
    document.getElementById('short-text-threshold-value')!.remove();
    expect(() => applyAiSummaryCleansingSettingsToUI(makeFullSettings())).not.toThrow();
  });

  it('handles shortSeq value span missing', () => {
    createFullDom();
    document.getElementById('short-seq-count-value')!.remove();
    expect(() => applyAiSummaryCleansingSettingsToUI(makeFullSettings())).not.toThrow();
  });

  it('handles linkPara value span missing', () => {
    createFullDom();
    document.getElementById('link-para-threshold-value')!.remove();
    expect(() => applyAiSummaryCleansingSettingsToUI(makeFullSettings())).not.toThrow();
  });

  it('sets fallback sliders and handles missing value spans', () => {
    createFullDom();
    applyAiSummaryCleansingSettingsToUI(makeFullSettings({ fallbackRatio: 0.35, fallbackMinBytes: 500 }));
    expect((document.getElementById('ai-summary-cleansing-fallback-ratio') as HTMLInputElement).value).toBe('35');
    expect(document.getElementById('ai-summary-cleansing-fallback-ratio-value')!.textContent).toBe('35');
    expect((document.getElementById('ai-summary-cleansing-fallback-min-bytes') as HTMLInputElement).value).toBe('500');
    expect(document.getElementById('ai-summary-cleansing-fallback-min-bytes-value')!.textContent).toBe('500');
  });

  it('handles fallback value spans missing', () => {
    createFullDom();
    document.getElementById('ai-summary-cleansing-fallback-ratio-value')!.remove();
    document.getElementById('ai-summary-cleansing-fallback-min-bytes-value')!.remove();
    expect(() => applyAiSummaryCleansingSettingsToUI(makeFullSettings())).not.toThrow();
  });

  it('handles fallback sliders missing', () => {
    createFullDom();
    document.getElementById('ai-summary-cleansing-fallback-ratio')!.remove();
    document.getElementById('ai-summary-cleansing-fallback-min-bytes')!.remove();
    expect(() => applyAiSummaryCleansingSettingsToUI(makeFullSettings())).not.toThrow();
  });

  it('updates subGroup display block vs none based on enabled', () => {
    createFullDom();
    applyAiSummaryCleansingSettingsToUI(makeFullSettings({ enabled: true }));
    expect(document.getElementById('aiSummaryCleansingSubGroup')!.style.display).toBe('block');
    applyAiSummaryCleansingSettingsToUI(makeFullSettings({ enabled: false }));
    expect(document.getElementById('aiSummaryCleansingSubGroup')!.style.display).toBe('none');
  });

  it('handles missing subGroup and missing threshold inputs', () => {
    createFullDom(false);
    document.getElementById('ai-summary-cleansing-link-ratio-threshold')!.remove();
    document.getElementById('ai-summary-cleansing-short-text-threshold')!.remove();
    document.getElementById('ai-summary-cleansing-short-seq-count')!.remove();
    document.getElementById('ai-summary-cleansing-link-para-threshold')!.remove();
    document.getElementById('ai-summary-cleansing-body-protection-threshold')!.remove();
    document.getElementById('popup-body-protection-threshold')!.remove();
    expect(() => applyAiSummaryCleansingSettingsToUI(makeFullSettings())).not.toThrow();
  });

  it('handles completely empty DOM', () => {
    document.body.innerHTML = '';
    expect(() => applyAiSummaryCleansingSettingsToUI(makeFullSettings())).not.toThrow();
  });

  it('handles missing enabledCheckbox', () => {
    createFullDom();
    document.getElementById('ai-summary-cleansing-enabled')!.remove();
    expect(() => applyAiSummaryCleansingSettingsToUI(makeFullSettings())).not.toThrow();
  });
});

// ── getAiSummaryCleansingSettingsFromUI ──
describe('getAiSummaryCleansingSettingsFromUI', () => {
  it('reads all values from DOM with full UI', () => {
    createFullDom();
    (document.getElementById('ai-summary-cleansing-enabled') as HTMLInputElement).checked = true;
    (document.getElementById(ruleHtmlId('alt')) as HTMLInputElement).checked = true;
    (document.getElementById('whitelist-extraction-enabled') as HTMLInputElement).checked = false;
    (document.getElementById('ai-summary-cleansing-body-protection-enabled') as HTMLInputElement).checked = false;
    (document.getElementById('ai-summary-cleansing-body-protection-threshold') as HTMLInputElement).value = '150';
    (document.getElementById('ai-summary-cleansing-link-ratio-threshold') as HTMLInputElement).value = '80';
    (document.getElementById('ai-summary-cleansing-short-text-threshold') as HTMLInputElement).value = '25';
    (document.getElementById('ai-summary-cleansing-short-seq-count') as HTMLInputElement).value = '7';
    (document.getElementById('ai-summary-cleansing-link-para-threshold') as HTMLInputElement).value = '55';
    (document.getElementById('ai-summary-cleansing-fallback-ratio') as HTMLInputElement).value = '25';
    (document.getElementById('ai-summary-cleansing-fallback-min-bytes') as HTMLInputElement).value = '400';

    const s = getAiSummaryCleansingSettingsFromUI();
    expect(s.enabled).toBe(true);
    expect((s as unknown as Record<string, boolean>).altEnabled).toBe(true);
    expect(s.whitelistExtractionEnabled).toBe(false);
    expect(s.bodyProtectionEnabled).toBe(false);
    expect(s.bodyProtectionThreshold).toBe(150);
    expect(s.linkRatioThreshold).toBe(80);
    expect(s.shortTextThreshold).toBe(25);
    expect(s.shortSeqCount).toBe(7);
    expect(s.linkParaThreshold).toBe(55);
    expect(s.fallbackRatio).toBe(0.25);
    expect(s.fallbackMinBytes).toBe(400);
  });

  it('returns defaults when DOM empty (all || fallbacks)', () => {
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
    // missing checkboxes fall back to newUserDefault
    for (const rule of CLEANSING_RULES) {
      expect((s as unknown as Record<string, boolean>)[`${rule.key}Enabled`]).toBe(rule.newUserDefault);
    }
  });

  it('falls back to newUserDefault when rule checkbox missing', () => {
    document.body.innerHTML = '<input type="checkbox" id="ai-summary-cleansing-enabled" checked>';
    const s = getAiSummaryCleansingSettingsFromUI() as unknown as Record<string, boolean>;
    for (const rule of CLEANSING_RULES) {
      expect(s[`${rule.key}Enabled`]).toBe(rule.newUserDefault);
    }
  });

  it('parses empty string values to defaults via || fallback', () => {
    // Remove inputs so getElementById returns null -> ?.value is undefined -> || '70' fallback
    createFullDom();
    document.getElementById('ai-summary-cleansing-link-ratio-threshold')!.remove();
    document.getElementById('ai-summary-cleansing-short-text-threshold')!.remove();
    document.getElementById('ai-summary-cleansing-short-seq-count')!.remove();
    document.getElementById('ai-summary-cleansing-link-para-threshold')!.remove();
    document.getElementById('ai-summary-cleansing-body-protection-threshold')!.remove();
    document.getElementById('ai-summary-cleansing-fallback-ratio')!.remove();
    document.getElementById('ai-summary-cleansing-fallback-min-bytes')!.remove();
    const s = getAiSummaryCleansingSettingsFromUI();
    expect(s.linkRatioThreshold).toBe(70);
    expect(s.shortTextThreshold).toBe(30);
    expect(s.shortSeqCount).toBe(5);
    expect(s.linkParaThreshold).toBe(50);
    expect(s.bodyProtectionThreshold).toBe(200);
    expect(s.fallbackRatio).toBe(0.2);
    expect(s.fallbackMinBytes).toBe(300);
  });

  it('handles enabled checkbox missing (enabled defaults to true)', () => {
    document.body.innerHTML = '';
    const s = getAiSummaryCleansingSettingsFromUI();
    expect(s.enabled).toBe(true);
  });

  it('handles whitelist and body protection checkboxes missing', () => {
    document.body.innerHTML = `<input type="checkbox" id="ai-summary-cleansing-enabled">`;
    const s = getAiSummaryCleansingSettingsFromUI();
    expect(s.whitelistExtractionEnabled).toBe(true);
    expect(s.bodyProtectionEnabled).toBe(true);
  });
});

// ── updateAiSummaryCleansingCheckboxStates ──
describe('updateAiSummaryCleansingCheckboxStates', () => {
  it('disables rule and whitelist checkboxes when enabled false', () => {
    createFullDom();
    updateAiSummaryCleansingCheckboxStates(false);
    for (const rule of CLEANSING_RULES) {
      expect((document.getElementById(ruleHtmlId(rule.key)) as HTMLInputElement).disabled).toBe(true);
    }
    expect((document.getElementById('whitelist-extraction-enabled') as HTMLInputElement).disabled).toBe(true);
  });

  it('enables rule and whitelist checkboxes when enabled true', () => {
    createFullDom();
    updateAiSummaryCleansingCheckboxStates(false);
    updateAiSummaryCleansingCheckboxStates(true);
    for (const rule of CLEANSING_RULES) {
      expect((document.getElementById(ruleHtmlId(rule.key)) as HTMLInputElement).disabled).toBe(false);
    }
    expect((document.getElementById('whitelist-extraction-enabled') as HTMLInputElement).disabled).toBe(false);
  });

  it('keeps body protection controls always enabled', () => {
    createFullDom();
    updateAiSummaryCleansingCheckboxStates(false);
    expect((document.getElementById('ai-summary-cleansing-body-protection-enabled') as HTMLInputElement).disabled).toBe(false);
    expect((document.getElementById('ai-summary-cleansing-body-protection-threshold') as HTMLInputElement).disabled).toBe(false);
    expect((document.getElementById('popup-body-protection-enabled') as HTMLInputElement).disabled).toBe(false);
    expect((document.getElementById('popup-body-protection-threshold') as HTMLInputElement).disabled).toBe(false);
    updateAiSummaryCleansingCheckboxStates(true);
    expect((document.getElementById('ai-summary-cleansing-body-protection-enabled') as HTMLInputElement).disabled).toBe(false);
  });

  it('does not throw when elements missing', () => {
    document.body.innerHTML = '';
    expect(() => updateAiSummaryCleansingCheckboxStates(true)).not.toThrow();
    expect(() => updateAiSummaryCleansingCheckboxStates(false)).not.toThrow();
  });

  it('handles missing whitelist checkbox', () => {
    createFullDom();
    document.getElementById('whitelist-extraction-enabled')!.remove();
    expect(() => updateAiSummaryCleansingCheckboxStates(false)).not.toThrow();
  });

  it('handles missing rule checkboxes partially', () => {
    createFullDom();
    document.getElementById(ruleHtmlId('alt'))!.remove();
    document.getElementById(ruleHtmlId('deep'))!.remove();
    expect(() => updateAiSummaryCleansingCheckboxStates(false)).not.toThrow();
    expect(() => updateAiSummaryCleansingCheckboxStates(true)).not.toThrow();
  });

  it('handles missing body protection elements', () => {
    createFullDom();
    document.getElementById('ai-summary-cleansing-body-protection-enabled')!.remove();
    document.getElementById('ai-summary-cleansing-body-protection-threshold')!.remove();
    document.getElementById('popup-body-protection-enabled')!.remove();
    document.getElementById('popup-body-protection-threshold')!.remove();
    expect(() => updateAiSummaryCleansingCheckboxStates(false)).not.toThrow();
  });
});

// ── setupAiSummaryCleansingEventListeners ──
describe('setupAiSummaryCleansingEventListeners', () => {
  it('does not throw when DOM empty (all elements missing)', () => {
    document.body.innerHTML = '';
    expect(() => setupAiSummaryCleansingEventListeners()).not.toThrow();
  });

  it('registers change listener on enabled checkbox and updates subGroup visibility', async () => {
    createFullDom();
    mockGetSettings.mockResolvedValue(makeFullSettings() as never);
    setupAiSummaryCleansingEventListeners();
    const cb = document.getElementById('ai-summary-cleansing-enabled') as HTMLInputElement;
    const subGroup = document.getElementById('aiSummaryCleansingSubGroup') as HTMLElement;
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    // allow async save to resolve
    await vi.waitFor(() => expect(mockSaveSettings).toHaveBeenCalled());
    expect(subGroup.style.display).toBe('none');
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(mockSaveSettings).toHaveBeenCalledTimes(2));
    expect(subGroup.style.display).toBe('block');
  });

  it('handles enabled checkbox change when subGroup missing', async () => {
    createFullDom(false);
    mockGetSettings.mockResolvedValue(makeFullSettings() as never);
    setupAiSummaryCleansingEventListeners();
    const cb = document.getElementById('ai-summary-cleansing-enabled') as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(mockSaveSettings).toHaveBeenCalled());
  });

  it('individual rule checkbox change triggers save', async () => {
    createFullDom();
    setupAiSummaryCleansingEventListeners();
    const cb = document.getElementById(ruleHtmlId('alt')) as HTMLInputElement;
    cb.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(mockSaveSettings).toHaveBeenCalled());
  });

  it('skips listener for missing rule checkboxes', () => {
    createFullDom();
    document.getElementById(ruleHtmlId('alt'))!.remove();
    expect(() => setupAiSummaryCleansingEventListeners()).not.toThrow();
  });

  it('whitelist checkbox change triggers save', async () => {
    createFullDom();
    setupAiSummaryCleansingEventListeners();
    const cb = document.getElementById('whitelist-extraction-enabled') as HTMLInputElement;
    cb.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(mockSaveSettings).toHaveBeenCalled());
  });

  it('body protection checkbox change triggers save', async () => {
    createFullDom();
    setupAiSummaryCleansingEventListeners();
    const cb = document.getElementById('ai-summary-cleansing-body-protection-enabled') as HTMLInputElement;
    cb.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(mockSaveSettings).toHaveBeenCalled());
  });

  it('popup body protection checkbox change triggers save', async () => {
    createFullDom();
    setupAiSummaryCleansingEventListeners();
    const cb = document.getElementById('popup-body-protection-enabled') as HTMLInputElement;
    cb.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(mockSaveSettings).toHaveBeenCalled());
  });

  it('range input event updates value display when valElem present', () => {
    createFullDom();
    setupAiSummaryCleansingEventListeners();
    const slider = document.getElementById('ai-summary-cleansing-link-ratio-threshold') as HTMLInputElement;
    const val = document.getElementById('link-ratio-threshold-value')!;
    slider.value = '92';
    slider.dispatchEvent(new Event('input'));
    expect(val.textContent).toBe('92');
  });

  it('range input event does nothing when valElem missing', () => {
    createFullDom();
    document.getElementById('link-ratio-threshold-value')!.remove();
    setupAiSummaryCleansingEventListeners();
    const slider = document.getElementById('ai-summary-cleansing-link-ratio-threshold') as HTMLInputElement;
    slider.value = '92';
    slider.dispatchEvent(new Event('input'));
    // no throw, no val update to check
  });

  it('range change event triggers save', async () => {
    createFullDom();
    setupAiSummaryCleansingEventListeners();
    const slider = document.getElementById('ai-summary-cleansing-link-ratio-threshold') as HTMLInputElement;
    slider.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(mockSaveSettings).toHaveBeenCalled());
  });

  it('handles range configs with missing inputs gracefully', () => {
    createFullDom();
    document.getElementById('ai-summary-cleansing-link-ratio-threshold')!.remove();
    document.getElementById('ai-summary-cleansing-body-protection-threshold')!.remove();
    document.getElementById('popup-body-protection-threshold')!.remove();
    expect(() => setupAiSummaryCleansingEventListeners()).not.toThrow();
  });

  it('save button success shows message and clears after 3s', async () => {
    vi.useFakeTimers();
    createFullDom();
    mockSaveSettings.mockResolvedValue(undefined as never);
    setupAiSummaryCleansingEventListeners();
    const btn = document.getElementById('saveAiSummaryCleansingSettings') as HTMLButtonElement;
    const status = document.getElementById('aiSummaryCleansingSettingsStatus') as HTMLElement;
    btn.click();
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(status.textContent).toBe('Settings saved'));
    expect(status.className).toContain('success');
    await vi.advanceTimersByTimeAsync(3000);
    expect(status.textContent).toBe('');
    expect(status.className).toBe('status-message');
  });

  it('save button shows fallback message when i18n returns empty', async () => {
    vi.useFakeTimers();
    createFullDom();
    (globalThis.chrome.i18n.getMessage as unknown as ReturnType<typeof vi.fn>).mockReturnValue('');
    mockSaveSettings.mockResolvedValue(undefined as never);
    setupAiSummaryCleansingEventListeners();
    const btn = document.getElementById('saveAiSummaryCleansingSettings') as HTMLButtonElement;
    const status = document.getElementById('aiSummaryCleansingSettingsStatus') as HTMLElement;
    btn.click();
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(status.textContent).toBe('設定を保存しました'));
    expect(status.className).toContain('success');
  });

  it('save button error shows error message and logs', async () => {
    vi.useFakeTimers();
    createFullDom();
    mockSaveSettings.mockRejectedValueOnce(new Error('fail'));
    setupAiSummaryCleansingEventListeners();
    const btn = document.getElementById('saveAiSummaryCleansingSettings') as HTMLButtonElement;
    const status = document.getElementById('aiSummaryCleansingSettingsStatus') as HTMLElement;
    btn.click();
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(status.textContent).toBe('Save error'));
    expect(status.className).toContain('error');
    expect(mockLogError).toHaveBeenCalled();
  });

  it('save button error fallback message when i18n empty', async () => {
    vi.useFakeTimers();
    createFullDom();
    (globalThis.chrome.i18n.getMessage as unknown as ReturnType<typeof vi.fn>).mockReturnValue('');
    mockSaveSettings.mockRejectedValueOnce(new Error('fail'));
    setupAiSummaryCleansingEventListeners();
    (document.getElementById('saveAiSummaryCleansingSettings') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(document.getElementById('aiSummaryCleansingSettingsStatus')!.textContent).toBe('設定の保存に失敗しました'));
  });

  it('save button handles missing status element (success path)', async () => {
    vi.useFakeTimers();
    createFullDom();
    document.getElementById('aiSummaryCleansingSettingsStatus')!.remove();
    mockSaveSettings.mockResolvedValue(undefined as never);
    setupAiSummaryCleansingEventListeners();
    (document.getElementById('saveAiSummaryCleansingSettings') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(0);
    // no throw
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('save button handles missing status element (error path)', async () => {
    vi.useFakeTimers();
    createFullDom();
    document.getElementById('aiSummaryCleansingSettingsStatus')!.remove();
    mockSaveSettings.mockRejectedValueOnce(new Error('fail'));
    setupAiSummaryCleansingEventListeners();
    (document.getElementById('saveAiSummaryCleansingSettings') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(mockLogError).toHaveBeenCalled());
  });

  it('does not throw when save button missing', () => {
    createFullDom();
    document.getElementById('saveAiSummaryCleansingSettings')!.remove();
    expect(() => setupAiSummaryCleansingEventListeners()).not.toThrow();
  });
});
