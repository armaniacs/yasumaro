// @vitest-environment jsdom

/**
 * cspSettings.test.ts
 * Unit tests for CspSettingsController (default `cspSettings` instance).
 */

import { vi } from 'vitest';

// Mock dependencies before importing cspSettings
vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      CONDITIONAL_CSP_ENABLED: 'conditional_csp_enabled',
      CONDITIONAL_CSP_PROVIDERS: 'conditional_csp_providers',
    },
    getSettings: vi.fn(),
    saveSettings: vi.fn(),

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
vi.mock('../../utils/storage/defaults.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      CONDITIONAL_CSP_ENABLED: 'conditional_csp_enabled',
      CONDITIONAL_CSP_PROVIDERS: 'conditional_csp_providers',
    },
    getSettings: vi.fn(),
    saveSettings: vi.fn(),

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
vi.mock('../../utils/storage/encryptionSession.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      CONDITIONAL_CSP_ENABLED: 'conditional_csp_enabled',
      CONDITIONAL_CSP_PROVIDERS: 'conditional_csp_providers',
    },
    getSettings: vi.fn(),
    saveSettings: vi.fn(),

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
vi.mock('../../utils/storage/settingsStore.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      CONDITIONAL_CSP_ENABLED: 'conditional_csp_enabled',
      CONDITIONAL_CSP_PROVIDERS: 'conditional_csp_providers',
    },
    getSettings: vi.fn(),
    saveSettings: vi.fn(),

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
vi.mock('../../utils/storage/savedUrlRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      CONDITIONAL_CSP_ENABLED: 'conditional_csp_enabled',
      CONDITIONAL_CSP_PROVIDERS: 'conditional_csp_providers',
    },
    getSettings: vi.fn(),
    saveSettings: vi.fn(),

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
vi.mock('../../utils/storage/domainFilterCache.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      CONDITIONAL_CSP_ENABLED: 'conditional_csp_enabled',
      CONDITIONAL_CSP_PROVIDERS: 'conditional_csp_providers',
    },
    getSettings: vi.fn(),
    saveSettings: vi.fn(),

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
vi.mock('../../utils/storage/quota.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: {
      CONDITIONAL_CSP_ENABLED: 'conditional_csp_enabled',
      CONDITIONAL_CSP_PROVIDERS: 'conditional_csp_providers',
    },
    getSettings: vi.fn(),
    saveSettings: vi.fn(),

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

vi.mock('../../utils/cspValidator.js', () => ({
  CSPValidator: {
    initializeFromSettings: vi.fn(),
    getAvailableProviders: vi.fn(),
    getProviderDomain: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { ERROR: 'ERROR', WARN: 'WARN', INFO: 'INFO', DEBUG: 'DEBUG' },
}));

vi.mock('../../utils/i18n.js', () => ({
  getMessage: vi.fn((key: string) => key),
}));

import { cspSettings, CspSettingsController } from '../cspSettings.js';
import { getSettings, saveSettings, StorageKeys } from '../../utils/storage.js';
import { CSPValidator } from '../../utils/cspValidator.js';
import { addLog } from '../../utils/logger.js';

const mockGetSettings = getSettings as vi.MockedFunction<typeof getSettings>;
const mockSaveSettings = saveSettings as vi.MockedFunction<typeof saveSettings>;
const mockAddLog = addLog as vi.MockedFunction<typeof addLog>;

function setupDOM() {
  document.body.innerHTML = `
    <div id="cspProviderList"></div>
    <input type="checkbox" id="conditionalCspEnabled" />
    <button id="cspSaveButton"></button>
    <button id="cspResetButton"></button>
    <input type="text" id="cspProviderSearch" />
    <div id="cspSaveMessage" style="display:none;"></div>
    <div id="cspResetMessage" style="display:none;"></div>
  `;
}

describe('cspSettings (CspSettingsController default instance)', () => {
  beforeEach(() => {
    setupDOM();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('loadCSPSettings', () => {
    test('should load settings and set checkbox state', async () => {
      mockGetSettings.mockResolvedValue({
        conditional_csp_enabled: true,
        conditional_csp_providers: ['huggingface'],
      } as any);

      (CSPValidator.getAvailableProviders as vi.Mock).mockReturnValue([]);

      await cspSettings.loadCSPSettings();

      const checkbox = document.getElementById('conditionalCspEnabled') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
      expect(CSPValidator.initializeFromSettings).toHaveBeenCalled();
    });

    test('should default checkbox to checked when setting is not explicitly false', async () => {
      mockGetSettings.mockResolvedValue({
        conditional_csp_enabled: undefined,
        conditional_csp_providers: [],
      } as any);

      (CSPValidator.getAvailableProviders as vi.Mock).mockReturnValue([]);

      await cspSettings.loadCSPSettings();

      const checkbox = document.getElementById('conditionalCspEnabled') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    test('should uncheck checkbox when setting is explicitly false', async () => {
      mockGetSettings.mockResolvedValue({
        conditional_csp_enabled: false,
        conditional_csp_providers: [],
      } as any);

      (CSPValidator.getAvailableProviders as vi.Mock).mockReturnValue([]);

      await cspSettings.loadCSPSettings();

      const checkbox = document.getElementById('conditionalCspEnabled') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    test('should render provider list from settings', async () => {
      mockGetSettings.mockResolvedValue({
        conditional_csp_enabled: true,
        conditional_csp_providers: ['huggingface'],
      } as any);

      (CSPValidator.getAvailableProviders as vi.Mock).mockReturnValue(['huggingface', 'openrouter']);
      (CSPValidator.getProviderDomain as vi.Mock).mockImplementation((p: string) => {
        if (p === 'huggingface') return 'api-inference.huggingface.co';
        if (p === 'openrouter') return 'api.openrouter.ai';
        return null;
      });

      await cspSettings.loadCSPSettings();

      const container = document.getElementById('cspProviderList');
      expect(container?.children.length).toBe(2);
    });

    test('should log error on load failure', async () => {
      mockAddLog.mockClear();
      mockGetSettings.mockRejectedValue(new Error('Storage error'));

      await cspSettings.loadCSPSettings();

      expect(mockAddLog).toHaveBeenCalledWith('ERROR', 'CSP settings load failed', expect.objectContaining({ error: expect.any(String) }));
    });

    test('should handle missing checkbox element', async () => {
      document.getElementById('conditionalCspEnabled')?.remove();
      mockGetSettings.mockResolvedValue({
        conditional_csp_enabled: true,
        conditional_csp_providers: [],
      } as any);

      (CSPValidator.getAvailableProviders as vi.Mock).mockReturnValue([]);

      // Should not throw
      await cspSettings.loadCSPSettings();
      expect(CSPValidator.initializeFromSettings).toHaveBeenCalled();
    });
  });

  describe('renderProviderList', () => {
    test('should render sorted providers with selected ones first', async () => {
      (CSPValidator.getAvailableProviders as vi.Mock).mockReturnValue(['openrouter', 'huggingface', 'deepinfra']);
      (CSPValidator.getProviderDomain as vi.Mock).mockImplementation((p: string) => {
        const domains: Record<string, string> = {
          'openrouter': 'api.openrouter.ai',
          'huggingface': 'api-inference.huggingface.co',
          'deepinfra': 'deepinfra.com',
        };
        return domains[p] || null;
      });

      await cspSettings.renderProviderList(['deepinfra']);

      const container = document.getElementById('cspProviderList');
      const rows = container?.querySelectorAll('.csp-provider-row');
      expect(rows?.length).toBe(3);
      // Selected 'deepinfra' should be first
      const firstLabel = rows?.[0].querySelector('.csp-provider-label');
      expect(firstLabel?.textContent).toContain('deepinfra');
    });

    test('should skip providers with no domain', async () => {
      (CSPValidator.getAvailableProviders as vi.Mock).mockReturnValue(['huggingface', 'unknown']);
      (CSPValidator.getProviderDomain as vi.Mock).mockImplementation((p: string) => {
        if (p === 'huggingface') return 'api-inference.huggingface.co';
        return null;
      });

      await cspSettings.renderProviderList([]);

      const container = document.getElementById('cspProviderList');
      expect(container?.children.length).toBe(1);
    });

    test('should apply active class to selected providers', async () => {
      (CSPValidator.getAvailableProviders as vi.Mock).mockReturnValue(['huggingface']);
      (CSPValidator.getProviderDomain as vi.Mock).mockReturnValue('api-inference.huggingface.co');

      await cspSettings.renderProviderList(['huggingface']);

      const row = document.querySelector('.csp-provider-row');
      expect(row?.classList.contains('csp-provider-row--active')).toBe(true);

      const checkbox = document.querySelector('.csp-provider-checkbox') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    test('should return early when container not found', async () => {
      document.getElementById('cspProviderList')?.remove();

      // Should not throw
      await cspSettings.renderProviderList(['huggingface']);
      expect(CSPValidator.getAvailableProviders).not.toHaveBeenCalled();
    });

    test('should sort unselected providers alphabetically', async () => {
      (CSPValidator.getAvailableProviders as vi.Mock).mockReturnValue(['deepinfra', 'huggingface', 'openrouter']);
      (CSPValidator.getProviderDomain as vi.Mock).mockImplementation((p: string) => {
        const domains: Record<string, string> = {
          'deepinfra': 'deepinfra.com',
          'huggingface': 'api-inference.huggingface.co',
          'openrouter': 'api.openrouter.ai',
        };
        return domains[p] || null;
      });

      await cspSettings.renderProviderList([]);

      const container = document.getElementById('cspProviderList');
      const labels = container?.querySelectorAll('.csp-provider-label');
      // All unselected, so alphabetical: deepinfra, huggingface, openrouter
      expect(labels?.[0].textContent).toContain('deepinfra');
      expect(labels?.[1].textContent).toContain('huggingface');
      expect(labels?.[2].textContent).toContain('openrouter');
    });
  });

  describe('saveCSPSettings', () => {
    test('should save enabled state and selected providers', async () => {
      const checkbox = document.getElementById('conditionalCspEnabled') as HTMLInputElement;
      checkbox.checked = true;

      const container = document.getElementById('cspProviderList')!;
      container.innerHTML = `
        <div class="csp-provider-row">
          <input type="checkbox" class="csp-provider-checkbox" data-provider="huggingface" checked />
          <label class="csp-provider-label">huggingface</label>
        </div>
        <div class="csp-provider-row">
          <input type="checkbox" class="csp-provider-checkbox" data-provider="openrouter" />
          <label class="csp-provider-label">openrouter</label>
        </div>
      `;

      mockSaveSettings.mockResolvedValue(undefined);
      (CSPValidator.getAvailableProviders as vi.Mock).mockReturnValue([]);

      await cspSettings.saveCSPSettings();

      expect(mockSaveSettings).toHaveBeenCalledWith({
        [StorageKeys.CONDITIONAL_CSP_ENABLED]: true,
        [StorageKeys.CONDITIONAL_CSP_PROVIDERS]: ['huggingface'],
      });
      expect(CSPValidator.reset).toHaveBeenCalled();
      expect(CSPValidator.initializeFromSettings).toHaveBeenCalledWith({
        conditional_csp_enabled: true,
        conditional_csp_providers: ['huggingface'],
      });
    });

    test('should show success message after save', async () => {
      const checkbox = document.getElementById('conditionalCspEnabled') as HTMLInputElement;
      checkbox.checked = true;
      mockSaveSettings.mockResolvedValue(undefined);
      (CSPValidator.getAvailableProviders as vi.Mock).mockReturnValue([]);

      await cspSettings.saveCSPSettings();

      const message = document.getElementById('cspSaveMessage');
      expect(message?.style.display).toBe('block');
    });

    test('should auto-hide success message after 3 seconds', async () => {
      vi.useFakeTimers();
      const checkbox = document.getElementById('conditionalCspEnabled') as HTMLInputElement;
      checkbox.checked = true;
      mockSaveSettings.mockResolvedValue(undefined);
      (CSPValidator.getAvailableProviders as vi.Mock).mockReturnValue([]);

      await cspSettings.saveCSPSettings();

      const message = document.getElementById('cspSaveMessage');
      expect(message?.style.display).toBe('block');

      vi.advanceTimersByTime(3000);
      expect(message?.style.display).toBe('none');
    });

    test('should show inline error message on save failure (no window.alert)', async () => {
      const checkbox = document.getElementById('conditionalCspEnabled') as HTMLInputElement;
      checkbox.checked = true;
      mockSaveSettings.mockRejectedValue(new Error('Save error'));
      mockAddLog.mockClear();

      await cspSettings.saveCSPSettings();

      expect(mockAddLog).toHaveBeenCalledWith('ERROR', 'CSP settings save failed', expect.objectContaining({ error: expect.any(String) }));
      const message = document.getElementById('cspSaveMessage');
      expect(message?.style.display).toBe('block');
      expect(message?.textContent).toBe('cspSaveError');
    });

    test('should default enabled to true when checkbox element missing', async () => {
      document.getElementById('conditionalCspEnabled')?.remove();
      mockSaveSettings.mockResolvedValue(undefined);
      (CSPValidator.getAvailableProviders as vi.Mock).mockReturnValue([]);

      await cspSettings.saveCSPSettings();

      expect(mockSaveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          [StorageKeys.CONDITIONAL_CSP_ENABLED]: true,
        })
      );
    });
  });

  describe('search input binding', () => {
    test('should filter provider rows by search query', async () => {
      mockGetSettings.mockResolvedValue({
        conditional_csp_enabled: true,
        conditional_csp_providers: [],
      } as any);

      (CSPValidator.getAvailableProviders as vi.Mock).mockReturnValue(['huggingface', 'openrouter']);
      (CSPValidator.getProviderDomain as vi.Mock).mockImplementation((p: string) => {
        if (p === 'huggingface') return 'api-inference.huggingface.co';
        if (p === 'openrouter') return 'api.openrouter.ai';
        return null;
      });

      await cspSettings.loadCSPSettings();

      const searchInput = document.getElementById('cspProviderSearch') as HTMLInputElement;
      searchInput.value = 'hugging';
      searchInput.dispatchEvent(new Event('input'));

      const rows = document.querySelectorAll<HTMLElement>('.csp-provider-row');
      expect(rows[0].style.display).toBe('');
      expect(rows[1].style.display).toBe('none');
    });

    test('should handle missing search input gracefully', async () => {
      document.getElementById('cspProviderSearch')?.remove();
      mockGetSettings.mockResolvedValue({
        conditional_csp_enabled: true,
        conditional_csp_providers: [],
      } as any);
      (CSPValidator.getAvailableProviders as vi.Mock).mockReturnValue([]);

      // Should not throw
      await cspSettings.loadCSPSettings();
    });
  });

  describe('save button binding', () => {
    test('should trigger save on click', async () => {
      mockGetSettings.mockResolvedValue({
        conditional_csp_enabled: true,
        conditional_csp_providers: [],
      } as any);
      (CSPValidator.getAvailableProviders as vi.Mock).mockReturnValue([]);
      mockSaveSettings.mockResolvedValue(undefined);

      await cspSettings.loadCSPSettings();

      const saveButton = document.getElementById('cspSaveButton');
      saveButton?.click();

      await new Promise(r => setTimeout(r, 10));
      expect(mockSaveSettings).toHaveBeenCalled();
    });
  });

  describe('reset button binding', () => {
    test('should reset settings when confirmed', async () => {
      mockGetSettings.mockResolvedValue({
        conditional_csp_enabled: true,
        conditional_csp_providers: [],
      } as any);
      (CSPValidator.getAvailableProviders as vi.Mock).mockReturnValue([]);
      mockSaveSettings.mockResolvedValue(undefined);
      (global.confirm as vi.Mock).mockReturnValue(true);

      await cspSettings.loadCSPSettings();

      const resetButton = document.getElementById('cspResetButton');
      resetButton?.click();

      await new Promise(r => setTimeout(r, 10));
      expect(mockSaveSettings).toHaveBeenCalledWith({
        [StorageKeys.CONDITIONAL_CSP_ENABLED]: true,
        [StorageKeys.CONDITIONAL_CSP_PROVIDERS]: [],
      });
    });

    test('should not reset when confirm is rejected', async () => {
      mockGetSettings.mockResolvedValue({
        conditional_csp_enabled: true,
        conditional_csp_providers: [],
      } as any);
      (CSPValidator.getAvailableProviders as vi.Mock).mockReturnValue([]);
      mockSaveSettings.mockClear();
      (global.confirm as vi.Mock).mockReturnValue(false);

      await cspSettings.loadCSPSettings();

      const resetButton = document.getElementById('cspResetButton');
      resetButton?.click();

      await new Promise(r => setTimeout(r, 10));
      expect(mockSaveSettings).not.toHaveBeenCalled();
    });

    test('should show reset success message', async () => {
      mockGetSettings.mockResolvedValue({
        conditional_csp_enabled: true,
        conditional_csp_providers: [],
      } as any);
      (CSPValidator.getAvailableProviders as vi.Mock).mockReturnValue([]);
      mockSaveSettings.mockResolvedValue(undefined);
      (global.confirm as vi.Mock).mockReturnValue(true);

      await cspSettings.loadCSPSettings();

      const resetButton = document.getElementById('cspResetButton');
      resetButton?.click();

      // Allow async operations to complete
      await new Promise(r => setTimeout(r, 10));

      const message = document.getElementById('cspResetMessage');
      expect(message?.style.display).toBe('block');
    });

    test('should auto-hide reset message after 3 seconds', async () => {
      vi.useFakeTimers();
      mockGetSettings.mockResolvedValue({
        conditional_csp_enabled: true,
        conditional_csp_providers: [],
      } as any);
      (CSPValidator.getAvailableProviders as vi.Mock).mockReturnValue([]);
      mockSaveSettings.mockResolvedValue(undefined);
      (global.confirm as vi.Mock).mockReturnValue(true);
      (window as unknown as { confirm: unknown }).confirm = global.confirm;

      await cspSettings.loadCSPSettings();

      const resetButton = document.getElementById('cspResetButton');
      resetButton?.click();

      // Flush async chain including SettingsRepository shim's dynamic imports;
      // advanceTimersByTimeAsync(0) alone is not enough when the shim does
      // await import(), so wait for the message to appear.
      await vi.waitFor(async () => {
        // Advance timers to flush the import() promise microtasks
        await vi.advanceTimersByTimeAsync(10);
        const msg = document.getElementById('cspResetMessage');
        expect(msg?.style.display).toBe('block');
      }, { timeout: 2000 });

      const message = document.getElementById('cspResetMessage');
      await vi.advanceTimersByTimeAsync(3000);
      expect(message?.style.display).toBe('none');
    });

    test('should show inline error message on reset failure (no window.alert)', async () => {
      mockGetSettings.mockResolvedValue({
        conditional_csp_enabled: true,
        conditional_csp_providers: [],
      } as any);
      (CSPValidator.getAvailableProviders as vi.Mock).mockReturnValue([]);
      mockSaveSettings.mockRejectedValue(new Error('Reset error'));
      (global.confirm as vi.Mock).mockReturnValue(true);
      mockAddLog.mockClear();

      await cspSettings.loadCSPSettings();

      const resetButton = document.getElementById('cspResetButton');
      resetButton?.click();

      await new Promise(r => setTimeout(r, 10));

      expect(mockAddLog).toHaveBeenCalledWith('ERROR', 'CSP settings reset failed', expect.objectContaining({ error: expect.any(String) }));
      const message = document.getElementById('cspResetMessage');
      expect(message?.style.display).toBe('block');
      expect(message?.textContent).toBe('cspResetError');
    });
  });

  describe('requestProviderPermission (static — DOM-independent utility)', () => {
    test('should return false for unknown provider', async () => {
      (CSPValidator.getProviderDomain as vi.Mock).mockReturnValue(null);
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await CspSettingsController.requestProviderPermission('nonexistent');

      expect(result).toBe(false);
      expect(chrome.permissions.request).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test('should handle permission request error', async () => {
      (CSPValidator.getProviderDomain as vi.Mock).mockReturnValue('api-inference.huggingface.co');
      (chrome.permissions.request as vi.Mock).mockRejectedValue(new Error('Permission denied'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await CspSettingsController.requestProviderPermission('huggingface');

      expect(result).toBe(false);
      consoleSpy.mockRestore();
    });

    test('should handle non-true grant value', async () => {
      (CSPValidator.getProviderDomain as vi.Mock).mockReturnValue('api-inference.huggingface.co');
      (chrome.permissions.request as vi.Mock).mockResolvedValue(undefined);

      const result = await CspSettingsController.requestProviderPermission('huggingface');

      expect(result).toBe(false);
    });
  });

  describe('requestEssentialPermission (static — DOM-independent utility)', () => {
    test('should handle permission request error', async () => {
      (chrome.permissions.request as vi.Mock).mockRejectedValue(new Error('Permission denied'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await CspSettingsController.requestEssentialPermission('github-raw');

      expect(result).toBe(false);
      consoleSpy.mockRestore();
    });

    test('should return false for unknown essential type', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await CspSettingsController.requestEssentialPermission('unknown-type');

      expect(result).toBe(false);
      expect(chrome.permissions.request).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('hasPermission (static — DOM-independent utility)', () => {
    test('should return false for unknown provider', async () => {
      (CSPValidator.getProviderDomain as vi.Mock).mockReturnValue(null);

      const result = await CspSettingsController.hasPermission('unknown');

      expect(result).toBe(false);
      expect(chrome.permissions.contains).not.toHaveBeenCalled();
    });

    test('should return false when permission check throws', async () => {
      (CSPValidator.getProviderDomain as vi.Mock).mockReturnValue('api-inference.huggingface.co');
      (chrome.permissions.contains as vi.Mock).mockRejectedValue(new Error('Check failed'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await CspSettingsController.hasPermission('huggingface');

      expect(result).toBe(false);
      consoleSpy.mockRestore();
    });

    test('should return false when contains returns non-true', async () => {
      (CSPValidator.getProviderDomain as vi.Mock).mockReturnValue('api-inference.huggingface.co');
      (chrome.permissions.contains as vi.Mock).mockResolvedValue(undefined);

      const result = await CspSettingsController.hasPermission('huggingface');

      expect(result).toBe(false);
    });
  });
});
