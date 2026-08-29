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

vi.mock('../../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      PRIVACY_MODE: 'privacy_mode',
      PII_CONFIRMATION_UI: 'pii_confirmation_ui',
      AUTO_SAVE_PRIVACY_BEHAVIOR: 'auto_save_privacy_behavior',
    },
    getSettings: (...args: any[]) => mockGetSettings(...args),
    saveSettings: (...args: any[]) => mockSaveSettings(...args),

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
      PRIVACY_MODE: 'privacy_mode',
      PII_CONFIRMATION_UI: 'pii_confirmation_ui',
      AUTO_SAVE_PRIVACY_BEHAVIOR: 'auto_save_privacy_behavior',
    },
    getSettings: (...args: any[]) => mockGetSettings(...args),
    saveSettings: (...args: any[]) => mockSaveSettings(...args),

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
      PRIVACY_MODE: 'privacy_mode',
      PII_CONFIRMATION_UI: 'pii_confirmation_ui',
      AUTO_SAVE_PRIVACY_BEHAVIOR: 'auto_save_privacy_behavior',
    },
    getSettings: (...args: any[]) => mockGetSettings(...args),
    saveSettings: (...args: any[]) => mockSaveSettings(...args),

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
      PRIVACY_MODE: 'privacy_mode',
      PII_CONFIRMATION_UI: 'pii_confirmation_ui',
      AUTO_SAVE_PRIVACY_BEHAVIOR: 'auto_save_privacy_behavior',
    },
    getSettings: (...args: any[]) => mockGetSettings(...args),
    saveSettings: (...args: any[]) => mockSaveSettings(...args),

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
      PRIVACY_MODE: 'privacy_mode',
      PII_CONFIRMATION_UI: 'pii_confirmation_ui',
      AUTO_SAVE_PRIVACY_BEHAVIOR: 'auto_save_privacy_behavior',
    },
    getSettings: (...args: any[]) => mockGetSettings(...args),
    saveSettings: (...args: any[]) => mockSaveSettings(...args),

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
      PRIVACY_MODE: 'privacy_mode',
      PII_CONFIRMATION_UI: 'pii_confirmation_ui',
      AUTO_SAVE_PRIVACY_BEHAVIOR: 'auto_save_privacy_behavior',
    },
    getSettings: (...args: any[]) => mockGetSettings(...args),
    saveSettings: (...args: any[]) => mockSaveSettings(...args),

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
      PRIVACY_MODE: 'privacy_mode',
      PII_CONFIRMATION_UI: 'pii_confirmation_ui',
      AUTO_SAVE_PRIVACY_BEHAVIOR: 'auto_save_privacy_behavior',
    },
    getSettings: (...args: any[]) => mockGetSettings(...args),
    saveSettings: (...args: any[]) => mockSaveSettings(...args),

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

vi.mock('../../../utils/ui/settingsUiHelper.js', () => ({
  showStatus: (...args: any[]) => mockShowStatus(...args),
}));

vi.mock('../../../utils/i18n.js', () => ({
  getMessage: (...args: any[]) => mockGetMessage(...args),
}));

const mockSanitizeRegex = vi.fn();
vi.mock('../../../utils/piiSanitizer.js', () => ({
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

  describe('cloud provider guard (toggleCloudProviderSettings)', () => {
    function setupProviderDOM() {
      document.body.innerHTML = `
        <input type="radio" name="privacyMode" value="masked_cloud" />
        <input type="radio" name="privacyMode" value="full_pipeline" checked />
        <input type="radio" name="privacyMode" value="local_only" />
        <input type="checkbox" id="piiConfirm" />
        <input type="radio" name="autoSavePrivacyBehavior" value="save" checked />
        <button id="savePrivacySettings">Save</button>
        <div id="privacyStatus"></div>
        <div id="providerWrap">
          <div class="form-group">
            <select id="aiProvider"><option value="gemini">Gemini</option></select>
          </div>
          <div id="geminiSettings"><input type="text" /></div>
          <div id="openaiSettings"><input type="text" /></div>
          <div id="openai2Settings"><input type="text" /></div>
        </div>
      `;
    }

    it('disables cloud provider settings when local_only is selected', async () => {
      setupProviderDOM();
      mockGetSettings.mockResolvedValue({});

      const { init, loadPrivacySettings } = await import('../privacySettings.js');
      await loadPrivacySettings();
      init();

      const localOnly = document.querySelector('input[name="privacyMode"][value="local_only"]') as HTMLInputElement;
      localOnly.checked = true;
      localOnly.dispatchEvent(new Event('change'));

      expect((document.getElementById('aiProvider') as HTMLSelectElement).disabled).toBe(true);
      expect(
        (document.querySelector('#geminiSettings input') as HTMLInputElement).disabled
      ).toBe(true);
      expect(
        (document.querySelector('#openaiSettings input') as HTMLInputElement).disabled
      ).toBe(true);
      expect(
        (document.querySelector('#openai2Settings input') as HTMLInputElement).disabled
      ).toBe(true);
      expect((document.getElementById('providerWrap') as HTMLElement).style.opacity).toBe('0.5');
      expect((document.getElementById('providerWrap') as HTMLElement).style.pointerEvents).toBe('none');
    });

    it('re-enables cloud provider settings when a non-local mode is selected', async () => {
      setupProviderDOM();
      mockGetSettings.mockResolvedValue({ privacy_mode: 'local_only' });

      const { init, loadPrivacySettings } = await import('../privacySettings.js');
      await loadPrivacySettings();
      init();

      // Start disabled (local_only loaded), then switch to masked_cloud
      expect((document.getElementById('aiProvider') as HTMLSelectElement).disabled).toBe(true);

      const maskedCloud = document.querySelector('input[name="privacyMode"][value="masked_cloud"]') as HTMLInputElement;
      maskedCloud.checked = true;
      maskedCloud.dispatchEvent(new Event('change'));

      expect((document.getElementById('aiProvider') as HTMLSelectElement).disabled).toBe(false);
      expect(
        (document.querySelector('#geminiSettings input') as HTMLInputElement).disabled
      ).toBe(false);
      expect((document.getElementById('providerWrap') as HTMLElement).style.opacity).toBe('1');
      expect((document.getElementById('providerWrap') as HTMLElement).style.pointerEvents).toBe('');
    });

    it('ignores change events on unchecked radios', async () => {
      setupProviderDOM();
      mockGetSettings.mockResolvedValue({});

      const { init, loadPrivacySettings } = await import('../privacySettings.js');
      await loadPrivacySettings();
      init();

      // Dispatch change without checking the radio → guard must not run
      const localOnly = document.querySelector('input[name="privacyMode"][value="local_only"]') as HTMLInputElement;
      localOnly.checked = false;
      localOnly.dispatchEvent(new Event('change'));

      expect((document.getElementById('aiProvider') as HTMLSelectElement).disabled).toBe(false);
    });
  });

  describe('savePrivacySettings validation fallbacks', () => {
    it('shows modeRequired error when no privacy mode radio is selected', async () => {
      document.body.innerHTML = `
        <input type="radio" name="privacyMode" value="masked_cloud" />
        <input type="radio" name="privacyMode" value="full_pipeline" />
        <button id="savePrivacySettings">Save</button>
        <div id="privacyStatus"></div>
      `;
      mockGetSettings.mockResolvedValue({ privacy_mode: 'unknown_mode' });

      const { init, loadPrivacySettings } = await import('../privacySettings.js');
      await loadPrivacySettings();
      init();

      (document.getElementById('savePrivacySettings') as HTMLButtonElement).click();

      await vi.waitFor(() => {
        expect(mockShowStatus).toHaveBeenCalledWith('privacyStatus', 'modeRequired', 'error');
      });
      expect(mockSaveSettings).not.toHaveBeenCalled();
    });

    it('defaults confirmation to true and behavior to save when elements are missing', async () => {
      document.body.innerHTML = `
        <input type="radio" name="privacyMode" value="full_pipeline" checked />
        <button id="savePrivacySettings">Save</button>
        <div id="privacyStatus"></div>
      `;
      mockGetSettings.mockResolvedValue({});
      mockSaveSettings.mockResolvedValue(undefined);

      const { init, loadPrivacySettings } = await import('../privacySettings.js');
      await loadPrivacySettings();
      init();

      (document.getElementById('savePrivacySettings') as HTMLButtonElement).click();

      await vi.waitFor(() => {
        expect(mockSaveSettings).toHaveBeenCalled();
      });
      expect(mockSaveSettings).toHaveBeenCalledWith({
        privacy_mode: 'full_pipeline',
        pii_confirmation_ui: true,
        auto_save_privacy_behavior: 'save',
      });
    });
  });
});
