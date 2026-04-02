/**
 * @jest-environment jsdom
 */

/**
 * cspSettings.test.ts
 * Unit tests for CSPSettings class
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

// Mock dependencies before importing CSPSettings
jest.mock('../../utils/storage.js', () => ({
  StorageKeys: {
    CONDITIONAL_CSP_ENABLED: 'conditional_csp_enabled',
    CONDITIONAL_CSP_PROVIDERS: 'conditional_csp_providers',
  },
  getSettings: jest.fn(),
  saveSettings: jest.fn(),
}));

jest.mock('../../utils/cspValidator.js', () => ({
  CSPValidator: {
    initializeFromSettings: jest.fn(),
    getAvailableProviders: jest.fn(),
    getProviderDomain: jest.fn(),
    reset: jest.fn(),
  },
}));

import { CSPSettings } from '../cspSettings.js';
import { getSettings, saveSettings, StorageKeys } from '../../utils/storage.js';
import { CSPValidator } from '../../utils/cspValidator.js';

const mockGetSettings = getSettings as jest.MockedFunction<typeof getSettings>;
const mockSaveSettings = saveSettings as jest.MockedFunction<typeof saveSettings>;

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

describe('CSPSettings', () => {
  beforeEach(() => {
    setupDOM();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('loadCSPSettings', () => {
    test('should load settings and set checkbox state', async () => {
      mockGetSettings.mockResolvedValue({
        conditional_csp_enabled: true,
        conditional_csp_providers: ['huggingface'],
      } as any);

      (CSPValidator.getAvailableProviders as jest.Mock).mockReturnValue([]);

      await CSPSettings.loadCSPSettings();

      const checkbox = document.getElementById('conditionalCspEnabled') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
      expect(CSPValidator.initializeFromSettings).toHaveBeenCalled();
    });

    test('should default checkbox to checked when setting is not explicitly false', async () => {
      mockGetSettings.mockResolvedValue({
        conditional_csp_enabled: undefined,
        conditional_csp_providers: [],
      } as any);

      (CSPValidator.getAvailableProviders as jest.Mock).mockReturnValue([]);

      await CSPSettings.loadCSPSettings();

      const checkbox = document.getElementById('conditionalCspEnabled') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    test('should uncheck checkbox when setting is explicitly false', async () => {
      mockGetSettings.mockResolvedValue({
        conditional_csp_enabled: false,
        conditional_csp_providers: [],
      } as any);

      (CSPValidator.getAvailableProviders as jest.Mock).mockReturnValue([]);

      await CSPSettings.loadCSPSettings();

      const checkbox = document.getElementById('conditionalCspEnabled') as HTMLInputElement;
      expect(checkbox.checked).toBe(false);
    });

    test('should render provider list from settings', async () => {
      mockGetSettings.mockResolvedValue({
        conditional_csp_enabled: true,
        conditional_csp_providers: ['huggingface'],
      } as any);

      (CSPValidator.getAvailableProviders as jest.Mock).mockReturnValue(['huggingface', 'openrouter']);
      (CSPValidator.getProviderDomain as jest.Mock).mockImplementation((p: string) => {
        if (p === 'huggingface') return 'api-inference.huggingface.co';
        if (p === 'openrouter') return 'api.openrouter.ai';
        return null;
      });

      await CSPSettings.loadCSPSettings();

      const container = document.getElementById('cspProviderList');
      expect(container?.children.length).toBe(2);
    });

    test('should log error on load failure', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockGetSettings.mockRejectedValue(new Error('Storage error'));

      await CSPSettings.loadCSPSettings();

      expect(consoleSpy).toHaveBeenCalledWith('CSP settings load failed:', expect.any(Error));
      consoleSpy.mockRestore();
    });

    test('should handle missing checkbox element', async () => {
      document.getElementById('conditionalCspEnabled')?.remove();
      mockGetSettings.mockResolvedValue({
        conditional_csp_enabled: true,
        conditional_csp_providers: [],
      } as any);

      (CSPValidator.getAvailableProviders as jest.Mock).mockReturnValue([]);

      // Should not throw
      await CSPSettings.loadCSPSettings();
      expect(CSPValidator.initializeFromSettings).toHaveBeenCalled();
    });
  });

  describe('renderProviderList', () => {
    test('should render sorted providers with selected ones first', async () => {
      (CSPValidator.getAvailableProviders as jest.Mock).mockReturnValue(['openrouter', 'huggingface', 'deepinfra']);
      (CSPValidator.getProviderDomain as jest.Mock).mockImplementation((p: string) => {
        const domains: Record<string, string> = {
          'openrouter': 'api.openrouter.ai',
          'huggingface': 'api-inference.huggingface.co',
          'deepinfra': 'deepinfra.com',
        };
        return domains[p] || null;
      });

      await CSPSettings.renderProviderList(['deepinfra']);

      const container = document.getElementById('cspProviderList');
      const rows = container?.querySelectorAll('.csp-provider-row');
      expect(rows?.length).toBe(3);
      // Selected 'deepinfra' should be first
      const firstLabel = rows?.[0].querySelector('.csp-provider-label');
      expect(firstLabel?.textContent).toContain('deepinfra');
    });

    test('should skip providers with no domain', async () => {
      (CSPValidator.getAvailableProviders as jest.Mock).mockReturnValue(['huggingface', 'unknown']);
      (CSPValidator.getProviderDomain as jest.Mock).mockImplementation((p: string) => {
        if (p === 'huggingface') return 'api-inference.huggingface.co';
        return null;
      });

      await CSPSettings.renderProviderList([]);

      const container = document.getElementById('cspProviderList');
      expect(container?.children.length).toBe(1);
    });

    test('should apply active class to selected providers', async () => {
      (CSPValidator.getAvailableProviders as jest.Mock).mockReturnValue(['huggingface']);
      (CSPValidator.getProviderDomain as jest.Mock).mockReturnValue('api-inference.huggingface.co');

      await CSPSettings.renderProviderList(['huggingface']);

      const row = document.querySelector('.csp-provider-row');
      expect(row?.classList.contains('csp-provider-row--active')).toBe(true);

      const checkbox = document.querySelector('.csp-provider-checkbox') as HTMLInputElement;
      expect(checkbox.checked).toBe(true);
    });

    test('should return early when container not found', async () => {
      document.getElementById('cspProviderList')?.remove();

      // Should not throw
      await CSPSettings.renderProviderList(['huggingface']);
      expect(CSPValidator.getAvailableProviders).not.toHaveBeenCalled();
    });

    test('should sort unselected providers alphabetically', async () => {
      (CSPValidator.getAvailableProviders as jest.Mock).mockReturnValue(['deepinfra', 'huggingface', 'openrouter']);
      (CSPValidator.getProviderDomain as jest.Mock).mockImplementation((p: string) => {
        const domains: Record<string, string> = {
          'deepinfra': 'deepinfra.com',
          'huggingface': 'api-inference.huggingface.co',
          'openrouter': 'api.openrouter.ai',
        };
        return domains[p] || null;
      });

      await CSPSettings.renderProviderList([]);

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
      (CSPValidator.getAvailableProviders as jest.Mock).mockReturnValue([]);

      await CSPSettings.saveCSPSettings();

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
      (CSPValidator.getAvailableProviders as jest.Mock).mockReturnValue([]);

      await CSPSettings.saveCSPSettings();

      const message = document.getElementById('cspSaveMessage');
      expect(message?.style.display).toBe('block');
    });

    test('should auto-hide success message after 3 seconds', async () => {
      jest.useFakeTimers();
      const checkbox = document.getElementById('conditionalCspEnabled') as HTMLInputElement;
      checkbox.checked = true;
      mockSaveSettings.mockResolvedValue(undefined);
      (CSPValidator.getAvailableProviders as jest.Mock).mockReturnValue([]);

      await CSPSettings.saveCSPSettings();

      const message = document.getElementById('cspSaveMessage');
      expect(message?.style.display).toBe('block');

      jest.advanceTimersByTime(3000);
      expect(message?.style.display).toBe('none');
    });

    test('should handle save error with alert', async () => {
      const checkbox = document.getElementById('conditionalCspEnabled') as HTMLInputElement;
      checkbox.checked = true;
      mockSaveSettings.mockRejectedValue(new Error('Save error'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await CSPSettings.saveCSPSettings();

      expect(consoleSpy).toHaveBeenCalledWith('CSP settings save failed:', expect.any(Error));
      expect(alert).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test('should default enabled to true when checkbox element missing', async () => {
      document.getElementById('conditionalCspEnabled')?.remove();
      mockSaveSettings.mockResolvedValue(undefined);
      (CSPValidator.getAvailableProviders as jest.Mock).mockReturnValue([]);

      await CSPSettings.saveCSPSettings();

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

      (CSPValidator.getAvailableProviders as jest.Mock).mockReturnValue(['huggingface', 'openrouter']);
      (CSPValidator.getProviderDomain as jest.Mock).mockImplementation((p: string) => {
        if (p === 'huggingface') return 'api-inference.huggingface.co';
        if (p === 'openrouter') return 'api.openrouter.ai';
        return null;
      });

      await CSPSettings.loadCSPSettings();

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
      (CSPValidator.getAvailableProviders as jest.Mock).mockReturnValue([]);

      // Should not throw
      await CSPSettings.loadCSPSettings();
    });
  });

  describe('save button binding', () => {
    test('should trigger save on click', async () => {
      mockGetSettings.mockResolvedValue({
        conditional_csp_enabled: true,
        conditional_csp_providers: [],
      } as any);
      (CSPValidator.getAvailableProviders as jest.Mock).mockReturnValue([]);
      mockSaveSettings.mockResolvedValue(undefined);

      await CSPSettings.loadCSPSettings();

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
      (CSPValidator.getAvailableProviders as jest.Mock).mockReturnValue([]);
      mockSaveSettings.mockResolvedValue(undefined);
      (global.confirm as jest.Mock).mockReturnValue(true);

      await CSPSettings.loadCSPSettings();

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
      (CSPValidator.getAvailableProviders as jest.Mock).mockReturnValue([]);
      mockSaveSettings.mockClear();
      (global.confirm as jest.Mock).mockReturnValue(false);

      await CSPSettings.loadCSPSettings();

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
      (CSPValidator.getAvailableProviders as jest.Mock).mockReturnValue([]);
      mockSaveSettings.mockResolvedValue(undefined);
      (global.confirm as jest.Mock).mockReturnValue(true);

      await CSPSettings.loadCSPSettings();

      const resetButton = document.getElementById('cspResetButton');
      resetButton?.click();

      // Allow async operations to complete
      await new Promise(r => setTimeout(r, 10));

      const message = document.getElementById('cspResetMessage');
      expect(message?.style.display).toBe('block');
    });

    test('should auto-hide reset message after 3 seconds', async () => {
      jest.useFakeTimers();
      mockGetSettings.mockResolvedValue({
        conditional_csp_enabled: true,
        conditional_csp_providers: [],
      } as any);
      (CSPValidator.getAvailableProviders as jest.Mock).mockReturnValue([]);
      mockSaveSettings.mockResolvedValue(undefined);
      (global.confirm as jest.Mock).mockReturnValue(true);

      await CSPSettings.loadCSPSettings();

      const resetButton = document.getElementById('cspResetButton');
      resetButton?.click();

      // With fake timers, flush microtasks then advance timers
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const message = document.getElementById('cspResetMessage');
      expect(message?.style.display).toBe('block');

      jest.advanceTimersByTime(3000);
      expect(message?.style.display).toBe('none');
    });

    test('should handle reset error with alert', async () => {
      mockGetSettings.mockResolvedValue({
        conditional_csp_enabled: true,
        conditional_csp_providers: [],
      } as any);
      (CSPValidator.getAvailableProviders as jest.Mock).mockReturnValue([]);
      mockSaveSettings.mockRejectedValue(new Error('Reset error'));
      (global.confirm as jest.Mock).mockReturnValue(true);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await CSPSettings.loadCSPSettings();

      const resetButton = document.getElementById('cspResetButton');
      resetButton?.click();

      await new Promise(r => setTimeout(r, 10));

      expect(consoleSpy).toHaveBeenCalledWith('CSP settings reset failed:', expect.any(Error));
      expect(alert).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('requestProviderPermission', () => {
    test('should return false for unknown provider', async () => {
      (CSPValidator.getProviderDomain as jest.Mock).mockReturnValue(null);
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await CSPSettings.requestProviderPermission('nonexistent');

      expect(result).toBe(false);
      expect(chrome.permissions.request).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test('should handle permission request error', async () => {
      (CSPValidator.getProviderDomain as jest.Mock).mockReturnValue('api-inference.huggingface.co');
      (chrome.permissions.request as jest.Mock).mockRejectedValue(new Error('Permission denied'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await CSPSettings.requestProviderPermission('huggingface');

      expect(result).toBe(false);
      consoleSpy.mockRestore();
    });

    test('should handle non-true grant value', async () => {
      (CSPValidator.getProviderDomain as jest.Mock).mockReturnValue('api-inference.huggingface.co');
      (chrome.permissions.request as jest.Mock).mockResolvedValue(undefined);

      const result = await CSPSettings.requestProviderPermission('huggingface');

      expect(result).toBe(false);
    });
  });

  describe('requestEssentialPermission', () => {
    test('should handle permission request error', async () => {
      (chrome.permissions.request as jest.Mock).mockRejectedValue(new Error('Permission denied'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await CSPSettings.requestEssentialPermission('github-raw');

      expect(result).toBe(false);
      consoleSpy.mockRestore();
    });

    test('should return false for unknown essential type', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await CSPSettings.requestEssentialPermission('unknown-type');

      expect(result).toBe(false);
      expect(chrome.permissions.request).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('hasPermission', () => {
    test('should return false for unknown provider', async () => {
      (CSPValidator.getProviderDomain as jest.Mock).mockReturnValue(null);

      const result = await CSPSettings.hasPermission('unknown');

      expect(result).toBe(false);
      expect(chrome.permissions.contains).not.toHaveBeenCalled();
    });

    test('should return false when permission check throws', async () => {
      (CSPValidator.getProviderDomain as jest.Mock).mockReturnValue('api-inference.huggingface.co');
      (chrome.permissions.contains as jest.Mock).mockRejectedValue(new Error('Check failed'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const result = await CSPSettings.hasPermission('huggingface');

      expect(result).toBe(false);
      consoleSpy.mockRestore();
    });

    test('should return false when contains returns non-true', async () => {
      (CSPValidator.getProviderDomain as jest.Mock).mockReturnValue('api-inference.huggingface.co');
      (chrome.permissions.contains as jest.Mock).mockResolvedValue(undefined);

      const result = await CSPSettings.hasPermission('huggingface');

      expect(result).toBe(false);
    });
  });
});

describe('escapeRegExp', () => {
  // Import directly for unit testing
  let escapeRegExp: (s: string) => string;

  beforeAll(async () => {
    // Dynamic import to get the exported function
    const mod = await import('../cspSettings.js');
    escapeRegExp = mod.escapeRegExp;
  });

  test('escapes regex special characters', () => {
    expect(escapeRegExp('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o')).toBe('a\\.b\\*c\\+d\\?e\\^f\\$g\\{h\\}i\\(j\\)k\\|l\\[m\\]n\\\\o');
  });

  test('returns string unchanged when no special characters', () => {
    expect(escapeRegExp('hello-world_123')).toBe('hello-world_123');
  });

  test('handles empty string', () => {
    expect(escapeRegExp('')).toBe('');
  });
});

describe('i18n with placeholders', () => {
  let i18n: (key: string, placeholders?: Record<string, string>) => string;

  beforeAll(async () => {
    const mod = await import('../cspSettings.js');
    i18n = mod.i18n;
  });

  test('returns message without placeholders', () => {
    (chrome.i18n.getMessage as jest.Mock).mockReturnValue('Simple message');
    expect(i18n('testKey')).toBe('Simple message');
  });

  test('replaces placeholders in message', () => {
    (chrome.i18n.getMessage as jest.Mock).mockReturnValue('Hello ${name}, you have ${count} items');
    const result = i18n('greeting', { name: 'Alice', count: '5' });
    expect(result).toBe('Hello Alice, you have 5 items');
  });

  test('handles placeholder with regex special characters', () => {
    (chrome.i18n.getMessage as jest.Mock).mockReturnValue('Price: ${price}');
    const result = i18n('price', { price: '$100.00' });
    expect(result).toBe('Price: $100.00');
  });
});
