// @vitest-environment jsdom
/**
 * privacySettings.test.ts
 * Tests for popup privacy settings module.
 *
 * The module caches DOM elements at import time, so we must set up the DOM
 * before importing and use vi.resetModules() in beforeEach to get a fresh
 * module for each test.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Full DOM setup (must match what the module expects at import time)
// ---------------------------------------------------------------------------
function setupFullDOM() {
  document.body.innerHTML = `
    <input type="radio" name="privacyMode" value="masked_cloud" />
    <input type="radio" name="privacyMode" value="full_pipeline" checked />
    <input type="radio" name="privacyMode" value="local_only" />
    <input type="radio" name="privacyMode" value="cloud_only" />
    <input type="checkbox" id="piiConfirm" />
    <input type="radio" name="autoSavePrivacyBehavior" value="save" checked />
    <input type="radio" name="autoSavePrivacyBehavior" value="skip" />
    <input type="radio" name="autoSavePrivacyBehavior" value="confirm" />
    <button id="savePrivacySettings">Save</button>
    <div id="privacyStatus"></div>
    <div id="piiSampleOriginal"></div>
    <div id="piiSampleMasked"></div>
  `;
}

// ---------------------------------------------------------------------------
// Mocks for dependencies
// ---------------------------------------------------------------------------
const mockGetSettings = vi.fn();
const mockSaveSettings = vi.fn();
const mockShowStatus = vi.fn();
const mockGetMessage = vi.fn((key: string) => key);

vi.mock('../../utils/storage.js', () => ({
  StorageKeys: {
    PRIVACY_MODE: 'privacy_mode',
    PII_CONFIRMATION_UI: 'pii_confirmation_ui',
    AUTO_SAVE_PRIVACY_BEHAVIOR: 'auto_save_privacy_behavior',
  },
  getSettings: (...args: any[]) => mockGetSettings(...args),
  saveSettings: (...args: any[]) => mockSaveSettings(...args),
}));

vi.mock('../settingsUiHelper.js', () => ({
  showStatus: (...args: any[]) => mockShowStatus(...args),
}));

vi.mock('../i18n.js', () => ({
  getMessage: (...args: any[]) => mockGetMessage(...args),
}));

const mockSanitizeRegex = vi.fn();
vi.mock('../../utils/piiSanitizer.js', () => ({
  sanitizeRegex: (...args: any[]) => mockSanitizeRegex(...args),
}));

describe('privacySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('loadPrivacySettings', () => {
    it('loads privacy mode from settings and checks the matching radio', async () => {
      setupFullDOM();
      mockGetSettings.mockResolvedValue({
        privacy_mode: 'local_only',
        pii_confirmation_ui: true,
        auto_save_privacy_behavior: 'skip',
      });

      const { loadPrivacySettings } = await import('../privacySettings.js');
      await loadPrivacySettings();

      expect(
        (document.querySelector('input[name="privacyMode"][value="local_only"]') as HTMLInputElement)?.checked
      ).toBe(true);
      expect(
        (document.querySelector('input[name="privacyMode"][value="full_pipeline"]') as HTMLInputElement)?.checked
      ).toBe(false);
    });

    it('defaults to full_pipeline when mode is not set', async () => {
      setupFullDOM();
      mockGetSettings.mockResolvedValue({});

      const { loadPrivacySettings } = await import('../privacySettings.js');
      await loadPrivacySettings();

      expect(
        (document.querySelector('input[name="privacyMode"][value="full_pipeline"]') as HTMLInputElement)?.checked
      ).toBe(true);
    });

    it('sets PII confirmation checkbox based on settings', async () => {
      setupFullDOM();
      mockGetSettings.mockResolvedValue({ pii_confirmation_ui: false });

      const { loadPrivacySettings } = await import('../privacySettings.js');
      await loadPrivacySettings();

      expect((document.getElementById('piiConfirm') as HTMLInputElement)?.checked).toBe(false);
    });

    it('defaults PII confirmation to true when not set', async () => {
      setupFullDOM();
      mockGetSettings.mockResolvedValue({});

      const { loadPrivacySettings } = await import('../privacySettings.js');
      await loadPrivacySettings();

      expect((document.getElementById('piiConfirm') as HTMLInputElement)?.checked).toBe(true);
    });

    it('loads auto-save privacy behavior', async () => {
      setupFullDOM();
      mockGetSettings.mockResolvedValue({ auto_save_privacy_behavior: 'confirm' });

      const { loadPrivacySettings } = await import('../privacySettings.js');
      await loadPrivacySettings();

      expect(
        (document.querySelector('input[name="autoSavePrivacyBehavior"][value="confirm"]') as HTMLInputElement)?.checked
      ).toBe(true);
    });

    it('defaults auto-save behavior to save when not set', async () => {
      setupFullDOM();
      mockGetSettings.mockResolvedValue({});

      const { loadPrivacySettings } = await import('../privacySettings.js');
      await loadPrivacySettings();

      expect(
        (document.querySelector('input[name="autoSavePrivacyBehavior"][value="save"]') as HTMLInputElement)?.checked
      ).toBe(true);
    });

    it('handles missing DOM elements gracefully (save button missing)', async () => {
      document.body.innerHTML = '';
      mockGetSettings.mockResolvedValue({});

      const { loadPrivacySettings } = await import('../privacySettings.js');
      await expect(loadPrivacySettings()).resolves.toBeUndefined();
    });
  });

  describe('save button behavior', () => {
    it('calls saveSettings with correct values on click', async () => {
      setupFullDOM();
      mockGetSettings.mockResolvedValue({ privacy_mode: 'masked_cloud', pii_confirmation_ui: true, auto_save_privacy_behavior: 'skip' });
      mockSaveSettings.mockResolvedValue(undefined);

      const { init, loadPrivacySettings } = await import('../privacySettings.js');
      await loadPrivacySettings();
      init();

      // Select masked_cloud
      (document.querySelector('input[name="privacyMode"][value="masked_cloud"]') as HTMLInputElement).checked = true;

      (document.getElementById('savePrivacySettings') as HTMLButtonElement).click();

      await vi.waitFor(() => {
        expect(mockSaveSettings).toHaveBeenCalled();
      });

      expect(mockSaveSettings).toHaveBeenCalledWith({
        privacy_mode: 'masked_cloud',
        pii_confirmation_ui: true,
        auto_save_privacy_behavior: 'skip',
      });
    });

    it('handles saveSettings error gracefully', async () => {
      setupFullDOM();
      mockGetSettings.mockResolvedValue({});
      mockSaveSettings.mockRejectedValue(new Error('Storage full'));

      const { init, loadPrivacySettings } = await import('../privacySettings.js');
      await loadPrivacySettings();
      init();

      (document.getElementById('savePrivacySettings') as HTMLButtonElement).click();

      await vi.waitFor(() => {
        expect(mockShowStatus).toHaveBeenCalledWith('privacyStatus', expect.stringContaining('saveError'), 'error');
      });
    });

    it('init wires the click handler and calls loadPrivacySettings', async () => {
      setupFullDOM();
      mockGetSettings.mockResolvedValue({});

      const { init } = await import('../privacySettings.js');
      init();

      expect(mockGetSettings).toHaveBeenCalled();
    });
  });

  describe('PII sample display (M4)', () => {
    it('renders masked-before and masked-after sample text on init', async () => {
      setupFullDOM();
      mockGetSettings.mockResolvedValue({});
      mockSanitizeRegex.mockResolvedValue({
        text: 'Contact: [EMAIL_REDACTED]',
        maskedItems: [{ type: 'email', original: 'user@example.com' }],
      });

      const { init } = await import('../privacySettings.js');
      init();

      await vi.waitFor(() => {
        expect(mockSanitizeRegex).toHaveBeenCalled();
      });

      expect(document.getElementById('piiSampleMasked')?.textContent).toContain('[EMAIL_REDACTED]');
      expect(document.getElementById('piiSampleOriginal')?.textContent?.length).toBeGreaterThan(0);
    });

    it('does not throw when sample elements are missing from the DOM', async () => {
      document.body.innerHTML = `
        <input type="radio" name="privacyMode" value="full_pipeline" checked />
        <button id="savePrivacySettings">Save</button>
        <div id="privacyStatus"></div>
      `;
      mockGetSettings.mockResolvedValue({});
      mockSanitizeRegex.mockResolvedValue({ text: '', maskedItems: [] });

      const { init } = await import('../privacySettings.js');
      expect(() => init()).not.toThrow();
    });
  });
});
