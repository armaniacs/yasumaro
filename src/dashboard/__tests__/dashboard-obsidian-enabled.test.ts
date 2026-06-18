// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resetDashboardElements,
  loadGeneralSettings,
  getSettingsMapping,
} from '../dashboard.js';

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
  `;
}

buildDom();

vi.mock('../../utils/storage.js', () => ({
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
}));

vi.mock('../../popup/settingsUiHelper.js', () => ({
  loadSettingsToInputs: vi.fn(),
  extractSettingsFromInputs: vi.fn().mockReturnValue({}),
}));

vi.mock('../../popup/settings/fieldValidation.js', () => ({
  clearAllFieldErrors: vi.fn(),
  validateAllFields: vi.fn().mockReturnValue(true),
  setupAllFieldValidations: vi.fn().mockReturnValue([]),
  ErrorPair: class {},
}));

vi.mock('../../popup/settings/aiProvider.js', () => ({
  setupAIProviderChangeListener: vi.fn(),
  updateAIProviderVisibility: vi.fn(),
  AIProviderElements: {},
}));

vi.mock('../../utils/storageUrls.js', () => ({
  getSavedUrlEntries: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../popup/utils/focusTrap.js', () => ({
  focusTrapManager: {
    trap: vi.fn().mockReturnValue('trap-id'),
    release: vi.fn(),
  },
}));

vi.mock('../../constants/appConstants.js', () => ({
  STATUS_COLORS: { SUCCESS: '#22c55e', ERROR: '#ef4444' },
}));

vi.mock('../../popup/i18n.js', () => ({
  getMessage: vi.fn((key: string) => key),
}));

vi.mock('../../popup/aiSummaryCleansingSettings.js', () => ({
  getAiSummaryCleansingSettings: vi.fn().mockResolvedValue({}),
  applyAiSummaryCleansingSettingsToUI: vi.fn(),
  setupAiSummaryCleansingEventListeners: vi.fn(),
}));

vi.mock('../../popup/domainFilter.js', () => ({ init: vi.fn() }));
vi.mock('../../popup/privacySettings.js', () => ({ init: vi.fn() }));
vi.mock('../../popup/contentSettings.js', () => ({ init: vi.fn() }));
vi.mock('../../popup/trustSettings.js', () => ({ init: vi.fn(), loadTrustSettings: vi.fn() }));
vi.mock('../../popup/customPromptManager.js', () => ({ initCustomPromptManager: vi.fn() }));
vi.mock('../historyPanel.js', () => ({ initHistoryPanel: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../models-dev-dialog.js', () => ({
  ModelsDevDialog: class { show = vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../cspSettings.js', () => ({
  CSPSettings: { loadCSPSettings: vi.fn().mockResolvedValue(undefined) },
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
vi.mock('../domainSearchPanel.js', () => ({ initDomainSearchPanel: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../diagnosticsPanel.js', () => ({ initDiagnosticsPanel: vi.fn().mockResolvedValue(undefined) }));
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
    resetDashboardElements();
    vi.clearAllMocks();
  });

  it('getSettingsMapping includes obsidianEnabledInput', () => {
    const checkbox = document.getElementById('obsidianEnabled') as HTMLInputElement;
    checkbox.checked = true;

    const mapping = getSettingsMapping();

    expect(mapping['obsidian_enabled']).toBe(checkbox);
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
});
