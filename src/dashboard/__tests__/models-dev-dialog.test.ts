// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock data defined before vi.mock calls
const mockProviders = [
  {
    id: 'openai',
    name: 'OpenAI',
    api: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4', isFreeTier: false, inputPrice: 0.01 },
      { id: 'gpt-3.5-turbo', isFreeTier: false, inputPrice: 0.001 },
    ],
    isAggregator: false,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    api: 'https://openrouter.ai/api/v1',
    models: [
      { id: 'gpt-4', isFreeTier: true, inputPrice: null },
      { id: 'free-model', isFreeTier: true, inputPrice: null },
    ],
    isAggregator: true,
  },
];

vi.mock('../../utils/modelsDevApi.js', () => ({
  loadModelsDevData: vi.fn().mockResolvedValue({ providers: mockProviders }),
  formatContextLimit: vi.fn().mockReturnValue('8K'),
  getApiKeyEnvName: vi.fn().mockImplementation((id: string) => `MOCK_${id.toUpperCase()}_KEY`),
}));

vi.mock('../../utils/storage.js', () => ({
  StorageKeys: {
    AI_PROVIDER: 'ai_provider',
    PROVIDER_TYPE: 'provider_type',
    PROVIDER_BASE_URL: 'provider_base_url',
    PROVIDER_API_KEY: 'provider_api_key',
    PROVIDER_MODEL: 'provider_model',
  },
  getSettings: vi.fn().mockResolvedValue({}),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../popup/i18n.js', () => ({
  applyI18n: vi.fn(),
  getMessage: vi.fn((key) => key),
}));

describe('models-dev-dialog exports', () => {
  it('should export ModelsDevDialog class', async () => {
    const module = await import('../models-dev-dialog.js');
    expect(module.ModelsDevDialog).toBeDefined();
  });
});

describe('ModelsDevDialog', () => {
  let ModelsDevDialog: typeof import('../models-dev-dialog.js').ModelsDevDialog;

  beforeEach(async () => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    const module = await import('../models-dev-dialog.js');
    ModelsDevDialog = module.ModelsDevDialog;
  });

  describe('constructor and options', () => {
    it('should create dialog with default options', async () => {
      const dialog = new ModelsDevDialog();
      expect(dialog).toBeDefined();
    });

    it('should accept onSave callback in options', async () => {
      const onSave = vi.fn();
      const dialog = new ModelsDevDialog({ onSave });
      expect(dialog).toBeDefined();
    });
  });

  describe('show', () => {
    it('should create and show dialog', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();

      expect(document.getElementById('models-dev-dialog')).not.toBeNull();
    });
  });

  describe('hide', () => {
    it('should hide dialog', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      dialog.hide();

      const dialogEl = document.getElementById('models-dev-dialog');
      expect(dialogEl?.classList.contains('hidden')).toBe(true);
    });

    it('should call onCancel callback on hide', async () => {
      const onCancel = vi.fn();
      const dialog = new ModelsDevDialog({ onCancel });
      await dialog.show();
      dialog.hide();
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('dialog attributes and structure', () => {
    it('should create overlay with correct ARIA attributes', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const overlay = document.getElementById('models-dev-dialog');
      expect(overlay!.getAttribute('role')).toBe('dialog');
      expect(overlay!.getAttribute('aria-modal')).toBe('true');
      expect(overlay!.getAttribute('aria-labelledby')).toBe('dialog-title');
    });

    it('should create all required child elements', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      expect(document.getElementById('dialog-title')).not.toBeNull();
      expect(document.getElementById('dialog-close')).not.toBeNull();
      expect(document.getElementById('dialog-cancel')).not.toBeNull();
      expect(document.getElementById('dialog-save')).not.toBeNull();
      expect(document.getElementById('provider-list')).not.toBeNull();
      expect(document.getElementById('provider-count')).not.toBeNull();
      expect(document.getElementById('dialog-loading')).not.toBeNull();
      expect(document.getElementById('dialog-error')).not.toBeNull();
      expect(document.getElementById('provider-search')).not.toBeNull();
      expect(document.getElementById('filter-free-tier')).not.toBeNull();
      expect(document.getElementById('api-key-input')).not.toBeNull();
      expect(document.getElementById('model-input')).not.toBeNull();
      expect(document.getElementById('selected-provider-info')).not.toBeNull();
      expect(document.getElementById('selected-provider-name')).not.toBeNull();
      expect(document.getElementById('selected-model-name')).not.toBeNull();
    });

    it('should have correct tab buttons with data-tab attributes', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const tabAll = document.getElementById('tab-all');
      const tabAgg = document.getElementById('tab-aggregators');
      const tabOthers = document.getElementById('tab-others');
      expect(tabAll).not.toBeNull();
      expect(tabAgg).not.toBeNull();
      expect(tabOthers).not.toBeNull();
      expect(tabAll!.getAttribute('data-tab')).toBe('all');
      expect(tabAgg!.getAttribute('data-tab')).toBe('aggregators');
      expect(tabOthers!.getAttribute('data-tab')).toBe('others');
    });

    it('should start with All tab active', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const tabAll = document.getElementById('tab-all');
      expect(tabAll!.classList.contains('active')).toBe(true);
    });
  });

  describe('show loading and error states', () => {
    it('should show loading state and hide after providers loaded', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const loadingEl = document.getElementById('dialog-loading');
      expect(loadingEl!.classList.contains('hidden')).toBe(true);
    });

    it('should display error on loadModelsDevData failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mod = await import('../../utils/modelsDevApi.js');
      (mod.loadModelsDevData as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Network error'));
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const errorEl = document.getElementById('dialog-error');
      expect(errorEl!.classList.contains('hidden')).toBe(false);
      expect(errorEl!.textContent).toBe('Failed to load providers. Please try again.');
      const loadingEl = document.getElementById('dialog-loading');
      expect(loadingEl!.classList.contains('hidden')).toBe(true);
      consoleSpy.mockRestore();
    });

    it('should display error when loadModelsDevData returns null', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mod = await import('../../utils/modelsDevApi.js');
      (mod.loadModelsDevData as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const errorEl = document.getElementById('dialog-error');
      expect(errorEl!.classList.contains('hidden')).toBe(false);
      consoleSpy.mockRestore();
    });
  });

  describe('filterProviders - tab switching', () => {
    it('should show all providers on All tab', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const providerItems = document.querySelectorAll('.provider-item');
      expect(providerItems.length).toBe(2);
    });

    it('should show only aggregators on Aggregators tab', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      document.getElementById('tab-aggregators')?.click();
      const providerItems = document.querySelectorAll('.provider-item');
      expect(providerItems.length).toBe(1);
      expect(providerItems[0]!.textContent).toContain('OpenRouter');
    });

    it('should show only non-aggregators on Others tab', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      document.getElementById('tab-others')?.click();
      const providerItems = document.querySelectorAll('.provider-item');
      expect(providerItems.length).toBe(1);
      expect(providerItems[0]!.textContent).toContain('OpenAI');
    });

    it('should toggle tab active state when switching', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      document.getElementById('tab-aggregators')?.click();
      expect(document.getElementById('tab-all')!.classList.contains('active')).toBe(false);
      expect(document.getElementById('tab-aggregators')!.classList.contains('active')).toBe(true);
      expect(document.getElementById('tab-others')!.classList.contains('active')).toBe(false);
      expect(document.getElementById('tab-aggregators')!.getAttribute('aria-selected')).toBe('true');
      expect(document.getElementById('tab-all')!.getAttribute('aria-selected')).toBe('false');
    });
  });

  describe('filterProviders - search and free tier', () => {
    it('should filter providers by search name', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const searchInput = document.getElementById('provider-search') as HTMLInputElement;
      searchInput.value = 'openrouter';
      searchInput.dispatchEvent(new Event('input'));
      const providerItems = document.querySelectorAll('.provider-item');
      expect(providerItems.length).toBe(1);
      expect(providerItems[0]!.textContent).toContain('OpenRouter');
    });

    it('should filter providers by search id', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const searchInput = document.getElementById('provider-search') as HTMLInputElement;
      searchInput.value = 'openai';
      searchInput.dispatchEvent(new Event('input'));
      const providerItems = document.querySelectorAll('.provider-item');
      expect(providerItems.length).toBe(1);
      expect(providerItems[0]!.textContent).toContain('OpenAI');
    });

    it('should show all providers with empty search', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const searchInput = document.getElementById('provider-search') as HTMLInputElement;
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input'));
      const providerItems = document.querySelectorAll('.provider-item');
      expect(providerItems.length).toBe(2);
    });

    it('should show no providers when search matches nothing', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const searchInput = document.getElementById('provider-search') as HTMLInputElement;
      searchInput.value = 'nonexistent';
      searchInput.dispatchEvent(new Event('input'));
      const providerItems = document.querySelectorAll('.provider-item');
      expect(providerItems.length).toBe(0);
    });

    it('should filter by free tier only', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const checkbox = document.getElementById('filter-free-tier') as HTMLInputElement;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
      const providerItems = document.querySelectorAll('.provider-item');
      expect(providerItems.length).toBe(1);
      expect(providerItems[0]!.textContent).toContain('OpenRouter');
    });

    it('should apply multiple filters together', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      document.getElementById('tab-aggregators')?.click();
      const searchInput = document.getElementById('provider-search') as HTMLInputElement;
      searchInput.value = 'openrouter';
      searchInput.dispatchEvent(new Event('input'));
      const providerItems = document.querySelectorAll('.provider-item');
      expect(providerItems.length).toBe(1);
    });
  });

  describe('renderProviders', () => {
    it('should render provider name, model count, and pricing', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const firstItem = document.querySelector('.provider-item');
      expect(firstItem!.textContent).toContain('OpenAI');
      expect(firstItem!.textContent).toContain('2 models');
      expect(firstItem!.textContent).toContain('$0.01/M input');
    });

    it('should show Aggregator badge for aggregator providers', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const items = document.querySelectorAll('.provider-item');
      expect(items[1]!.innerHTML).toContain('badge-aggregator');
      expect(items[1]!.textContent).toContain('Aggregator');

      const firstItem = items[0]!;
      expect(firstItem.innerHTML).not.toContain('badge-aggregator');
    });

    it('should show Free tier available for providers with null-priced models', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const items = document.querySelectorAll('.provider-item');
      expect(items[1]!.textContent).toContain('Free tier available');
    });

    it('should update provider count text', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const countEl = document.getElementById('provider-count');
      expect(countEl!.textContent).toBe('2 providers');
    });

    it('should render selected class on previously selected provider', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const items = document.querySelectorAll('.provider-item');
      (items[0] as HTMLElement).click();
      (items[1] as HTMLElement).click();
      expect(items[0]!.classList.contains('selected')).toBe(false);
      expect(items[1]!.classList.contains('selected')).toBe(true);
    });

    it('should keep selected class after re-render via filter', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const items = document.querySelectorAll('.provider-item');
      (items[0] as HTMLElement).click();
      const searchInput = document.getElementById('provider-search') as HTMLInputElement;
      searchInput.value = 'openai';
      searchInput.dispatchEvent(new Event('input'));
      const updatedItems = document.querySelectorAll('.provider-item');
      expect(updatedItems.length).toBe(1);
      expect(updatedItems[0]!.classList.contains('selected')).toBe(true);
    });
  });

  describe('selectProvider', () => {
    it('should show selected provider info when provider is clicked', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const items = document.querySelectorAll('.provider-item');
      (items[0] as HTMLElement).click();
      const selectedInfo = document.getElementById('selected-provider-info');
      expect(selectedInfo!.classList.contains('hidden')).toBe(false);
      const selectedName = document.getElementById('selected-provider-name');
      expect(selectedName!.textContent).toBe('OpenAI');
    });

    it('should update API key placeholder on provider selection', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const items = document.querySelectorAll('.provider-item');
      (items[0] as HTMLElement).click();
      const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
      expect(apiKeyInput.placeholder).toContain('MOCK_OPENAI_KEY');
    });

    it('should display env variable name in selected model area', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const items = document.querySelectorAll('.provider-item');
      (items[0] as HTMLElement).click();
      const selectedModelEl = document.getElementById('selected-model-name');
      expect(selectedModelEl!.textContent).toContain('Env: MOCK_OPENAI_KEY');
    });
  });

  describe('save', () => {
    it('should show error when no provider selected', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      document.getElementById('dialog-save')?.click();
      const errorEl = document.getElementById('dialog-error');
      expect(errorEl!.classList.contains('hidden')).toBe(false);
      expect(errorEl!.textContent).toBe('Please select a provider');
    });

    it('should show error when API key is empty', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const items = document.querySelectorAll('.provider-item');
      (items[0] as HTMLElement).click();
      document.getElementById('dialog-save')?.click();
      const errorEl = document.getElementById('dialog-error');
      expect(errorEl!.classList.contains('hidden')).toBe(false);
      expect(errorEl!.textContent).toBe('Please enter your API key');
    });

    it('should save settings and call onSave callback', async () => {
      const onSave = vi.fn();
      const dialog = new ModelsDevDialog({ onSave });
      await dialog.show();
      const items = document.querySelectorAll('.provider-item');
      (items[0] as HTMLElement).click();
      const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
      apiKeyInput.value = 'test-key-123';
      document.getElementById('dialog-save')?.click();
      await vi.waitFor(() => {
        expect(onSave).toHaveBeenCalled();
      });
      expect(onSave).toHaveBeenCalledWith('openai', 'https://api.openai.com/v1', 'test-key-123', '');
    });

    it('should hide dialog on successful save', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const items = document.querySelectorAll('.provider-item');
      (items[0] as HTMLElement).click();
      const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
      apiKeyInput.value = 'test-key';
      document.getElementById('dialog-save')?.click();
      await vi.waitFor(() => {
        expect(document.getElementById('models-dev-dialog')!.classList.contains('hidden')).toBe(true);
      });
    });

    it('should show error on saveSettings rejection', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const storageMod = await import('../../utils/storage.js');
      (storageMod.saveSettings as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB error'));
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const items = document.querySelectorAll('.provider-item');
      (items[0] as HTMLElement).click();
      const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
      apiKeyInput.value = 'test-key';
      document.getElementById('dialog-save')?.click();
      await vi.waitFor(() => {
        const errorEl = document.getElementById('dialog-error');
        expect(errorEl!.classList.contains('hidden')).toBe(false);
        expect(errorEl!.textContent).toBe('Failed to save settings');
      });
      consoleSpy.mockRestore();
    });
  });

  describe('showError timeout', () => {
    it('should hide error message after 5 seconds', async () => {
      vi.useFakeTimers();
      const dialog = new ModelsDevDialog();
      await dialog.show();
      document.getElementById('dialog-save')?.click();
      const errorEl = document.getElementById('dialog-error');
      expect(errorEl!.classList.contains('hidden')).toBe(false);
      vi.advanceTimersByTime(5000);
      expect(errorEl!.classList.contains('hidden')).toBe(true);
      vi.useRealTimers();
    });
  });

  describe('event listeners', () => {
    it('close button should hide dialog', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      document.getElementById('dialog-close')?.click();
      expect(document.getElementById('models-dev-dialog')!.classList.contains('hidden')).toBe(true);
    });

    it('cancel button should hide dialog', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      document.getElementById('dialog-cancel')?.click();
      expect(document.getElementById('models-dev-dialog')!.classList.contains('hidden')).toBe(true);
    });

    it('save button should call save method', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      document.getElementById('dialog-save')?.click();
      const errorEl = document.getElementById('dialog-error');
      expect(errorEl!.classList.contains('hidden')).toBe(false);
      expect(errorEl!.textContent).toBe('Please select a provider');
    });

    it('tab buttons should switch tabs', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      document.getElementById('tab-aggregators')?.click();
      const providerItems = document.querySelectorAll('.provider-item');
      expect(providerItems.length).toBe(1);
    });

    it('search input should filter providers', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const searchInput = document.getElementById('provider-search') as HTMLInputElement;
      searchInput.value = 'openai';
      searchInput.dispatchEvent(new Event('input'));
      const providerItems = document.querySelectorAll('.provider-item');
      expect(providerItems.length).toBe(1);
    });

    it('free tier checkbox should filter providers', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const checkbox = document.getElementById('filter-free-tier') as HTMLInputElement;
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
      const providerItems = document.querySelectorAll('.provider-item');
      expect(providerItems.length).toBe(1);
    });

    it('ESC key should hide dialog', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(document.getElementById('models-dev-dialog')!.classList.contains('hidden')).toBe(true);
    });

    it('click outside should hide dialog', async () => {
      const dialog = new ModelsDevDialog();
      await dialog.show();
      const overlay = document.getElementById('models-dev-dialog')!;
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(overlay.classList.contains('hidden')).toBe(true);
    });
  });
});