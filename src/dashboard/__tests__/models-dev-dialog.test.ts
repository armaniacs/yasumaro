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
      { id: 'gpt-4', isFreeTier: true, inputPrice: 0.01 },
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
  });
});