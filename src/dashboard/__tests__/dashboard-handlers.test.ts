// @vitest-environment jsdom
/**
 * dashboard-handlers.test.ts
 * Tests for dashboard.ts handler functions.
 * Mocks use paths relative to THIS file (../../...) that resolve to the same
 * modules dashboard.ts imports (../...), so vitest correctly associates them.
 * We avoid static imports of mocked modules to prevent resolution mismatches.
 */

import { describe, it, expect, vi, beforeEach, afterEach, mocked } from 'vitest';
import { loadGeneralSettings } from '../generalSettings/settingsForm.js';
// Save and the connection tests moved out of dashboard.ts (PBI-24): they are
// driven only by the general settings panel.
import {
    handleSaveOnly,
    handleTestObsidian,
    handleTestAi,
} from '../generalSettings/connectionTests.js';
// Moved out of dashboard.ts (PBI-24): shared by the general settings panel
// and the Export Logs / History panels, so it is not panel-local.
import {
    handleManualLocalMarkdownExport,
    handleExportLocalMarkdown,
    handleHistoryExportLocalMarkdown,
} from '../localMarkdownExport.js';
import { saveSettingsWithAllowedUrls } from '../../utils/storage.js';
import { resetPlatformOsCache } from '../../utils/deviceUtils.js';

// Capture variables for assertions
let lastSavedSettings: unknown = null;
let getSavedUrlEntriesCallCount = 0;
const mockQueryLogs = vi.fn();
const mockDownload = vi.fn().mockResolvedValue(undefined);

vi.mock('../dashboardSqliteService.js', () => ({
    queryLogs: (...args: unknown[]) => mockQueryLogs(...args),
    clearAllLogs: vi.fn(),
}));

vi.stubGlobal('chrome', {
    i18n: {
        getMessage: vi.fn((key: string) => key),
        getUILanguage: vi.fn(() => 'en'),
    },
    runtime: {
        id: 'test-extension-id',
        sendMessage: vi.fn().mockResolvedValue({}),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
    downloads: { download: (...args: unknown[]) => mockDownload(...args) },
});

URL.createObjectURL = vi.fn(() => 'blob:mock');
URL.revokeObjectURL = vi.fn();

function buildDom() {
    document.body.innerHTML = `
        <button class="sidebar-nav-btn" data-panel="panel1"></button>
        <button class="sidebar-nav-btn" data-panel="panel-ai-summary-cleansing"></button>
        <div id="panel1" class="panel"></div>
        <div id="panel-ai-summary-cleansing" class="panel"></div>
        <div id="panel-general" class="panel">
        <input id="apiKey" data-storage-key="obsidian_api_key" />
        <input id="protocol" value="https" data-storage-key="obsidian_protocol" />
        <input id="port" value="27124" data-storage-key="obsidian_port" />
        <input id="dailyPath" data-storage-key="obsidian_daily_path" />
        <select id="aiProvider" data-storage-key="ai_provider"></select>
        <div id="geminiSettings"></div>
        <div id="openaiSettings"></div>
        <div id="openai2Settings"></div>
        <div id="lm-studioSettings"></div>
        <div id="openai-compatibleSettings"></div>
        <input id="geminiApiKey" data-storage-key="gemini_api_key" />
        <input id="geminiModel" data-storage-key="gemini_model" />
        <input id="openaiBaseUrl" data-storage-key="openai_base_url" />
        <input id="openaiApiKey" data-storage-key="openai_api_key" />
        <input id="openaiModel" data-storage-key="openai_model" />
        <input id="openai2BaseUrl" data-storage-key="openai_2_base_url" />
        <input id="openai2ApiKey" data-storage-key="openai_2_api_key" />
        <input id="openai2Model" data-storage-key="openai_2_model" />
        <input id="lmStudioBaseUrl" data-storage-key="lm_studio_base_url" />
        <input id="lmStudioModel" data-storage-key="lm_studio_model" />
        <div id="ollamaSettings"></div>
        <input id="ollamaBaseUrl" data-storage-key="ollama_base_url" />
        <input id="ollamaModel" data-storage-key="ollama_model" />
        <input id="providerBaseUrl" data-storage-key="provider_base_url" />
        <input id="providerApiKey" data-storage-key="provider_api_key" />
        <input id="providerModel" data-storage-key="provider_model" />
        <input id="minVisitDuration" data-storage-key="min_visit_duration" />
        <input id="minScrollDepth" data-storage-key="min_scroll_depth" />
        <input id="maxTokensPerPrompt" data-storage-key="max_tokens_per_prompt" />
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
        <input id="localExportStartDate" value="2026-01-01" />
        <input id="localExportEndDate" value="2026-01-02" />
        <button id="localExportManualBtn"></button>
        <div id="localExportManualStatus"></div>
        <input id="exportLocalStartDate" value="2026-01-01" />
        <input id="exportLocalEndDate" value="2026-01-02" />
        <button id="exportLocalMarkdownBtn"></button>
        <div id="exportLocalMarkdownStatus"></div>
        <button id="historyExportLocalMarkdownBtn"></button>
        <div id="historyExportLocalMarkdownStatus"></div>
        </div>
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

vi.mock('../../utils/ui/settingsUiHelper.js', () => ({
    loadSettingsToInputs: vi.fn(),
    extractSettingsFromInputs: vi.fn().mockReturnValue({}),
    showStatus: vi.fn(),
}));

vi.mock('../settings/fieldValidation.js', () => ({
    clearAllFieldErrors: vi.fn(),
    validateAllFields: vi.fn().mockReturnValue(true),
    validateObsidianHost: vi.fn().mockReturnValue(true),
    validateGeminiApiVersion: vi.fn().mockReturnValue(true),
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
    getSavedUrlEntries: vi.fn().mockImplementation(async () => {
        getSavedUrlEntriesCallCount++;
        return [];
    }),
}));

vi.mock('../../utils/ui/focusTrap.js', () => ({
    focusTrapManager: {
        trap: vi.fn().mockReturnValue('trap-id'),
        release: vi.fn(),
    },
}));

vi.mock('../../constants/appConstants.js', () => ({
    STATUS_COLORS: { SUCCESS: '#22c55e', ERROR: '#ef4444' },
    TIMEOUTS: { ERROR_MESSAGE_DISPLAY: 5000 },
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
vi.mock('../settings/trustSettings.js', () => ({
    init: vi.fn(),
    loadTrustSettings: vi.fn(),
}));
vi.mock('../settings/customPromptManager.js', () => ({ initCustomPromptManager: vi.fn() }));

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
        vi.clearAllMocks();
        lastSavedSettings = null;
        getSavedUrlEntriesCallCount = 0;
    });

    it('saves settings and shows success', async () => {
        const helper = await mocked('../../utils/ui/settingsUiHelper.js');
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
        lastSavedSettings = null;
        await handleSaveOnly();
        expect(lastSavedSettings).toBeNull();
    });

    it('returns early when validation fails', async () => {
        const fv = await mocked('../settings/fieldValidation.js');
        fv.validateAllFields.mockReturnValueOnce(false);
        lastSavedSettings = null;
        await handleSaveOnly();
        expect(lastSavedSettings).toBeNull();
    });
});

describe('handleTestObsidian', () => {
    beforeEach(() => {
        buildDom();
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
        await expect(handleTestObsidian()).resolves.toBeUndefined();
    });
});

describe('handleTestAi', () => {
    beforeEach(() => {
        buildDom();
        vi.clearAllMocks();
        lastSavedSettings = null;
        getSavedUrlEntriesCallCount = 0;
    });

    it('success', async () => {
        vi.stubGlobal('chrome', { ...chrome, runtime: { sendMessage: vi.fn().mockResolvedValue({ ai: { success: true, message: 'OK' } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
        await handleTestAi();
        expect(document.getElementById('status')!.className).toBe('success');
    });

  it('saves settings before testing AI connection', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ai: { success: true, message: 'OK' } });
    vi.stubGlobal('chrome', { ...chrome, runtime: { sendMessage, onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });

    const geminiInput = document.getElementById('geminiApiKey') as HTMLInputElement;
    const modelInput = document.getElementById('geminiModel') as HTMLInputElement;
    geminiInput.value = 'test-key';
    modelInput.value = 'gemini-2.0-flash';

    const expectedSettings = { gemini_api_key: 'test-key', gemini_model: 'gemini-2.0-flash' };

    await handleTestAi();

    expect(saveSettingsWithAllowedUrls).toHaveBeenCalledWith(
      expect.objectContaining(expectedSettings)
    );
  });

    it('error', async () => {
        vi.stubGlobal('chrome', { ...chrome, runtime: { sendMessage: vi.fn().mockResolvedValue({ ai: { success: false, message: 'API key invalid' } }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
        await handleTestAi();
        expect(document.getElementById('status')!.className).toBe('error');
    });

    it('exception', async () => {
        vi.stubGlobal('chrome', { ...chrome, runtime: { sendMessage: vi.fn().mockRejectedValue(new Error('Timeout')), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } } });
        await handleTestAi();
        expect(document.getElementById('status')!.className).toBe('error');
        expect(document.getElementById('status')!.textContent).toBe('testError');
    });

    it('returns early when button missing', async () => {
        document.getElementById('testAiBtn')!.remove();
        await expect(handleTestAi()).resolves.toBeUndefined();
    });

    it('registers and removes the AI_TEST_PROGRESS listener around the test', async () => {
        const addListener = vi.fn();
        const removeListener = vi.fn();
        vi.stubGlobal('chrome', {
            ...chrome,
            runtime: {
                sendMessage: vi.fn().mockResolvedValue({ ai: { success: true, message: 'OK' } }),
                onMessage: { addListener, removeListener },
            },
        });

        await handleTestAi();

        expect(addListener).toHaveBeenCalledTimes(1);
        expect(removeListener).toHaveBeenCalledTimes(1);
        expect(removeListener.mock.calls[0][0]).toBe(addListener.mock.calls[0][0]);
    });

    it('keeps the statusTop elapsed-time mirror in sync on timer ticks, not just provider switches', async () => {
        // statusTop is normally kept in sync via a one-shot innerHTML copy of
        // #status (syncStatusToTop), which only runs on provider-switch events.
        // The elapsed-time ticker (setInterval) must still update statusTop's
        // copy directly, or the on-screen seconds counter appears frozen.
        document.getElementById('status')!.insertAdjacentHTML('afterend', '<div id="statusTop"></div>');

        let capturedListener: ((message: unknown, sender: chrome.runtime.MessageSender) => void) | undefined;
        const addListener = vi.fn((listener: (message: unknown, sender: chrome.runtime.MessageSender) => void) => {
            capturedListener = listener;
        });
        const removeListener = vi.fn();
        let resolveSendMessage: (value: unknown) => void;
        const sendMessagePromise = new Promise((resolve) => { resolveSendMessage = resolve; });

        vi.stubGlobal('chrome', {
            ...chrome,
            runtime: {
                id: 'test-extension-id',
                // handleTestAi also fires a fire-and-forget REFRESH_LOCAL_MARKDOWN_SCHEDULER
                // sendMessage call (unrelated to the AI test). Only echo the progress
                // push for the actual TEST_AI request, or that second call re-triggers
                // announceProvider=true and syncStatusToTop(), masking the bug this
                // test exists to catch.
                sendMessage: vi.fn((msg: { type?: string; runId?: string }) => {
                    if (msg.type === 'TEST_AI') {
                        capturedListener?.(
                            {
                                type: 'AI_TEST_PROGRESS',
                                progress: { provider: 'gemini', index: 0, total: 2, runId: msg.runId },
                            },
                            { id: 'test-extension-id' } as chrome.runtime.MessageSender
                        );
                        return sendMessagePromise;
                    }
                    return Promise.resolve({});
                }),
                onMessage: { addListener, removeListener },
            },
        });

        const handlePromise = handleTestAi();
        // Wait for the provider-switch render specifically (not just any
        // .ai-test-elapsed node, which already exists from the initial
        // "testingConnection" frame drawn before the progress push arrives).
        // The provider-switch is the LAST announceProvider=true render in
        // this test, and thus the last one-shot syncStatusToTop() copy of
        // statusTop -- everything after this point must come from the
        // 200ms ticker alone.
        await vi.waitFor(() => {
            expect(document.querySelector('#statusTop')!.textContent).toContain('aiTestingProvider');
        });

        // The i18n module is mocked to echo the key verbatim, so the rendered
        // text never changes between ticks in this suite -- we can't detect
        // the bug by comparing textContent values. Instead assign a unique
        // marker to statusTop's .ai-test-elapsed node and confirm the next
        // 200ms timer tick overwrites it. Before the fix, only
        // announceProvider=true (provider switch) touched statusTop's node
        // via the one-shot innerHTML copy; the ticker only ever wrote to
        // #status's own node, so this marker would survive untouched.
        const topElapsedEl = document.querySelector('#statusTop .ai-test-elapsed') as HTMLElement;
        const marker = '__stale-marker__';
        topElapsedEl.textContent = marker;

        await new Promise((resolve) => setTimeout(resolve, 250));
        await vi.waitFor(() => {
            expect(document.querySelector('#statusTop .ai-test-elapsed')!.textContent).not.toBe(marker);
        });

        resolveSendMessage!({ ai: { success: true, message: 'OK' } });
        await handlePromise;
    });

    it('renders provider name and progress on an AI_TEST_PROGRESS push from this extension', async () => {
        let capturedListener: ((message: unknown, sender: chrome.runtime.MessageSender) => void) | undefined;
        const addListener = vi.fn((listener: (message: unknown, sender: chrome.runtime.MessageSender) => void) => {
            capturedListener = listener;
        });
        const removeListener = vi.fn();
        let resolveSendMessage: (value: unknown) => void;
        const sendMessagePromise = new Promise((resolve) => { resolveSendMessage = resolve; });

        vi.stubGlobal('chrome', {
            ...chrome,
            runtime: {
                id: 'test-extension-id',
                sendMessage: vi.fn((msg: { runId?: string }) => {
                    // Simulate the progress push arriving while the request is in
                    // flight, echoing the runId that handleTestAi just sent.
                    capturedListener?.(
                        {
                            type: 'AI_TEST_PROGRESS',
                            progress: { provider: 'gemini', index: 0, total: 2, runId: msg.runId },
                        },
                        { id: 'test-extension-id' } as chrome.runtime.MessageSender
                    );
                    return sendMessagePromise;
                }),
                onMessage: { addListener, removeListener },
            },
        });

        const handlePromise = handleTestAi();
        const statusDiv = document.getElementById('status')!;
        await vi.waitFor(() => {
            expect(statusDiv.textContent).toContain('aiTestingProvider');
        });

        expect(statusDiv.className).toBe('ai-test-progress');
        expect(statusDiv.querySelector('.ai-test-spinner')).not.toBeNull();

        resolveSendMessage!({ ai: { success: true, message: 'OK' } });
        await handlePromise;
        expect(removeListener).toHaveBeenCalledTimes(1);
    });

    it('ignores AI_TEST_PROGRESS pushes from a sender other than this extension', async () => {
        let capturedListener: ((message: unknown, sender: chrome.runtime.MessageSender) => void) | undefined;
        const addListener = vi.fn((listener: (message: unknown, sender: chrome.runtime.MessageSender) => void) => {
            capturedListener = listener;
        });
        const removeListener = vi.fn();
        let resolveSendMessage: (value: unknown) => void;
        const sendMessagePromise = new Promise((resolve) => { resolveSendMessage = resolve; });

        vi.stubGlobal('chrome', {
            ...chrome,
            runtime: {
                id: 'test-extension-id',
                sendMessage: vi.fn(() => sendMessagePromise),
                onMessage: { addListener, removeListener },
            },
        });

        const handlePromise = handleTestAi();
        const statusDiv = document.getElementById('status')!;

        // A spoofed broadcast from a foreign extension context arrives while the
        // request is in flight. It must be dropped: the status stays on the
        // initial "testingConnection" frame and never renders provider/progress.
        capturedListener?.(
            {
                type: 'AI_TEST_PROGRESS',
                progress: { provider: 'gemini', index: 0, total: 2 },
            },
            { id: 'other-extension-id' } as chrome.runtime.MessageSender
        );

        expect(statusDiv.textContent).not.toContain('aiTestingProvider');

        resolveSendMessage!({ ai: { success: true, message: 'OK' } });
        await handlePromise;

        expect(statusDiv.className).toBe('success');
        expect(removeListener).toHaveBeenCalledTimes(1);
    });

    it('ignores an AI_TEST_PROGRESS push with a malformed payload shape', async () => {
        let capturedListener: ((message: unknown, sender: chrome.runtime.MessageSender) => void) | undefined;
        const addListener = vi.fn((listener: (message: unknown, sender: chrome.runtime.MessageSender) => void) => {
            capturedListener = listener;
        });
        const removeListener = vi.fn();
        let resolveSendMessage: (value: unknown) => void;
        const sendMessagePromise = new Promise((resolve) => { resolveSendMessage = resolve; });

        vi.stubGlobal('chrome', {
            ...chrome,
            runtime: {
                id: 'test-extension-id',
                sendMessage: vi.fn(() => sendMessagePromise),
                onMessage: { addListener, removeListener },
            },
        });

        const handlePromise = handleTestAi();
        const statusDiv = document.getElementById('status')!;

        // Malformed payload: index is a string, total is negative. The push must
        // be dropped and the initial "testingConnection" frame preserved.
        capturedListener?.(
            {
                type: 'AI_TEST_PROGRESS',
                progress: { provider: 'gemini', index: 'oops', total: -1 },
            },
            { id: 'test-extension-id' } as chrome.runtime.MessageSender
        );

        expect(statusDiv.textContent).not.toContain('aiTestingProvider');

        resolveSendMessage!({ ai: { success: true, message: 'OK' } });
        await handlePromise;
        expect(removeListener).toHaveBeenCalledTimes(1);
    });

    it('does not let an Object.prototype key provider name pollute the label', async () => {
        let capturedListener: ((message: unknown, sender: chrome.runtime.MessageSender) => void) | undefined;
        const addListener = vi.fn((listener: (message: unknown, sender: chrome.runtime.MessageSender) => void) => {
            capturedListener = listener;
        });
        const removeListener = vi.fn();
        let resolveSendMessage: (value: unknown) => void;
        const sendMessagePromise = new Promise((resolve) => { resolveSendMessage = resolve; });

        vi.stubGlobal('chrome', {
            ...chrome,
            runtime: {
                id: 'test-extension-id',
                sendMessage: vi.fn((msg: { runId?: string }) => {
                    // Echo the runId that handleTestAi sent, simulating a real
                    // broadcast for this run.
                    capturedListener?.(
                        {
                            type: 'AI_TEST_PROGRESS',
                            progress: { provider: 'constructor', index: 0, total: 1, runId: msg.runId },
                        },
                        { id: 'test-extension-id' } as chrome.runtime.MessageSender
                    );
                    return sendMessagePromise;
                }),
                onMessage: { addListener, removeListener },
            },
        });

        // The i18n util is module-mocked to return keys; re-implement it for this
        // test so the interpolated provider value is observable in the label.
        const { getMessage } = await import('../../utils/i18n.js');
        vi.mocked(getMessage).mockImplementation((key: string, subst?: Record<string, string>) => {
            if (key === 'aiTestingProvider') return `Testing ${subst?.provider}...`;
            if (key === 'aiTestElapsedTime') return `Elapsed ${subst?.seconds}s`;
            return key;
        });

        const handlePromise = handleTestAi();
        const statusDiv = document.getElementById('status')!;

        // "constructor" is a valid string provider but a prototype key of the
        // PROVIDER_LABELS record. It must fall back to the raw value, not a
        // function source or "[object Object]".
        await vi.waitFor(() => {
            expect(statusDiv.textContent).toContain('constructor');
        });
        expect(statusDiv.textContent).not.toContain('[object Object]');

        resolveSendMessage!({ ai: { success: true, message: 'OK' } });
        await handlePromise;
    });

    it('ignores AI_TEST_PROGRESS from a different test run (concurrent Dashboard tab)', async () => {
        let capturedListener: ((message: unknown, sender: chrome.runtime.MessageSender) => void) | undefined;
        const addListener = vi.fn((listener: (message: unknown, sender: chrome.runtime.MessageSender) => void) => {
            capturedListener = listener;
        });
        const removeListener = vi.fn();
        let resolveSendMessage: (value: unknown) => void;
        const sendMessagePromise = new Promise((resolve) => { resolveSendMessage = resolve; });
        let sentRunId: string | undefined;

        vi.stubGlobal('chrome', {
            ...chrome,
            runtime: {
                id: 'test-extension-id',
                sendMessage: vi.fn((msg: { runId?: string }) => {
                    sentRunId = msg.runId;
                    return sendMessagePromise;
                }),
                onMessage: { addListener, removeListener },
            },
        });

        const handlePromise = handleTestAi();
        const statusDiv = document.getElementById('status')!;

        // A progress push from a DIFFERENT runId (e.g. another Dashboard tab)
        // must be dropped; the status stays on the initial frame.
        capturedListener?.(
            {
                type: 'AI_TEST_PROGRESS',
                progress: { provider: 'gemini', index: 0, total: 2, runId: `other-${sentRunId}` },
            },
            { id: 'test-extension-id' } as chrome.runtime.MessageSender
        );

        expect(statusDiv.textContent).not.toContain('aiTestingProvider');

        resolveSendMessage!({ ai: { success: true, message: 'OK' } });
        await handlePromise;
    });
});



describe('exportLocalMarkdownCore behavior parity (M15)', () => {
    const originalUserAgent = globalThis.navigator.userAgent;

    beforeEach(() => {
        buildDom();
        vi.clearAllMocks();
        mockQueryLogs.mockReset();
        mockDownload.mockReset().mockResolvedValue(undefined);
        resetPlatformOsCache();
    });

    afterEach(() => {
        Object.defineProperty(globalThis.navigator, 'userAgent', {
            value: originalUserAgent,
            configurable: true,
        });
        resetPlatformOsCache();
    });

    it('handleManualLocalMarkdownExport queries by date range and shows date-range empty message', async () => {
        mockQueryLogs.mockResolvedValue({ rows: [], total: 0 });

        await handleManualLocalMarkdownExport();

        expect(mockQueryLogs).toHaveBeenCalledWith(
            expect.objectContaining({ orderBy: 'created_at', orderDir: 'ASC', limit: 10000 })
        );
        expect(mockQueryLogs.mock.calls[0][0]).toHaveProperty('since');
        expect(mockQueryLogs.mock.calls[0][0]).toHaveProperty('until');
        expect(document.getElementById('localExportManualStatus')?.textContent).toBe('指定期間に記録がありません。');
    });

    it('handleExportLocalMarkdown uses its own DOM element IDs and date-range query', async () => {
        mockQueryLogs.mockResolvedValue({ rows: [], total: 0 });

        await handleExportLocalMarkdown();

        expect(mockQueryLogs).toHaveBeenCalledWith(
            expect.objectContaining({ orderBy: 'created_at', orderDir: 'ASC', limit: 10000 })
        );
        expect(document.getElementById('exportLocalMarkdownStatus')?.textContent).toBe('指定期間に記録がありません。');
    });

    it('handleHistoryExportLocalMarkdown queries full history in batches (no date range) and shows its own empty message', async () => {
        mockQueryLogs.mockResolvedValue({ rows: [], total: 0 });

        await handleHistoryExportLocalMarkdown();

        expect(mockQueryLogs).toHaveBeenCalledWith({ limit: 1000, offset: 0, orderBy: 'created_at', orderDir: 'ASC' });
        expect(document.getElementById('historyExportLocalMarkdownStatus')?.textContent).toBe('エクスポートする記録がありません。');
    });

    it('downloads one file per distinct date and reports the count', async () => {
        mockQueryLogs.mockResolvedValue({
            rows: [
                { id: 1, url: 'https://example.com/1', title: 'A', summary: 'S1', created_at: new Date(2026, 0, 1, 9, 0, 0).getTime() },
                { id: 2, url: 'https://example.com/2', title: 'B', summary: 'S2', created_at: new Date(2026, 0, 2, 9, 0, 0).getTime() },
                { id: 3, url: 'https://example.com/3', title: 'C', summary: 'S3', created_at: new Date(2026, 0, 2, 15, 0, 0).getTime() },
            ],
            total: 3,
        });

        await handleHistoryExportLocalMarkdown();

        expect(mockDownload).toHaveBeenCalledTimes(2);
        expect(document.getElementById('historyExportLocalMarkdownStatus')?.textContent).toBe(
            '3件の記録を2ファイルにエクスポートしました。'
        );
    });

    it('shows an error message and re-enables the button when queryLogs rejects', async () => {
        mockQueryLogs.mockRejectedValue(new Error('boom'));
        const btn = document.getElementById('historyExportLocalMarkdownBtn') as HTMLButtonElement;

        await handleHistoryExportLocalMarkdown();

        expect(document.getElementById('historyExportLocalMarkdownStatus')?.textContent).toContain('boom');
        expect(btn.disabled).toBe(false);
    });

    function makeRow(id: number, date: Date) {
        return { id, url: `https://example.com/${id}`, title: `T${id}`, summary: `S${id}`, created_at: date.getTime() };
    }

    it('pages through queryLogs with the desktop batch size until a short page ends the loop', async () => {
        const firstBatch = Array.from({ length: 1000 }, (_, i) => makeRow(i, new Date(2026, 0, 1, 0, 0, i)));
        const secondBatch = [makeRow(1000, new Date(2026, 0, 1, 0, 20, 0))];
        mockQueryLogs
            .mockResolvedValueOnce({ rows: firstBatch, total: 1001 })
            .mockResolvedValueOnce({ rows: secondBatch, total: 1001 });

        await handleHistoryExportLocalMarkdown();

        expect(mockQueryLogs).toHaveBeenCalledTimes(2);
        expect(mockQueryLogs).toHaveBeenNthCalledWith(1, { limit: 1000, offset: 0, orderBy: 'created_at', orderDir: 'ASC' });
        expect(mockQueryLogs).toHaveBeenNthCalledWith(2, { limit: 1000, offset: 1000, orderBy: 'created_at', orderDir: 'ASC' });
        expect(document.getElementById('historyExportLocalMarkdownStatus')?.textContent).toBe(
            '1001件の記録を1ファイルにエクスポートしました。'
        );
    });

    it('stops paging as soon as a page returns exactly a full batch followed by an empty page', async () => {
        const fullBatch = Array.from({ length: 1000 }, (_, i) => makeRow(i, new Date(2026, 0, 1, 0, 0, i)));
        mockQueryLogs
            .mockResolvedValueOnce({ rows: fullBatch, total: 1000 })
            .mockResolvedValueOnce({ rows: [], total: 1000 });

        await handleHistoryExportLocalMarkdown();

        expect(mockQueryLogs).toHaveBeenCalledTimes(2);
        expect(document.getElementById('historyExportLocalMarkdownStatus')?.textContent).toBe(
            '1000件の記録を1ファイルにエクスポートしました。'
        );
    });

    it('flushes a date group as soon as the batch crosses into a new date, keeping files grouped correctly across batch boundaries', async () => {
        // Use the mobile batch size (500) so a realistic two-page scenario fits
        // in this test: batch 1 is a full page ending mid-way through Jan 2,
        // batch 2 (a short page, ending the loop) continues Jan 2 then moves to Jan 3.
        Object.defineProperty(globalThis.navigator, 'userAgent', {
            value: 'Mozilla/5.0 (Linux; Android 14)',
            configurable: true,
        });

        const batch1 = [
            makeRow(1, new Date(2026, 0, 1, 9, 0, 0)),
            ...Array.from({ length: 499 }, (_, i) => makeRow(i + 2, new Date(2026, 0, 2, 0, 0, i))),
        ];
        const batch2 = [
            makeRow(501, new Date(2026, 0, 2, 20, 0, 0)),
            makeRow(502, new Date(2026, 0, 3, 9, 0, 0)),
        ];
        mockQueryLogs
            .mockResolvedValueOnce({ rows: batch1, total: 502 })
            .mockResolvedValueOnce({ rows: batch2, total: 502 });

        await handleHistoryExportLocalMarkdown();

        expect(mockQueryLogs).toHaveBeenNthCalledWith(1, { limit: 500, offset: 0, orderBy: 'created_at', orderDir: 'ASC' });
        expect(mockQueryLogs).toHaveBeenNthCalledWith(2, { limit: 500, offset: 500, orderBy: 'created_at', orderDir: 'ASC' });
        expect(mockDownload).toHaveBeenCalledTimes(3); // Jan 1, Jan 2 (rows spanning both batches), Jan 3
        expect(document.getElementById('historyExportLocalMarkdownStatus')?.textContent).toBe(
            '502件の記録を3ファイルにエクスポートしました。'
        );
    });

    it('uses a smaller batch size on mobile platforms', async () => {
        Object.defineProperty(globalThis.navigator, 'userAgent', {
            value: 'Mozilla/5.0 (Linux; Android 14)',
            configurable: true,
        });
        mockQueryLogs.mockResolvedValue({ rows: [], total: 0 });

        await handleHistoryExportLocalMarkdown();

        expect(mockQueryLogs).toHaveBeenCalledWith({ limit: 500, offset: 0, orderBy: 'created_at', orderDir: 'ASC' });
    });
});
