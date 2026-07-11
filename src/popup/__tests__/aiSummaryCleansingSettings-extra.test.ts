// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStorageKeys = vi.hoisted(() => ({
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
  AI_SUMMARY_CLEANSING_FIXED: 'ai_summary_cleansing_fixed',
  AI_SUMMARY_CLEANSING_RECOMMEND: 'ai_summary_cleansing_recommend',
  AI_SUMMARY_CLEANSING_PAGINATION: 'ai_summary_cleansing_pagination',
  AI_SUMMARY_CLEANSING_SNS_PROMO: 'ai_summary_cleansing_sns_promo',
  AI_SUMMARY_CLEANSING_POPUP: 'ai_summary_cleansing_popup',
  AI_SUMMARY_CLEANSING_PLATFORM: 'ai_summary_cleansing_platform',
  AI_SUMMARY_CLEANSING_TEXT_DENSITY: 'ai_summary_cleansing_text_density',
  AI_SUMMARY_CLEANSING_SHORT_SEQ: 'ai_summary_cleansing_short_seq',
  AI_SUMMARY_CLEANSING_SYMBOL_LINE: 'ai_summary_cleansing_symbol_line',
  AI_SUMMARY_CLEANSING_LINK_PARA: 'ai_summary_cleansing_link_para',
  AI_SUMMARY_CLEANSING_LINK_RATIO_THRESHOLD: 'ai_summary_cleansing_link_ratio_threshold',
  AI_SUMMARY_CLEANSING_SHORT_TEXT_THRESHOLD: 'ai_summary_cleansing_short_text_threshold',
  AI_SUMMARY_CLEANSING_SHORT_SEQ_COUNT: 'ai_summary_cleansing_short_seq_count',
  AI_SUMMARY_CLEANSING_LINK_PARA_THRESHOLD: 'ai_summary_cleansing_link_para_threshold',
  AI_SUMMARY_CLEANSING_ENHANCED_HIDDEN: 'ai_summary_cleansing_enhanced_hidden',
  AI_SUMMARY_CLEANSING_EMPTY_ELEM: 'ai_summary_cleansing_empty_elem',
  AI_SUMMARY_CLEANSING_JP_LAYOUT: 'ai_summary_cleansing_jp_layout',
  AI_SUMMARY_CLEANSING_JP_NAVIGATION: 'ai_summary_cleansing_jp_navigation',
  AI_SUMMARY_CLEANSING_AUTHOR: 'ai_summary_cleansing_author',
  AI_SUMMARY_CLEANSING_BODY_PROTECTION_ENABLED: 'ai_summary_cleansing_body_protection_enabled',
  AI_SUMMARY_CLEANSING_BODY_PROTECTION_THRESHOLD: 'ai_summary_cleansing_body_protection_threshold',
}));

vi.mock('../../utils/storage.js', () => ({
  StorageKeys: mockStorageKeys,
  DEFAULT_SETTINGS: {},
  getSettings: vi.fn(),
  saveSettings: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../utils/logger.js', () => ({
  logError: vi.fn(),
  ErrorCode: {
    STORAGE_WRITE_FAILURE: 'STRG_WR_001',
    INTERNAL_ERROR: 'INT_001',
  },
}));

import * as storage from '../../utils/storage.js';
import { logError } from '../../utils/logger.js';
import {
  getAiSummaryCleansingSettings,
  saveAiSummaryCleansingSettings,
  applyAiSummaryCleansingSettingsToUI,
  getAiSummaryCleansingSettingsFromUI,
  updateAiSummaryCleansingCheckboxStates,
  setupAiSummaryCleansingEventListeners,
} from '../aiSummaryCleansingSettingsV2.js';

const mockGetSettings = vi.mocked(storage.getSettings);
const mockSaveSettings = vi.mocked(storage.saveSettings);

const baseSettings = {
  enabled: true,
  altEnabled: true,
  metadataEnabled: true,
  adsEnabled: true,
  navEnabled: true,
  socialEnabled: true,
  deepEnabled: false,
  linkDensityEnabled: true,
  jsonLdEnabled: false,
  lazyLoadEnabled: false,
  skipLinkEnabled: false,
  cardEnabled: false,
  fixedEnabled: false,
  recommendEnabled: true,
  paginationEnabled: false,
  snsPromoEnabled: false,
  popupEnabled: true,
  platformEnabled: false,
  textDensityEnabled: false,
  shortSeqEnabled: false,
  symbolLineEnabled: false,
  linkParaEnabled: false,
  linkRatioThreshold: 70,
  shortTextThreshold: 30,
  shortSeqCount: 5,
  linkParaThreshold: 50,
  enhancedHiddenEnabled: true,
  emptyElemEnabled: true,
  jpLayoutEnabled: false,
  jpNavigationEnabled: false,
  authorEnabled: false,
  bodyProtectionEnabled: true,
  bodyProtectionThreshold: 200,
};

function createCleansingDom(): void {
  document.body.innerHTML = [
    '<input type="checkbox" id="ai-summary-cleansing-enabled">',
    '<input type="checkbox" id="ai-summary-cleansing-alt">',
    '<input type="checkbox" id="ai-summary-cleansing-metadata">',
    '<input type="checkbox" id="ai-summary-cleansing-ads">',
    '<input type="checkbox" id="ai-summary-cleansing-nav">',
    '<input type="checkbox" id="ai-summary-cleansing-social">',
    '<input type="checkbox" id="ai-summary-cleansing-deep">',
    '<input type="checkbox" id="ai-summary-cleansing-link-density">',
    '<input type="checkbox" id="ai-summary-cleansing-json-ld">',
    '<input type="checkbox" id="ai-summary-cleansing-lazy-load">',
    '<input type="checkbox" id="ai-summary-cleansing-skip-link">',
    '<input type="checkbox" id="ai-summary-cleansing-card">',
    '<input type="checkbox" id="ai-summary-cleansing-fixed">',
    '<input type="checkbox" id="ai-summary-cleansing-recommend">',
    '<input type="checkbox" id="ai-summary-cleansing-pagination">',
    '<input type="checkbox" id="ai-summary-cleansing-sns-promo">',
    '<input type="checkbox" id="ai-summary-cleansing-popup">',
    '<input type="checkbox" id="ai-summary-cleansing-platform">',
    '<input type="checkbox" id="ai-summary-cleansing-text-density">',
    '<input type="checkbox" id="ai-summary-cleansing-short-seq">',
    '<input type="checkbox" id="ai-summary-cleansing-symbol-line">',
    '<input type="checkbox" id="ai-summary-cleansing-link-para">',
    '<input type="checkbox" id="ai-summary-cleansing-enhanced-hidden">',
    '<input type="checkbox" id="ai-summary-cleansing-empty-elem">',
    '<input type="checkbox" id="ai-summary-cleansing-jp-layout">',
    '<input type="checkbox" id="ai-summary-cleansing-jp-navigation">',
    '<input type="checkbox" id="ai-summary-cleansing-author">',
    '<input type="checkbox" id="ai-summary-cleansing-body-protection-enabled">',
    '<input type="checkbox" id="popup-body-protection-enabled">',
    '<input type="range" id="ai-summary-cleansing-body-protection-threshold" min="0" max="500">',
    '<input type="range" id="popup-body-protection-threshold" min="0" max="500">',
    '<span id="ai-summary-cleansing-body-protection-threshold-value"></span>',
    '<span id="popup-body-protection-threshold-value"></span>',
    '<input type="range" id="ai-summary-cleansing-link-ratio-threshold" min="0" max="100">',
    '<span id="link-ratio-threshold-value"></span>',
    '<input type="range" id="ai-summary-cleansing-short-text-threshold" min="0" max="500">',
    '<span id="short-text-threshold-value"></span>',
    '<input type="range" id="ai-summary-cleansing-short-seq-count" min="0" max="100">',
    '<span id="short-seq-count-value"></span>',
    '<input type="range" id="ai-summary-cleansing-link-para-threshold" min="0" max="100">',
    '<span id="link-para-threshold-value"></span>',
    '<fieldset id="aiSummaryCleansingFieldset"></fieldset>',
    '<div id="aiSummaryCleansingSubGroup"></div>',
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

// ──────────────────────────────────────────────
// getAiSummaryCleansingSettings — extra defaults
// ──────────────────────────────────────────────
describe('getAiSummaryCleansingSettings — extra defaults', () => {
  it('returns defaults for new six cleansing fields', async () => {
    mockGetSettings.mockResolvedValueOnce({} as never);
    const s = await getAiSummaryCleansingSettings();
    expect(s.fixedEnabled).toBe(false);
    expect(s.recommendEnabled).toBe(true);
    expect(s.paginationEnabled).toBe(false);
    expect(s.snsPromoEnabled).toBe(false);
    expect(s.popupEnabled).toBe(true);
    expect(s.platformEnabled).toBe(false);
  });

  it('returns defaults for nine additional option fields', async () => {
    mockGetSettings.mockResolvedValueOnce({} as never);
    const s = await getAiSummaryCleansingSettings();
    expect(s.textDensityEnabled).toBe(false);
    expect(s.shortSeqEnabled).toBe(false);
    expect(s.symbolLineEnabled).toBe(false);
    expect(s.linkParaEnabled).toBe(false);
    expect(s.enhancedHiddenEnabled).toBe(true);
    expect(s.emptyElemEnabled).toBe(true);
    expect(s.jpLayoutEnabled).toBe(false);
    expect(s.jpNavigationEnabled).toBe(false);
    expect(s.authorEnabled).toBe(false);
  });

  it('returns default numeric threshold values', async () => {
    mockGetSettings.mockResolvedValueOnce({} as never);
    const s = await getAiSummaryCleansingSettings();
    expect(s.linkRatioThreshold).toBe(70);
    expect(s.shortTextThreshold).toBe(30);
    expect(s.shortSeqCount).toBe(5);
    expect(s.linkParaThreshold).toBe(50);
    expect(s.bodyProtectionThreshold).toBe(200);
  });

  it('returns body protection defaults', async () => {
    mockGetSettings.mockResolvedValueOnce({} as never);
    const s = await getAiSummaryCleansingSettings();
    expect(s.bodyProtectionEnabled).toBe(true);
  });

  it('reads stored values for new fields when present', async () => {
    mockGetSettings.mockResolvedValueOnce({
      ai_summary_cleansing_fixed: true,
      ai_summary_cleansing_recommend: false,
      ai_summary_cleansing_body_protection_enabled: false,
      ai_summary_cleansing_body_protection_threshold: 150,
      ai_summary_cleansing_link_ratio_threshold: 80,
      ai_summary_cleansing_short_text_threshold: 40,
      ai_summary_cleansing_short_seq_count: 10,
      ai_summary_cleansing_link_para_threshold: 60,
      authorEnabled: undefined,
    } as never);
    const s = await getAiSummaryCleansingSettings();
    expect(s.fixedEnabled).toBe(true);
    expect(s.recommendEnabled).toBe(false);
    expect(s.bodyProtectionEnabled).toBe(false);
    expect(s.bodyProtectionThreshold).toBe(150);
    expect(s.linkRatioThreshold).toBe(80);
    expect(s.shortTextThreshold).toBe(40);
    expect(s.shortSeqCount).toBe(10);
    expect(s.linkParaThreshold).toBe(60);
  });
});

// ──────────────────────────────────────────────
// saveAiSummaryCleansingSettings — merge & all fields
// ──────────────────────────────────────────────
describe('saveAiSummaryCleansingSettings — merge & all fields', () => {
  it('merges with existing unrelated settings', async () => {
    mockGetSettings.mockResolvedValueOnce({ other_key: 'keep' } as never);
    await saveAiSummaryCleansingSettings(baseSettings);
    expect(mockSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ other_key: 'keep', ai_summary_cleansing_enabled: true })
    );
  });

  it('saves all nine additional boolean fields', async () => {
    mockGetSettings.mockResolvedValueOnce({} as never);
    await saveAiSummaryCleansingSettings({
      ...baseSettings,
      textDensityEnabled: true,
      shortSeqEnabled: true,
      symbolLineEnabled: true,
      linkParaEnabled: true,
      enhancedHiddenEnabled: true,
      emptyElemEnabled: true,
      jpLayoutEnabled: true,
      jpNavigationEnabled: true,
      authorEnabled: true,
    });
    expect(mockSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        ai_summary_cleansing_text_density: true,
        ai_summary_cleansing_short_seq: true,
        ai_summary_cleansing_symbol_line: true,
        ai_summary_cleansing_link_para: true,
        ai_summary_cleansing_enhanced_hidden: true,
        ai_summary_cleansing_empty_elem: true,
        ai_summary_cleansing_jp_layout: true,
        ai_summary_cleansing_jp_navigation: true,
        ai_summary_cleansing_author: true,
      })
    );
  });

  it('saves numeric threshold fields', async () => {
    mockGetSettings.mockResolvedValueOnce({} as never);
    await saveAiSummaryCleansingSettings({
      ...baseSettings,
      linkRatioThreshold: 80,
      shortTextThreshold: 40,
      shortSeqCount: 10,
      linkParaThreshold: 60,
      bodyProtectionThreshold: 150,
    });
    expect(mockSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        ai_summary_cleansing_link_ratio_threshold: 80,
        ai_summary_cleansing_short_text_threshold: 40,
        ai_summary_cleansing_short_seq_count: 10,
        ai_summary_cleansing_link_para_threshold: 60,
        ai_summary_cleansing_body_protection_threshold: 150,
      })
    );
  });

  it('saves body protection toggle fields', async () => {
    mockGetSettings.mockResolvedValueOnce({} as never);
    await saveAiSummaryCleansingSettings({ ...baseSettings, bodyProtectionEnabled: false });
    expect(mockSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        ai_summary_cleansing_body_protection_enabled: false,
        ai_summary_cleansing_body_protection_threshold: 200,
      })
    );
  });

  it('saves the six new boolean option fields', async () => {
    mockGetSettings.mockResolvedValueOnce({} as never);
    await saveAiSummaryCleansingSettings({
      ...baseSettings,
      fixedEnabled: true,
      paginationEnabled: true,
      snsPromoEnabled: true,
      platformEnabled: true,
    });
    expect(mockSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        ai_summary_cleansing_fixed: true,
        ai_summary_cleansing_pagination: true,
        ai_summary_cleansing_sns_promo: true,
        ai_summary_cleansing_platform: true,
      })
    );
  });
});

// ──────────────────────────────────────────────
// applyAiSummaryCleansingSettingsToUI
// ──────────────────────────────────────────────
describe('applyAiSummaryCleansingSettingsToUI', () => {
  beforeEach(createCleansingDom);

  it('sets checkboxes according to settings', () => {
    applyAiSummaryCleansingSettingsToUI({ ...baseSettings, enabled: true, deepEnabled: true, altEnabled: false });
    expect((document.getElementById('ai-summary-cleansing-enabled') as HTMLInputElement).checked).toBe(true);
    expect((document.getElementById('ai-summary-cleansing-alt') as HTMLInputElement).checked).toBe(false);
    expect((document.getElementById('ai-summary-cleansing-deep') as HTMLInputElement).checked).toBe(true);
  });

  it('shows subGroup as block when enabled', () => {
    applyAiSummaryCleansingSettingsToUI({ ...baseSettings, enabled: true });
    expect(document.getElementById('aiSummaryCleansingSubGroup')!.style.display).toBe('block');
  });

  it('hides subGroup as none when disabled', () => {
    applyAiSummaryCleansingSettingsToUI({ ...baseSettings, enabled: false });
    expect(document.getElementById('aiSummaryCleansingSubGroup')!.style.display).toBe('none');
  });

  it('sets body protection threshold slider and value span', () => {
    applyAiSummaryCleansingSettingsToUI({ ...baseSettings, bodyProtectionThreshold: 180 });
    expect((document.getElementById('ai-summary-cleansing-body-protection-threshold') as HTMLInputElement).value).toBe('180');
    expect(document.getElementById('ai-summary-cleansing-body-protection-threshold-value')!.textContent).toBe('180');
  });

  it('sets popup body protection elements', () => {
    applyAiSummaryCleansingSettingsToUI({ ...baseSettings, bodyProtectionEnabled: false });
    expect((document.getElementById('popup-body-protection-enabled') as HTMLInputElement).checked).toBe(false);
  });

  it('sets popup body protection threshold', () => {
    applyAiSummaryCleansingSettingsToUI({ ...baseSettings, bodyProtectionThreshold: 120 });
    expect((document.getElementById('popup-body-protection-threshold') as HTMLInputElement).value).toBe('120');
    expect(document.getElementById('popup-body-protection-threshold-value')!.textContent).toBe('120');
  });

  it('sets link ratio threshold input and value display', () => {
    applyAiSummaryCleansingSettingsToUI({ ...baseSettings, linkRatioThreshold: 85 });
    expect((document.getElementById('ai-summary-cleansing-link-ratio-threshold') as HTMLInputElement).value).toBe('85');
    expect(document.getElementById('link-ratio-threshold-value')!.textContent).toBe('85');
  });

  it('sets short text threshold input and value display', () => {
    applyAiSummaryCleansingSettingsToUI({ ...baseSettings, shortTextThreshold: 20 });
    expect((document.getElementById('ai-summary-cleansing-short-text-threshold') as HTMLInputElement).value).toBe('20');
    expect(document.getElementById('short-text-threshold-value')!.textContent).toBe('20');
  });

  it('sets short seq count input and value display', () => {
    applyAiSummaryCleansingSettingsToUI({ ...baseSettings, shortSeqCount: 8 });
    expect((document.getElementById('ai-summary-cleansing-short-seq-count') as HTMLInputElement).value).toBe('8');
    expect(document.getElementById('short-seq-count-value')!.textContent).toBe('8');
  });

  it('sets link para threshold input and value display', () => {
    applyAiSummaryCleansingSettingsToUI({ ...baseSettings, linkParaThreshold: 40 });
    expect((document.getElementById('ai-summary-cleansing-link-para-threshold') as HTMLInputElement).value).toBe('40');
    expect(document.getElementById('link-para-threshold-value')!.textContent).toBe('40');
  });

  it('handles missing threshold value spans gracefully', () => {
    document.getElementById('link-ratio-threshold-value')!.remove();
    document.getElementById('link-para-threshold-value')!.remove();
    expect(() => applyAiSummaryCleansingSettingsToUI(baseSettings)).not.toThrow();
  });

  it('handles complete missing DOM gracefully', () => {
    document.body.innerHTML = '';
    expect(() => applyAiSummaryCleansingSettingsToUI(baseSettings)).not.toThrow();
  });
});

// ──────────────────────────────────────────────
// getAiSummaryCleansingSettingsFromUI
// ──────────────────────────────────────────────
describe('getAiSummaryCleansingSettingsFromUI', () => {
  beforeEach(createCleansingDom);

  it('reads checkbox and threshold values from DOM', () => {
    (document.getElementById('ai-summary-cleansing-enabled') as HTMLInputElement).checked = true;
    (document.getElementById('ai-summary-cleansing-deep') as HTMLInputElement).checked = true;
    (document.getElementById('ai-summary-cleansing-json-ld') as HTMLInputElement).checked = true;
    (document.getElementById('ai-summary-cleansing-fixed') as HTMLInputElement).checked = true;
    (document.getElementById('ai-summary-cleansing-body-protection-enabled') as HTMLInputElement).checked = false;
    (document.getElementById('ai-summary-cleansing-link-ratio-threshold') as HTMLInputElement).value = '80';
    (document.getElementById('ai-summary-cleansing-short-text-threshold') as HTMLInputElement).value = '25';
    (document.getElementById('ai-summary-cleansing-short-seq-count') as HTMLInputElement).value = '7';
    (document.getElementById('ai-summary-cleansing-link-para-threshold') as HTMLInputElement).value = '55';
    (document.getElementById('ai-summary-cleansing-body-protection-threshold') as HTMLInputElement).value = '150';

    const s = getAiSummaryCleansingSettingsFromUI();
    expect(s.enabled).toBe(true);
    expect(s.deepEnabled).toBe(true);
    expect(s.jsonLdEnabled).toBe(true);
    expect(s.fixedEnabled).toBe(true);
    expect(s.bodyProtectionEnabled).toBe(false);
    expect(s.linkRatioThreshold).toBe(80);
    expect(s.shortTextThreshold).toBe(25);
    expect(s.shortSeqCount).toBe(7);
    expect(s.linkParaThreshold).toBe(55);
    expect(s.bodyProtectionThreshold).toBe(150);
  });

  it('uses default values when DOM elements are missing', () => {
    document.body.innerHTML = '';
    const s = getAiSummaryCleansingSettingsFromUI();
    expect(s.enabled).toBe(true);
    expect(s.linkRatioThreshold).toBe(70);
    expect(s.shortTextThreshold).toBe(30);
    expect(s.shortSeqCount).toBe(5);
    expect(s.linkParaThreshold).toBe(50);
    expect(s.bodyProtectionEnabled).toBe(true);
    expect(s.bodyProtectionThreshold).toBe(200);
  });
});

// ──────────────────────────────────────────────
// updateAiSummaryCleansingCheckboxStates
// ──────────────────────────────────────────────
describe('updateAiSummaryCleansingCheckboxStates', () => {
  beforeEach(createCleansingDom);

  it('enables child checkboxes when enabled=true', () => {
    updateAiSummaryCleansingCheckboxStates(true);
    expect((document.getElementById('ai-summary-cleansing-alt') as HTMLInputElement).disabled).toBe(false);
    expect((document.getElementById('ai-summary-cleansing-deep') as HTMLInputElement).disabled).toBe(false);
    expect((document.getElementById('ai-summary-cleansing-fixed') as HTMLInputElement).disabled).toBe(false);
    expect((document.getElementById('ai-summary-cleansing-text-density') as HTMLInputElement).disabled).toBe(false);
  });

  it('disables child checkboxes when enabled=false', () => {
    updateAiSummaryCleansingCheckboxStates(false);
    expect((document.getElementById('ai-summary-cleansing-alt') as HTMLInputElement).disabled).toBe(true);
    expect((document.getElementById('ai-summary-cleansing-deep') as HTMLInputElement).disabled).toBe(true);
    expect((document.getElementById('ai-summary-cleansing-fixed') as HTMLInputElement).disabled).toBe(true);
    expect((document.getElementById('ai-summary-cleansing-text-density') as HTMLInputElement).disabled).toBe(true);
  });

  it('keeps body protection checkboxes always enabled', () => {
    updateAiSummaryCleansingCheckboxStates(false);
    expect((document.getElementById('ai-summary-cleansing-body-protection-enabled') as HTMLInputElement).disabled).toBe(false);
    expect((document.getElementById('popup-body-protection-enabled') as HTMLInputElement).disabled).toBe(false);
  });

  it('keeps body protection sliders always enabled', () => {
    updateAiSummaryCleansingCheckboxStates(false);
    expect((document.getElementById('ai-summary-cleansing-body-protection-threshold') as HTMLInputElement).disabled).toBe(false);
    expect((document.getElementById('popup-body-protection-threshold') as HTMLInputElement).disabled).toBe(false);
  });

  it('does not throw when elements are missing', () => {
    document.body.innerHTML = '';
    expect(() => updateAiSummaryCleansingCheckboxStates(true)).not.toThrow();
    expect(() => updateAiSummaryCleansingCheckboxStates(false)).not.toThrow();
  });
});

// ──────────────────────────────────────────────
// setupAiSummaryCleansingEventListeners
// ──────────────────────────────────────────────
describe('setupAiSummaryCleansingEventListeners', () => {
  beforeEach(() => {
    createCleansingDom();
    vi.useFakeTimers();
    mockGetSettings.mockResolvedValue({ ai_summary_cleansing_enabled: true } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('save button shows success message on click', async () => {
    setupAiSummaryCleansingEventListeners();
    const btn = document.getElementById('saveAiSummaryCleansingSettings') as HTMLButtonElement;
    btn.click();
    await vi.waitFor(() => {
      const el = document.getElementById('aiSummaryCleansingSettingsStatus')!;
      expect(el.textContent).toBe('Settings saved');
      expect(el.className).toContain('success');
    });
  });

  it('save button clears status message after 3s', async () => {
    setupAiSummaryCleansingEventListeners();
    (document.getElementById('saveAiSummaryCleansingSettings') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(3000);
    const el = document.getElementById('aiSummaryCleansingSettingsStatus')!;
    expect(el.textContent).toBe('');
  });

  it('save button shows error message on failure', async () => {
    mockSaveSettings.mockRejectedValueOnce(new Error('Storage error'));
    setupAiSummaryCleansingEventListeners();
    (document.getElementById('saveAiSummaryCleansingSettings') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      const el = document.getElementById('aiSummaryCleansingSettingsStatus')!;
      expect(el.textContent).toBe('Failed to save settings');
      expect(el.className).toContain('error');
    });
    expect(logError).toHaveBeenCalled();
  });

  it('save button does not throw when status element is missing', () => {
    document.getElementById('aiSummaryCleansingSettingsStatus')!.remove();
    setupAiSummaryCleansingEventListeners();
    const btn = document.getElementById('saveAiSummaryCleansingSettings') as HTMLButtonElement;
    expect(() => btn.click()).not.toThrow();
  });

  it('enabled checkbox change saves settings with updated enabled state', async () => {
    mockGetSettings.mockResolvedValue({ ai_summary_cleansing_enabled: true, ai_summary_cleansing_alt: true } as never);
    setupAiSummaryCleansingEventListeners();
    const cb = document.getElementById('ai-summary-cleansing-enabled') as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalled();
    });
  });

  it('individual cleansing checkbox change calls save with UI values', async () => {
    setupAiSummaryCleansingEventListeners();
    const cb = document.getElementById('ai-summary-cleansing-alt') as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalled();
    });
  });

  it('body protection checkbox change calls save', async () => {
    setupAiSummaryCleansingEventListeners();
    const cb = document.getElementById('ai-summary-cleansing-body-protection-enabled') as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalled();
    });
  });

  it('range input event updates value display', () => {
    setupAiSummaryCleansingEventListeners();
    const slider = document.getElementById('ai-summary-cleansing-link-ratio-threshold') as HTMLInputElement;
    const valSpan = document.getElementById('link-ratio-threshold-value')!;
    slider.value = '90';
    slider.dispatchEvent(new Event('input'));
    expect(valSpan.textContent).toBe('90');
  });

  it('range change event saves settings', async () => {
    setupAiSummaryCleansingEventListeners();
    const slider = document.getElementById('ai-summary-cleansing-link-ratio-threshold') as HTMLInputElement;
    slider.value = '90';
    slider.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalled();
    });
  });

  it('does not throw when save button is missing', () => {
    document.getElementById('saveAiSummaryCleansingSettings')!.remove();
    expect(() => setupAiSummaryCleansingEventListeners()).not.toThrow();
  });
});
