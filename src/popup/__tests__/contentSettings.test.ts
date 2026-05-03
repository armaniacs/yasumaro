// @vitest-environment jsdom
/**
 * contentSettings.test.ts
 * Tests for content cleansing settings UI
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ============================================================================
// Mock Setup
// ============================================================================

const mockGetSettings = vi.hoisted(() => vi.fn());
const mockSaveSettings = vi.hoisted(() => vi.fn());
const mockShowStatus = vi.hoisted(() => vi.fn());
const mockLogError = vi.hoisted(() => vi.fn());
const mockGetMessage = vi.hoisted(() => vi.fn());

vi.mock('../../utils/storage.js', () => ({
  getSettings: mockGetSettings,
  saveSettings: mockSaveSettings,
  StorageKeys: {
    CONTENT_STRIP_HARD_ENABLED: 'content_strip_hard_enabled',
    CONTENT_STRIP_KEYWORD_ENABLED: 'content_strip_keyword_enabled',
    CONTENT_STRIP_KEYWORDS: 'content_strip_keywords',
    CONTENT_DEDUP_ENABLED: 'content_dedup_enabled',
    CONTENT_DEDUP_THRESHOLD: 'content_dedup_threshold',
    SUMMARY_NORMALIZE_ENABLED: 'summary_normalize_enabled',
  },
}));

vi.mock('../settingsUiHelper.js', () => ({
  showStatus: mockShowStatus,
}));

vi.mock('../i18n.js', () => ({
  getMessage: mockGetMessage,
}));

vi.mock('../../utils/logger.js', () => ({
  logError: mockLogError,
  ErrorCode: { STORAGE_WRITE_FAILURE: 'STORAGE_WRITE_FAILURE' },
}));

import { loadContentSettings, init } from '../contentSettings.js';

// ============================================================================
// Helpers
// ============================================================================

function setupDom(): void {
  document.body.innerHTML = `
    <button id="saveContentSettings">Save</button>
    <button id="contentStripResetKeywords">Reset</button>
    <input id="contentStripHardEnabled" type="checkbox" />
    <input id="contentStripKeywordEnabled" type="checkbox" />
    <textarea id="contentStripKeywords"></textarea>
    <input id="content-dedup-enabled" type="checkbox" />
    <input id="content-dedup-threshold" type="range" />
    <span id="contentDedupThresholdValue"></span>
    <input id="summary-normalize-enabled" type="checkbox" />
    <div id="contentSettingsStatus"></div>
  `;
}

function getHardEnabledCheckbox(): HTMLInputElement | null {
  return document.getElementById('contentStripHardEnabled') as HTMLInputElement;
}

function getKeywordEnabledCheckbox(): HTMLInputElement | null {
  return document.getElementById('contentStripKeywordEnabled') as HTMLInputElement;
}

function getKeywordsTextarea(): HTMLTextAreaElement | null {
  return document.getElementById('contentStripKeywords') as HTMLTextAreaElement;
}

function getDedupEnabledCheckbox(): HTMLInputElement | null {
  return document.getElementById('content-dedup-enabled') as HTMLInputElement;
}

function getDedupThresholdSlider(): HTMLInputElement | null {
  return document.getElementById('content-dedup-threshold') as HTMLInputElement;
}

function getDedupThresholdValue(): HTMLElement | null {
  return document.getElementById('contentDedupThresholdValue');
}

function getNormalizeEnabledCheckbox(): HTMLInputElement | null {
  return document.getElementById('summary-normalize-enabled') as HTMLInputElement;
}

// ============================================================================
// Tests
// ============================================================================

describe('contentSettings', () => {
  beforeEach(() => {
    setupDom();
    mockGetSettings.mockReset();
    mockSaveSettings.mockReset();
    mockShowStatus.mockReset();
    mockLogError.mockReset();
    mockGetMessage.mockImplementation((key: string) => {
      const messages: Record<string, string> = {
        settingsSaved: '設定を保存しました',
        settingsSaveError: '設定の保存に失敗しました',
        contentStripResetKeywords: 'デフォルトに戻しました',
      };
      return messages[key] || key;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('loadContentSettings', () => {
    it('should load and apply all settings from storage', async () => {
      mockGetSettings.mockResolvedValue({
        content_strip_hard_enabled: true,
        content_strip_keyword_enabled: false,
        content_strip_keywords: ['custom1', 'custom2'],
        content_dedup_enabled: false,
        content_dedup_threshold: 0.85,
        summary_normalize_enabled: true,
      });

      await loadContentSettings();

      expect(getHardEnabledCheckbox()?.checked).toBe(true);
      expect(getKeywordEnabledCheckbox()?.checked).toBe(false);
      expect(getKeywordsTextarea()?.value).toBe('custom1\ncustom2');
      expect(getDedupEnabledCheckbox()?.checked).toBe(false);
      expect(getDedupThresholdSlider()?.value).toBe('0.85');
      expect(getDedupThresholdValue()?.textContent).toBe('0.85');
      expect(getNormalizeEnabledCheckbox()?.checked).toBe(true);
    });

    it('should apply default values for missing settings', async () => {
      mockGetSettings.mockResolvedValue({});

      await loadContentSettings();

      // CONTENT_STRIP_HARD_ENABLED: default true (checked)
      expect(getHardEnabledCheckbox()?.checked).toBe(true);

      // CONTENT_STRIP_KEYWORD_ENABLED: default true
      expect(getKeywordEnabledCheckbox()?.checked).toBe(true);

      // CONTENT_STRIP_KEYWORDS: defaults when not set
      expect(getKeywordsTextarea()?.value).toBe(
        ['balance', 'account', 'meisai', 'login', 'card-number', 'keiyaku', 'password', 'payment', 'transaction', 'billing', 'invoice', 'receipt', 'rireki', 'torihiki', 'zandaka', 'hoken', 'address'].join('\n')
      );

      // CONTENT_DEDUP_ENABLED: default true
      expect(getDedupEnabledCheckbox()?.checked).toBe(true);

      // CONTENT_DEDUP_THRESHOLD: default 0.7
      expect(getDedupThresholdSlider()?.value).toBe('0.7');

      // SUMMARY_NORMALIZE_ENABLED: default true
      expect(getNormalizeEnabledCheckbox()?.checked).toBe(true);
    });

    it('should handle null when elements are missing', async () => {
      document.body.innerHTML = '';

      mockGetSettings.mockResolvedValue({});
      // Should not throw
      await expect(loadContentSettings()).resolves.toBeUndefined();
    });

    it('should load with custom keywords', async () => {
      mockGetSettings.mockResolvedValue({
        content_strip_keywords: ['keyword1', 'keyword2', 'keyword3'],
      });

      await loadContentSettings();

      expect(getKeywordsTextarea()?.value).toBe('keyword1\nkeyword2\nkeyword3');
    });
  });

  describe('init', () => {
    it('should set up save button and load settings', async () => {
      mockGetSettings.mockResolvedValue({});
      init();
      await new Promise(resolve => setTimeout(resolve, 0));

      const saveBtn = document.getElementById('saveContentSettings');
      expect(saveBtn).not.toBeNull();
      expect(mockGetSettings).toHaveBeenCalledTimes(1);
    });

    it('should set up reset button to restore defaults', async () => {
      // Set non-default values first
      const hardCb = getHardEnabledCheckbox()!;
      hardCb.checked = false;
      const kwTextarea = getKeywordsTextarea()!;
      kwTextarea.value = 'some_value';

      mockGetSettings.mockResolvedValue({});
      init();
      await new Promise(resolve => setTimeout(resolve, 0));

      const resetBtn = document.getElementById('contentStripResetKeywords') as HTMLElement;
      resetBtn.click();

      expect(hardCb.checked).toBe(true);
      expect(kwTextarea.value).toContain('balance');
      expect(mockShowStatus).toHaveBeenCalledWith(
        'contentSettingsStatus',
        'デフォルトに戻しました',
        'success'
      );
    });

    it('should update threshold slider value display in real-time', async () => {
      mockGetSettings.mockResolvedValue({});
      init();
      await new Promise(resolve => setTimeout(resolve, 0));

      const slider = getDedupThresholdSlider()!;
      const valueEl = getDedupThresholdValue()!;

      slider.value = '0.95';
      slider.dispatchEvent(new Event('input'));

      expect(valueEl.textContent).toBe('0.95');
    });

    it('should handle missing elements gracefully', () => {
      document.body.innerHTML = '';
      mockGetSettings.mockResolvedValue({});

      // Should not throw
      expect(() => init()).not.toThrow();
    });
  });

  describe('save flow', () => {
    it('should save settings via button click after init', async () => {
      mockGetSettings.mockResolvedValue({
        content_strip_hard_enabled: true,
        content_strip_keyword_enabled: true,
        content_strip_keywords: ['kw1'],
        content_dedup_enabled: true,
        content_dedup_threshold: 0.7,
        summary_normalize_enabled: true,
      });

      init();
      // init() calls loadContentSettings() without await, so we flush
      // the microtask queue to let it complete before modifying DOM
      await new Promise(resolve => setTimeout(resolve, 0));

      // Modify and click save
      const hardCb = getHardEnabledCheckbox()!;
      hardCb.checked = false;

      const saveBtn = document.getElementById('saveContentSettings') as HTMLElement;
      saveBtn.click();

      await vi.waitFor(() => {
        expect(mockSaveSettings).toHaveBeenCalledWith(
          expect.objectContaining({
            content_strip_hard_enabled: false,
          })
        );
      });
    });

    it('should handle save errors gracefully', async () => {
      mockGetSettings.mockResolvedValue({
        content_strip_hard_enabled: true,
        content_strip_keyword_enabled: true,
      });
      mockSaveSettings.mockRejectedValue(new Error('Write failed'));
      mockGetMessage.mockImplementation((key: string) => {
        const messages: Record<string, string> = {
          settingsSaveError: '設定の保存に失敗しました',
        };
        return messages[key] || key;
      });

      init();
      await new Promise(resolve => setTimeout(resolve, 0));

      const saveBtn = document.getElementById('saveContentSettings') as HTMLElement;
      saveBtn.click();

      await vi.waitFor(() => {
        expect(mockLogError).toHaveBeenCalledWith(
          '[ContentSettings] Save error',
          expect.objectContaining({ cause: 'Write failed' }),
          'STORAGE_WRITE_FAILURE'
        );
      });

      expect(mockShowStatus).toHaveBeenCalledWith(
        'contentSettingsStatus',
        '設定の保存に失敗しました',
        'error'
      );
    });

    it('should handle keyword parsing in save', async () => {
      // Set initial settings
      mockGetSettings.mockResolvedValue({
        content_strip_keywords: [],
        content_dedup_enabled: true,
        content_dedup_threshold: 0.7,
        summary_normalize_enabled: true,
      });

      init();
      await new Promise(resolve => setTimeout(resolve, 0));

      // Set some keywords (init/loadContentSettings already set them to defaults,
      // but we override to test the save parsing)
      const kwTextarea = getKeywordsTextarea()!;
      kwTextarea.value = '  kw1  \nkw2\n\nkw3  ';

      const saveBtn = document.getElementById('saveContentSettings') as HTMLElement;
      saveBtn.click();

      await vi.waitFor(() => {
        expect(mockSaveSettings).toHaveBeenCalledWith(
          expect.objectContaining({
            content_strip_keywords: ['kw1', 'kw2', 'kw3'],
          })
        );
      });
    });

    it('should fall back to default keywords when keywords input is empty', async () => {
      mockGetSettings.mockResolvedValue({
        content_strip_keywords: ['existing'],
        content_dedup_enabled: true,
        content_dedup_threshold: 0.7,
        summary_normalize_enabled: true,
      });

      init();
      await new Promise(resolve => setTimeout(resolve, 0));

      // Clear all keywords
      const kwTextarea = getKeywordsTextarea()!;
      kwTextarea.value = '   \n\n  ';

      const saveBtn = document.getElementById('saveContentSettings') as HTMLElement;
      saveBtn.click();

      await vi.waitFor(() => {
        expect(mockSaveSettings).toHaveBeenCalledWith(
          expect.objectContaining({
            content_strip_keywords: ['balance', 'account', 'meisai', 'login', 'card-number', 'keiyaku', 'password', 'payment', 'transaction', 'billing', 'invoice', 'receipt', 'rireki', 'torihiki', 'zandaka', 'hoken', 'address'],
          })
        );
      });
    });
  });
});
