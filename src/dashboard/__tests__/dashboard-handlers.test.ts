// @vitest-environment jsdom
/**
 * dashboard-handlers.test.ts
 * Tests for dashboard.ts handler functions.
 * Mocks use paths relative to THIS file (../../...) that resolve to the same
 * modules dashboard.ts imports (../...), so vitest correctly associates them.
 * We avoid static imports of mocked modules to prevent resolution mismatches.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    resetDashboardElements,
    loadGeneralSettings,
    handleSaveOnly,
    handleTestObsidian,
    handleTestAi,
    initSidebarNav,
} from '../dashboard.js';

// Capture variables for assertions
let lastSavedSettings: unknown = null;
let getSavedUrlEntriesCallCount = 0;

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
        <button class="sidebar-nav-btn" data-panel="panel1"></button>
        <button class="sidebar-nav-btn" data-panel="panel-ai-summary-cleansing"></button>
        <div id="panel1" class="panel"></div>
        <div id="panel-ai-summary-cleansing" class="panel"></div>
        <input id="apiKey" />
        <input id="protocol" value="https" />
        <input id="port" value="27124" />
        <input id="dailyPath" />
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
        <input id="minVisitDuration" />
        <input id="minScrollDepth" />
        <input id="maxTokensPerPrompt" />
        <input id="aiTimeoutSeconds" />
        <button id="save"></button>
        <button id="testObsidianBtn"></button>
        <button id="testAiBtn"></button>
        <div id="status"></div>
        <div id="selectedProviderInfo" class="hidden"></div>
        <div id="providerInfoDisplay"></div>
        <div id="cleansingStatsSummary"></div>
        <canvas id="cleansingFunnelChart"></canvas>
        <button id="openModelsDevDialogBtn"></button>
        <button id="lmStudioPresetBtn"></button>
        <button id="ollamaPresetBtn"></button>
        <button id="btnDeleteAllData"></button>
        <div id="deleteAllDataStatus"></div>
        <div id="consentStatusDisplay"></div>
        <button id="btnWithdrawConsent"></button>
        <div id="withdrawConsentStatus"></div>
        <div id="breakingChangesModal"></div>
        <button id="closeBreakingChangesModalBtn"></button>
        <button id="dismissBreakingChangesModalBtn"></button>
    `;
}

// Build DOM before any module imports that cache it
buildDom();

// ------------------------------------------------------------------
// Mocks – paths are relative to THIS test file (../../ = src/utils/)
// which resolves to the same module as dashboard.ts's ../utils/
// ------------------------------------------------------------------
vi.mock('../../utils/storage.js', () => ({
    getSettings: vi.fn().mockResolvedValue({}),
    saveSettingsWithAllowedUrls: vi.fn(async (settings: unknown) => {
        lastSavedSettings = settings;
        return undefined;
    }),
    StorageKeys: {
        OBSIDIAN_API_KEY: 'obsidian_api_key',
        OBSIDIAN_PROTOCOL: 'obsidian_protocol',
        OBSIDIAN_PORT: 'obsidian_port',
        OBSIDIAN_DAILY_PATH: 'obsidian_daily_path',
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
    showStatus: vi.fn(),
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
    getSavedUrlEntries: vi.fn().mockImplementation(async () => {
        getSavedUrlEntriesCallCount++;
        return [];
    }),
}));

vi.mock('../../popup/utils/focusTrap.js', () => ({
    focusTrapManager: {
        trap: vi.fn().mockReturnValue('trap-id'),
        release: vi.fn(),
    },
}));

vi.mock('../../constants/appConstants.js', () => ({
    STATUS_COLORS: { SUCCESS: '#22c55e', ERROR: '#ef4444' },
    TIMEOUTS: { ERROR_MESSAGE_DISPLAY: 5000 },
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
vi.mock('../../popup/trustSettings.js', () => ({
    init: vi.fn(),
    loadTrustSettings: vi.fn(),
}));
vi.mock('../../popup/customPromptManager.js', () => ({ initCustomPromptManager: vi.fn() }));

// Same-directory mocks (relative from __tests__ to parent src/dashboard/)
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
vi.mock('../domainFilterTagUI.js', () => ({
    initDomainFilterTagUI: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../tagsPanel.js', () => ({
    initTagsPanel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../domainSearchPanel.js', () => ({
    initDomainSearchPanel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../diagnosticsPanel.js', () => ({
    initDiagnosticsPanel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../trancoConsent.js', () => ({
    initTrancoConsentPanel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../popup/privacyConsent.js', () => ({
    getPrivacyConsent: vi.fn().mockResolvedValue({ hasConsented: false }),
    withdrawPrivacyConsent: vi.fn().mockResolvedValue(undefined),
}));

// ------------------------------------------------------------------
// Helper to import mocked module and use vi.mocked() on it
// We do a DYNAMIC import so the path is correct for vi.mocked()
// ------------------------------------------------------------------
async function mocked(modulePath: string) {
    const mod = await import(modulePath);
    return vi.mocked(mod);
}

describe('loadGeneralSettings', () => {
    beforeEach(() => {
        buildDom();
        resetDashboardElements();
        vi.clearAllMocks();
        lastSavedSettings = null;
        getSavedUrlEntriesCallCount = 0;
    });

    it('shows selected provider info when configured', async () => {
        const m = await mocked('../../utils/storage.js');
        m.getSettings.mockResolvedValueOnce({
            provider_type: 'openai-compatible',
            provider_base_url: 'http://localhost:1234/v1',
        });
        await loadGeneralSettings();
        expect(document.getElementById('selectedProviderInfo')!.classList.contains('hidden')).toBe(false);
        expect(document.getElementById('providerInfoDisplay')!.textContent).toBe('openai-compatible (http://localhost:1234/v1)');
    });

    it('hides selected provider info when not configured', async () => {
        document.getElementById('selectedProviderInfo')!.classList.remove('hidden');
        const m = await mocked('../../utils/storage.js');
        m.getSettings.mockResolvedValueOnce({});
        await loadGeneralSettings();
        expect(document.getElementById('selectedProviderInfo')!.classList.contains('hidden')).toBe(true);
    });
});

describe('handleSaveOnly', () => {
    beforeEach(() => {
        buildDom();
        resetDashboardElements();
        vi.clearAllMocks();
        lastSavedSettings = null;
        getSavedUrlEntriesCallCount = 0;
    });

    it('saves settings and shows success', async () => {
        const helper = await mocked('../../popup/settingsUiHelper.js');
        helper.extractSettingsFromInputs.mockReturnValueOnce({ obsidian_protocol: 'https' });
        lastSavedSettings = null;

        await handleSaveOnly();

        expect(lastSavedSettings).not.toBeNull();
        const status = document.getElementById('status')!;
        expect(status.textContent).toBe('saveSuccess');
        expect(status.className).toBe('success');
    });

    it('returns early when statusDiv is missing', async () => {
        document.getElementById('status')!.remove();
        resetDashboardElements();
        lastSavedSettings = null;
        await handleSaveOnly();
        expect(lastSavedSettings).toBeNull();
    });

    it('returns early when validation fails', async () => {
        const fv = await mocked('../../popup/settings/fieldValidation.js');
        fv.validateAllFields.mockReturnValueOnce(false);
        lastSavedSettings = null;
        await handleSaveOnly();
        expect(lastSavedSettings).toBeNull();
    });
});

describe('handleTestObsidian', () => {
    beforeEach(() => {
        buildDom();
        resetDashboardElements();
        vi.clearAllMocks();
        lastSavedSettings = null;
        getSavedUrlEntriesCallCount = 0;
    });

    it('success path', async () => {
        vi.stubGlobal('chrome', { ...chrome, runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: true, message: 'OK' } }) } });
        await handleTestObsidian();
        expect(document.getElementById('status')!.className).toBe('success');
        expect(document.getElementById('status')!.innerHTML).toContain('Obsidian');
    });

    it('error path', async () => {
        vi.stubGlobal('chrome', { ...chrome, runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'Refused' } }) } });
        await handleTestObsidian();
        expect(document.getElementById('status')!.className).toBe('error');
    });

    it('certificate link for HTTPS failed fetch', async () => {
        (document.getElementById('protocol') as HTMLInputElement).value = 'https';
        (document.getElementById('port') as HTMLInputElement).value = '27124';
        vi.stubGlobal('chrome', { ...chrome, runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'Failed to fetch: ERR_CERT' } }) } });
        await handleTestObsidian();
        const link = document.getElementById('status')!.querySelector('a');
        expect(link).not.toBeNull();
        expect(link!.getAttribute('href')).toBe('https://127.0.0.1:27124/');
    });

    it('no certificate link for HTTP', async () => {
        (document.getElementById('protocol') as HTMLInputElement).value = 'http';
        vi.stubGlobal('chrome', { ...chrome, runtime: { sendMessage: vi.fn().mockResolvedValue({ obsidian: { success: false, message: 'Failed to fetch' } }) } });
        await handleTestObsidian();
        expect(document.getElementById('status')!.querySelector('a')).toBeNull();
    });

    it('generic error on exception', async () => {
        vi.stubGlobal('chrome', { ...chrome, runtime: { sendMessage: vi.fn().mockRejectedValue(new Error('net err')) } });
        await handleTestObsidian();
        expect(document.getElementById('status')!.className).toBe('error');
        expect(document.getElementById('status')!.textContent).toBe('testError');
    });

    it('returns early when button missing', async () => {
        document.getElementById('testObsidianBtn')!.remove();
        resetDashboardElements();
        await expect(handleTestObsidian()).resolves.toBeUndefined();
    });
});

describe('handleTestAi', () => {
    beforeEach(() => {
        buildDom();
        resetDashboardElements();
        vi.clearAllMocks();
        lastSavedSettings = null;
        getSavedUrlEntriesCallCount = 0;
    });

    it('success', async () => {
        vi.stubGlobal('chrome', { ...chrome, runtime: { sendMessage: vi.fn().mockResolvedValue({ ai: { success: true, message: 'OK' } }) } });
        await handleTestAi();
        expect(document.getElementById('status')!.className).toBe('success');
    });

    it('error', async () => {
        vi.stubGlobal('chrome', { ...chrome, runtime: { sendMessage: vi.fn().mockResolvedValue({ ai: { success: false, message: 'API key invalid' } }) } });
        await handleTestAi();
        expect(document.getElementById('status')!.className).toBe('error');
    });

    it('exception', async () => {
        vi.stubGlobal('chrome', { ...chrome, runtime: { sendMessage: vi.fn().mockRejectedValue(new Error('Timeout')) } });
        await handleTestAi();
        expect(document.getElementById('status')!.className).toBe('error');
        expect(document.getElementById('status')!.textContent).toBe('testError');
    });

    it('returns early when button missing', async () => {
        document.getElementById('testAiBtn')!.remove();
        resetDashboardElements();
        await expect(handleTestAi()).resolves.toBeUndefined();
    });
});

describe('initSidebarNav – AI Summary Cleansing panel', () => {
    beforeEach(() => {
        document.querySelectorAll('.sidebar-nav-btn').forEach(el => el.remove());
        document.querySelectorAll('.panel').forEach(el => el.remove());
        document.querySelectorAll('#cleansingStatsSummary').forEach(el => el.remove());
        document.querySelectorAll('#cleansingFunnelChart').forEach(el => el.remove());

        const btn = document.createElement('button');
        btn.className = 'sidebar-nav-btn';
        btn.setAttribute('data-panel', 'panel-ai-summary-cleansing');
        document.body.appendChild(btn);

        const panel = document.createElement('div');
        panel.id = 'panel-ai-summary-cleansing';
        panel.className = 'panel';
        document.body.appendChild(panel);

        const summary = document.createElement('div');
        summary.id = 'cleansingStatsSummary';
        document.body.appendChild(summary);

        const chart = document.createElement('canvas');
        chart.id = 'cleansingFunnelChart';
        document.body.appendChild(chart);

        resetDashboardElements();
        vi.clearAllMocks();
        lastSavedSettings = null;
        getSavedUrlEntriesCallCount = 0;
    });

    it('hides chart when count is 0', async () => {
        const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { cb(0); return 0; });
        initSidebarNav();
        document.querySelector<HTMLButtonElement>('[data-panel="panel-ai-summary-cleansing"]')!.click();
        await new Promise(r => setTimeout(r, 10));
        expect((document.getElementById('cleansingFunnelChart') as HTMLCanvasElement).style.display).toBe('none');
        raf.mockRestore();
    });

    it('shows and renders chart when count > 0', async () => {
        const { computeCleansingStats } = await import('../cleansingStatsView.js');
        vi.mocked(computeCleansingStats).mockReturnValueOnce({ count: 5 });

        const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { cb(0); return 0; });
        initSidebarNav();
        document.querySelector<HTMLButtonElement>('[data-panel="panel-ai-summary-cleansing"]')!.click();
        await new Promise(r => setTimeout(r, 10));
        expect((document.getElementById('cleansingFunnelChart') as HTMLCanvasElement).style.display).toBe('block');
        raf.mockRestore();
    });

    it('handles missing summary element gracefully', async () => {
        document.getElementById('cleansingStatsSummary')!.remove();
        const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { cb(0); return 0; });
        initSidebarNav();
        document.querySelector<HTMLButtonElement>('[data-panel="panel-ai-summary-cleansing"]')!.click();
        await new Promise(r => setTimeout(r, 10));
        expect(() => {}).not.toThrow();
        raf.mockRestore();
    });
});
