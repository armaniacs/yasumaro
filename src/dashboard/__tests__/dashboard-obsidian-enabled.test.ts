// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadGeneralSettings,
} from '../generalSettings/settingsForm.js';
import { extractSettingsFromInputs } from '../../utils/settingsFormBinding.js';

vi.stubGlobal('chrome', {
  i18n: {
    getMessage: vi.fn((key: string) => key),
    getUILanguage: vi.fn(() => 'en'),
  },
  runtime: { sendMessage: vi.fn().mockResolvedValue({}) },
  storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
});

function buildDom() {
  document.body.innerHTML = `
    <input id="obsidianEnabled" type="checkbox" />
    <details id="obsidianSettingsDetails">
      <summary>Obsidian Settings</summary>
      <input id="apiKey" />
      <div class="help-text">
        <a id="obsidianSetupGuideLink"
           href="https://github.com/armaniacs/yasumaro/blob/main/docs/OBSIDIAN_SETUP_GUIDE.md"
           target="_blank" rel="noopener noreferrer"
           data-i18n="obsidianSetupGuideLink">Obsidian設定ガイドを見る（新しいタブで開きます）</a>
      </div>
      <input id="protocol" value="https" />
      <input id="port" value="27124" />
      <input id="dailyPath" />
    </details>
    <select id="aiProvider"></select>
    <div id="geminiSettings"></div>
    <div id="openaiSettings"></div>
    <div id="openai2Settings"></div>
    <div id="lm-studioSettings"></div>
    <div id="openai-compatibleSettings"></div>
    <input id="geminiApiKey" />
    <input id="geminiModel" />
    <input id="openaiBaseUrl" />
    <input id="openaiApiKey" />
    <input id="openaiModel" />
    <input id="openai2BaseUrl" />
    <input id="openai2ApiKey" />
    <input id="openai2Model" />
    <input id="lmStudioBaseUrl" />
    <input id="lmStudioModel" />
    <div id="ollamaSettings"></div>
    <input id="ollamaBaseUrl" />
    <input id="ollamaModel" />
    <input id="providerBaseUrl" />
    <input id="providerApiKey" />
    <input id="providerModel" />
    <div id="selectedProviderInfo" class="hidden"></div>
    <div id="providerInfoDisplay"></div>
    <input type="number" id="minVisitDuration" data-storage-key="min_visit_duration" />
    <input type="number" id="minScrollDepth" data-storage-key="min_scroll_depth" />
    <input type="number" id="maxTokensPerPrompt" data-storage-key="max_tokens_per_prompt" />
  `;
}

buildDom();

vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSettings: vi.fn().mockResolvedValue({}),
    saveSettingsWithAllowedUrls: vi.fn(async () => undefined),
    StorageKeys: {
      OBSIDIAN_API_KEY: 'obsidian_api_key',
      OBSIDIAN_PROTOCOL: 'obsidian_protocol',
      OBSIDIAN_PORT: 'obsidian_port',
      OBSIDIAN_DAILY_PATH: 'obsidian_daily_path',
      OBSIDIAN_ENABLED: 'obsidian_enabled',
      AI_PROVIDER: 'ai_provider',
      GEMINI_API_KEY: 'gemini_api_key',
      GEMINI_MODEL: 'gemini_model',
      OPENAI_BASE_URL: 'openai_base_url',
      OPENAI_API_KEY: 'openai_api_key',
      OPENAI_MODEL: 'openai_model',
      OPENAI_2_BASE_URL: 'openai_2_base_url',
      OPENAI_2_API_KEY: 'openai_2_api_key',
      OPENAI_2_MODEL: 'openai_2_model',
      LM_STUDIO_BASE_URL: 'lm_studio_base_url',
      LM_STUDIO_MODEL: 'lm_studio_model',
      OLLAMA_BASE_URL: 'ollama_base_url',
      OLLAMA_MODEL: 'ollama_model',
      PROVIDER_TYPE: 'provider_type',
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      MIN_VISIT_DURATION: 'min_visit_duration',
      MIN_SCROLL_DEPTH: 'min_scroll_depth',
      MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
      AI_TIMEOUT_MS: 'ai_timeout_ms',
    },

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

    getSettings: vi.fn().mockResolvedValue({}),
    saveSettingsWithAllowedUrls: vi.fn(async () => undefined),
    StorageKeys: {
      OBSIDIAN_API_KEY: 'obsidian_api_key',
      OBSIDIAN_PROTOCOL: 'obsidian_protocol',
      OBSIDIAN_PORT: 'obsidian_port',
      OBSIDIAN_DAILY_PATH: 'obsidian_daily_path',
      OBSIDIAN_ENABLED: 'obsidian_enabled',
      AI_PROVIDER: 'ai_provider',
      GEMINI_API_KEY: 'gemini_api_key',
      GEMINI_MODEL: 'gemini_model',
      OPENAI_BASE_URL: 'openai_base_url',
      OPENAI_API_KEY: 'openai_api_key',
      OPENAI_MODEL: 'openai_model',
      OPENAI_2_BASE_URL: 'openai_2_base_url',
      OPENAI_2_API_KEY: 'openai_2_api_key',
      OPENAI_2_MODEL: 'openai_2_model',
      LM_STUDIO_BASE_URL: 'lm_studio_base_url',
      LM_STUDIO_MODEL: 'lm_studio_model',
      OLLAMA_BASE_URL: 'ollama_base_url',
      OLLAMA_MODEL: 'ollama_model',
      PROVIDER_TYPE: 'provider_type',
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      MIN_VISIT_DURATION: 'min_visit_duration',
      MIN_SCROLL_DEPTH: 'min_scroll_depth',
      MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
      AI_TIMEOUT_MS: 'ai_timeout_ms',
    },

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

    getSettings: vi.fn().mockResolvedValue({}),
    saveSettingsWithAllowedUrls: vi.fn(async () => undefined),
    StorageKeys: {
      OBSIDIAN_API_KEY: 'obsidian_api_key',
      OBSIDIAN_PROTOCOL: 'obsidian_protocol',
      OBSIDIAN_PORT: 'obsidian_port',
      OBSIDIAN_DAILY_PATH: 'obsidian_daily_path',
      OBSIDIAN_ENABLED: 'obsidian_enabled',
      AI_PROVIDER: 'ai_provider',
      GEMINI_API_KEY: 'gemini_api_key',
      GEMINI_MODEL: 'gemini_model',
      OPENAI_BASE_URL: 'openai_base_url',
      OPENAI_API_KEY: 'openai_api_key',
      OPENAI_MODEL: 'openai_model',
      OPENAI_2_BASE_URL: 'openai_2_base_url',
      OPENAI_2_API_KEY: 'openai_2_api_key',
      OPENAI_2_MODEL: 'openai_2_model',
      LM_STUDIO_BASE_URL: 'lm_studio_base_url',
      LM_STUDIO_MODEL: 'lm_studio_model',
      OLLAMA_BASE_URL: 'ollama_base_url',
      OLLAMA_MODEL: 'ollama_model',
      PROVIDER_TYPE: 'provider_type',
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      MIN_VISIT_DURATION: 'min_visit_duration',
      MIN_SCROLL_DEPTH: 'min_scroll_depth',
      MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
      AI_TIMEOUT_MS: 'ai_timeout_ms',
    },

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

    getSettings: vi.fn().mockResolvedValue({}),
    saveSettingsWithAllowedUrls: vi.fn(async () => undefined),
    StorageKeys: {
      OBSIDIAN_API_KEY: 'obsidian_api_key',
      OBSIDIAN_PROTOCOL: 'obsidian_protocol',
      OBSIDIAN_PORT: 'obsidian_port',
      OBSIDIAN_DAILY_PATH: 'obsidian_daily_path',
      OBSIDIAN_ENABLED: 'obsidian_enabled',
      AI_PROVIDER: 'ai_provider',
      GEMINI_API_KEY: 'gemini_api_key',
      GEMINI_MODEL: 'gemini_model',
      OPENAI_BASE_URL: 'openai_base_url',
      OPENAI_API_KEY: 'openai_api_key',
      OPENAI_MODEL: 'openai_model',
      OPENAI_2_BASE_URL: 'openai_2_base_url',
      OPENAI_2_API_KEY: 'openai_2_api_key',
      OPENAI_2_MODEL: 'openai_2_model',
      LM_STUDIO_BASE_URL: 'lm_studio_base_url',
      LM_STUDIO_MODEL: 'lm_studio_model',
      OLLAMA_BASE_URL: 'ollama_base_url',
      OLLAMA_MODEL: 'ollama_model',
      PROVIDER_TYPE: 'provider_type',
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      MIN_VISIT_DURATION: 'min_visit_duration',
      MIN_SCROLL_DEPTH: 'min_scroll_depth',
      MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
      AI_TIMEOUT_MS: 'ai_timeout_ms',
    },

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

    getSettings: vi.fn().mockResolvedValue({}),
    saveSettingsWithAllowedUrls: vi.fn(async () => undefined),
    StorageKeys: {
      OBSIDIAN_API_KEY: 'obsidian_api_key',
      OBSIDIAN_PROTOCOL: 'obsidian_protocol',
      OBSIDIAN_PORT: 'obsidian_port',
      OBSIDIAN_DAILY_PATH: 'obsidian_daily_path',
      OBSIDIAN_ENABLED: 'obsidian_enabled',
      AI_PROVIDER: 'ai_provider',
      GEMINI_API_KEY: 'gemini_api_key',
      GEMINI_MODEL: 'gemini_model',
      OPENAI_BASE_URL: 'openai_base_url',
      OPENAI_API_KEY: 'openai_api_key',
      OPENAI_MODEL: 'openai_model',
      OPENAI_2_BASE_URL: 'openai_2_base_url',
      OPENAI_2_API_KEY: 'openai_2_api_key',
      OPENAI_2_MODEL: 'openai_2_model',
      LM_STUDIO_BASE_URL: 'lm_studio_base_url',
      LM_STUDIO_MODEL: 'lm_studio_model',
      OLLAMA_BASE_URL: 'ollama_base_url',
      OLLAMA_MODEL: 'ollama_model',
      PROVIDER_TYPE: 'provider_type',
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      MIN_VISIT_DURATION: 'min_visit_duration',
      MIN_SCROLL_DEPTH: 'min_scroll_depth',
      MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
      AI_TIMEOUT_MS: 'ai_timeout_ms',
    },

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

    getSettings: vi.fn().mockResolvedValue({}),
    saveSettingsWithAllowedUrls: vi.fn(async () => undefined),
    StorageKeys: {
      OBSIDIAN_API_KEY: 'obsidian_api_key',
      OBSIDIAN_PROTOCOL: 'obsidian_protocol',
      OBSIDIAN_PORT: 'obsidian_port',
      OBSIDIAN_DAILY_PATH: 'obsidian_daily_path',
      OBSIDIAN_ENABLED: 'obsidian_enabled',
      AI_PROVIDER: 'ai_provider',
      GEMINI_API_KEY: 'gemini_api_key',
      GEMINI_MODEL: 'gemini_model',
      OPENAI_BASE_URL: 'openai_base_url',
      OPENAI_API_KEY: 'openai_api_key',
      OPENAI_MODEL: 'openai_model',
      OPENAI_2_BASE_URL: 'openai_2_base_url',
      OPENAI_2_API_KEY: 'openai_2_api_key',
      OPENAI_2_MODEL: 'openai_2_model',
      LM_STUDIO_BASE_URL: 'lm_studio_base_url',
      LM_STUDIO_MODEL: 'lm_studio_model',
      OLLAMA_BASE_URL: 'ollama_base_url',
      OLLAMA_MODEL: 'ollama_model',
      PROVIDER_TYPE: 'provider_type',
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      MIN_VISIT_DURATION: 'min_visit_duration',
      MIN_SCROLL_DEPTH: 'min_scroll_depth',
      MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
      AI_TIMEOUT_MS: 'ai_timeout_ms',
    },

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

    getSettings: vi.fn().mockResolvedValue({}),
    saveSettingsWithAllowedUrls: vi.fn(async () => undefined),
    StorageKeys: {
      OBSIDIAN_API_KEY: 'obsidian_api_key',
      OBSIDIAN_PROTOCOL: 'obsidian_protocol',
      OBSIDIAN_PORT: 'obsidian_port',
      OBSIDIAN_DAILY_PATH: 'obsidian_daily_path',
      OBSIDIAN_ENABLED: 'obsidian_enabled',
      AI_PROVIDER: 'ai_provider',
      GEMINI_API_KEY: 'gemini_api_key',
      GEMINI_MODEL: 'gemini_model',
      OPENAI_BASE_URL: 'openai_base_url',
      OPENAI_API_KEY: 'openai_api_key',
      OPENAI_MODEL: 'openai_model',
      OPENAI_2_BASE_URL: 'openai_2_base_url',
      OPENAI_2_API_KEY: 'openai_2_api_key',
      OPENAI_2_MODEL: 'openai_2_model',
      LM_STUDIO_BASE_URL: 'lm_studio_base_url',
      LM_STUDIO_MODEL: 'lm_studio_model',
      OLLAMA_BASE_URL: 'ollama_base_url',
      OLLAMA_MODEL: 'ollama_model',
      PROVIDER_TYPE: 'provider_type',
      PROVIDER_BASE_URL: 'provider_base_url',
      PROVIDER_API_KEY: 'provider_api_key',
      PROVIDER_MODEL: 'provider_model',
      MIN_VISIT_DURATION: 'min_visit_duration',
      MIN_SCROLL_DEPTH: 'min_scroll_depth',
      MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt',
      AI_TIMEOUT_MS: 'ai_timeout_ms',
    },

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

vi.mock('../../utils/ui/settingsUiHelper.js', () => ({
  loadSettingsToInputs: vi.fn(),
  extractSettingsFromInputs: vi.fn().mockReturnValue({}),
}));

vi.mock('../settings/fieldValidation.js', () => ({
  clearAllFieldErrors: vi.fn(),
  validateAllFields: vi.fn().mockReturnValue(true),
  setupAllFieldValidations: vi.fn().mockReturnValue([]),
  ErrorPair: class {},
}));

vi.mock('../settings/aiProvider.js', () => ({
  setupAIProviderChangeListener: vi.fn(),
  updateAIProviderVisibility: vi.fn(),
  updateAIProviderVisibilityMulti: vi.fn(),
  AIProviderElements: {},
  // Moved here from dashboard.ts alongside AIProviderElements (PBI-24).
  getAiProviderElements: vi.fn(() => ({
    select: document.getElementById('aiProvider'),
  })),
}));

vi.mock('../../utils/storageUrls.js', () => ({
  getSavedUrlEntries: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../utils/ui/focusTrap.js', () => ({
  focusTrapManager: {
    trap: vi.fn().mockReturnValue('trap-id'),
    release: vi.fn(),
  },
}));

vi.mock('../../constants/appConstants.js', () => ({
  STATUS_COLORS: { SUCCESS: '#22c55e', ERROR: '#ef4444' },
}));

vi.mock('../../utils/i18n.js', () => ({
  getMessage: vi.fn((key: string) => key),
}));

vi.mock('../settings/aiSummaryCleansingSettingsV2.js', () => ({
  getAiSummaryCleansingSettings: vi.fn().mockResolvedValue({}),
  applyAiSummaryCleansingSettingsToUI: vi.fn(),
  setupAiSummaryCleansingEventListeners: vi.fn(),
}));

vi.mock('../settings/domainFilter.js', () => ({ init: vi.fn() }));
vi.mock('../settings/privacySettings.js', () => ({ init: vi.fn() }));
vi.mock('../settings/contentSettings.js', () => ({ init: vi.fn() }));
vi.mock('../settings/trustSettings.js', () => ({ init: vi.fn(), loadTrustSettings: vi.fn() }));
vi.mock('../settings/customPromptManager.js', () => ({ initCustomPromptManager: vi.fn() }));
vi.mock('../historyPanel.js', () => ({ initHistoryPanel: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../models-dev-dialog.js', () => ({
  ModelsDevDialog: class { show = vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../cspSettings.js', () => ({
  cspSettings: { loadCSPSettings: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../cleansingStatsView.js', () => ({
  computeCleansingStats: vi.fn().mockReturnValue({ count: 0 }),
  renderStatsSummary: vi.fn(),
  renderFunnelChart: vi.fn(),
}));
vi.mock('../masterPassword.js', () => ({
  initMasterPasswordSettings: vi.fn(),
  loadMasterPasswordSettings: vi.fn(),
}));
vi.mock('../exportImport.js', () => ({ initExportImport: vi.fn() }));
vi.mock('../domainFilterTagUI.js', () => ({ initDomainFilterTagUI: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../tagsPanel.js', () => ({ initTagsPanel: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../trancoConsent.js', () => ({ initTrancoConsentPanel: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../popup/privacyConsent.js', () => ({
  getPrivacyConsent: vi.fn().mockResolvedValue({ hasConsessed: false }),
  withdrawPrivacyConsent: vi.fn(),
}));

async function mocked(modulePath: string) {
  const mod = await import(modulePath);
  return vi.mocked(mod);
}

describe('Dashboard — obsidianEnabledInput', () => {
  beforeEach(() => {
    buildDom();
    vi.clearAllMocks();
  });

  it('loadGeneralSettings sets details.open based on checkbox state (checked)', async () => {
    const checkbox = document.getElementById('obsidianEnabled') as HTMLInputElement;
    checkbox.checked = true;
    const details = document.getElementById('obsidianSettingsDetails') as HTMLDetailsElement;
    details.open = false;

    const m = await mocked('../../utils/storage.js');
    m.getSettings.mockResolvedValueOnce({ obsidian_enabled: true });

    await loadGeneralSettings();

    expect(details.open).toBe(true);
  });

  it('Obsidian有効時にガイドリンクが表示されていること', () => {
    const link = document.getElementById('obsidianSetupGuideLink');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toContain('OBSIDIAN_SETUP_GUIDE.md');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('loadGeneralSettings sets details.open based on checkbox state (unchecked)', async () => {
    const checkbox = document.getElementById('obsidianEnabled') as HTMLInputElement;
    checkbox.checked = false;
    const details = document.getElementById('obsidianSettingsDetails') as HTMLDetailsElement;
    details.open = true;

    const m = await mocked('../../utils/storage.js');
    m.getSettings.mockResolvedValueOnce({ obsidian_enabled: false });

    await loadGeneralSettings();

    expect(details.open).toBe(false);
  });

  it('loadGeneralSettings が min_visit_duration / min_scroll_depth / max_tokens_per_prompt を読み込む', async () => {
    const m = await mocked('../../utils/storage.js');
    m.getSettings.mockResolvedValueOnce({
      min_visit_duration: 10,
      min_scroll_depth: 30,
      max_tokens_per_prompt: 2000,
    });

    await loadGeneralSettings();

    expect((document.getElementById('minVisitDuration') as HTMLInputElement).value).toBe('10');
    expect((document.getElementById('minScrollDepth') as HTMLInputElement).value).toBe('30');
    expect((document.getElementById('maxTokensPerPrompt') as HTMLInputElement).value).toBe('2000');
  });

  it('extractSettingsFromInputs が min_visit_duration / min_scroll_depth / max_tokens_per_prompt を抽出する', () => {
    (document.getElementById('minVisitDuration') as HTMLInputElement).value = '15';
    (document.getElementById('minScrollDepth') as HTMLInputElement).value = '40';
    (document.getElementById('maxTokensPerPrompt') as HTMLInputElement).value = '3000';

    const extracted = extractSettingsFromInputs(document.body);

    expect(extracted.min_visit_duration).toBe(15);
    expect(extracted.min_scroll_depth).toBe(40);
    expect(extracted.max_tokens_per_prompt).toBe(3000);
  });
});
