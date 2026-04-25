// @vitest-environment jsdom
/**
 * dashboard.test.ts
 * Unit tests for dashboard.ts (refactored for lazy DOM initialization)
 */
import { describe, it, expect, vi } from 'vitest';

// Setup chrome mock BEFORE importing dashboard
vi.stubGlobal('chrome', {
    i18n: {
        getMessage: vi.fn((key: string) => key),
        getUILanguage: vi.fn(() => 'en'),
    },
    runtime: {
        sendMessage: vi.fn().mockResolvedValue({}),
    },
    storage: {
        local: {
            get: vi.fn().mockResolvedValue({}),
            set: vi.fn().mockResolvedValue(undefined),
        },
    },
});

// Setup minimal DOM BEFORE importing dashboard
document.body.innerHTML = `
    <button class="sidebar-nav-btn" data-panel="panel1"></button>
    <button class="sidebar-nav-btn" data-panel="panel2"></button>
    <div id="panel1" class="panel"></div>
    <div id="panel2" class="panel"></div>
    <input id="apiKey" />
    <input id="protocol" />
    <input id="port" />
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
    <div id="selectedProviderInfo"></div>
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

// Mock dependencies
vi.mock('../utils/storage.js', () => ({
    getSettings: vi.fn().mockResolvedValue({}),
    saveSettingsWithAllowedUrls: vi.fn().mockResolvedValue(undefined),
    StorageKeys: {
        OBSIDIAN_API_KEY: 'obsidianApiKey',
        OBSIDIAN_PROTOCOL: 'obsidianProtocol',
        OBSIDIAN_PORT: 'obsidianPort',
        OBSIDIAN_DAILY_PATH: 'obsidianDailyPath',
        AI_PROVIDER: 'aiProvider',
        GEMINI_API_KEY: 'geminiApiKey',
        GEMINI_MODEL: 'geminiModel',
        OPENAI_BASE_URL: 'openaiBaseUrl',
        OPENAI_API_KEY: 'openaiApiKey',
        OPENAI_MODEL: 'openaiModel',
        OPENAI_2_BASE_URL: 'openai2BaseUrl',
        OPENAI_2_API_KEY: 'openai2ApiKey',
        OPENAI_2_MODEL: 'openai2Model',
        LM_STUDIO_BASE_URL: 'lmStudioBaseUrl',
        LM_STUDIO_MODEL: 'lmStudioModel',
        OLLAMA_BASE_URL: 'ollamaBaseUrl',
        OLLAMA_MODEL: 'ollamaModel',
        PROVIDER_TYPE: 'providerType',
        PROVIDER_BASE_URL: 'providerBaseUrl',
        PROVIDER_API_KEY: 'providerApiKey',
        PROVIDER_MODEL: 'providerModel',
        MIN_VISIT_DURATION: 'minVisitDuration',
        MIN_SCROLL_DEPTH: 'minScrollDepth',
        MAX_TOKENS_PER_PROMPT: 'maxTokensPerPrompt',
        AI_TIMEOUT_MS: 'aiTimeoutMs',
    },
}));

vi.mock('../popup/settingsUiHelper.js', () => ({
    loadSettingsToInputs: vi.fn(),
    extractSettingsFromInputs: vi.fn().mockReturnValue({}),
}));

vi.mock('../popup/settings/fieldValidation.js', () => ({
    clearAllFieldErrors: vi.fn(),
    validateAllFields: vi.fn().mockReturnValue(true),
    setupAllFieldValidations: vi.fn().mockReturnValue([]),
    ErrorPair: class {},
}));

vi.mock('../popup/settings/aiProvider.js', () => ({
    setupAIProviderChangeListener: vi.fn(),
    updateAIProviderVisibility: vi.fn(),
    AIProviderElements: {},
}));

vi.mock('../popup/utils/focusTrap.js', () => ({
    focusTrapManager: {
        trap: vi.fn().mockReturnValue('trap-id'),
        release: vi.fn(),
    },
}));

vi.mock('../constants/appConstants.js', () => ({
    STATUS_COLORS: {
        SUCCESS: '#22c55e',
        ERROR: '#ef4444',
    },
}));

vi.mock('../popup/aiSummaryCleansingSettings.js', () => ({
    getAiSummaryCleansingSettings: vi.fn().mockResolvedValue({}),
    applyAiSummaryCleansingSettingsToUI: vi.fn(),
    setupAiSummaryCleansingEventListeners: vi.fn(),
}));

vi.mock('../utils/storageUrls.js', () => ({
    getSavedUrlEntries: vi.fn().mockResolvedValue([]),
}));

vi.mock('../popup/domainFilter.js', () => ({ init: vi.fn() }));
vi.mock('../popup/privacySettings.js', () => ({ init: vi.fn() }));
vi.mock('../popup/contentSettings.js', () => ({ init: vi.fn() }));
vi.mock('../popup/trustSettings.js', () => ({
    init: vi.fn(),
    loadTrustSettings: vi.fn(),
}));
vi.mock('../popup/customPromptManager.js', () => ({ initCustomPromptManager: vi.fn() }));
vi.mock('../popup/i18n.js', () => ({ getMessage: vi.fn((key: string) => key) }));
vi.mock('./historyPanel.js', () => ({ initHistoryPanel: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./models-dev-dialog.js', () => ({
    ModelsDevDialog: class { show = vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('./cspSettings.js', () => ({
    CSPSettings: { loadCSPSettings: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('./cleansingStatsView.js', () => ({
    computeCleansingStats: vi.fn().mockReturnValue({ count: 0 }),
    renderStatsSummary: vi.fn(),
    renderFunnelChart: vi.fn(),
}));
vi.mock('./masterPassword.js', () => ({
    initMasterPasswordSettings: vi.fn(),
    loadMasterPasswordSettings: vi.fn(),
}));
vi.mock('./exportImport.js', () => ({ initExportImport: vi.fn() }));
vi.mock('./domainFilterTagUI.js', () => ({
    initDomainFilterTagUI: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./tagsPanel.js', () => ({
    initTagsPanel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./domainSearchPanel.js', () => ({
    initDomainSearchPanel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./diagnosticsPanel.js', () => ({
    initDiagnosticsPanel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./trancoConsentPanel.js', () => ({
    initTrancoConsentPanel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../popup/privacyConsent.js', () => ({
    getPrivacyConsent: vi.fn().mockResolvedValue({ hasConsented: false }),
    withdrawPrivacyConsent: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocks
import {
    initDashboard,
    initSidebarNav,
    createConnectionStatusElement,
    setHtmlLangDir,
    testObsidianConnection,
    testAiConnection,
    resetDashboardElements,
} from '../dashboard.js';

describe('dashboard.ts exports', () => {
    it('exports initDashboard', () => {
        expect(typeof initDashboard).toBe('function');
        expect(() => initDashboard()).not.toThrow();
    });

    it('exports initSidebarNav', () => {
        expect(typeof initSidebarNav).toBe('function');
    });

    it('exports createConnectionStatusElement', () => {
        expect(typeof createConnectionStatusElement).toBe('function');
    });

    it('exports setHtmlLangDir', () => {
        expect(typeof setHtmlLangDir).toBe('function');
    });
});

describe('initSidebarNav', () => {
    beforeEach(() => {
        document.querySelectorAll('.sidebar-nav-btn').forEach(el => el.remove());
        document.querySelectorAll('.panel').forEach(el => el.remove());

        ['panel1', 'panel2'].forEach(panelId => {
            const btn = document.createElement('button');
            btn.className = 'sidebar-nav-btn';
            btn.setAttribute('data-panel', panelId);
            document.body.appendChild(btn);

            const panel = document.createElement('div');
            panel.id = panelId;
            panel.className = 'panel';
            document.body.appendChild(panel);
        });

        resetDashboardElements();
        initSidebarNav();
    });

    it('switches active panel on nav button click', () => {
        const navBtns = document.querySelectorAll<HTMLButtonElement>('.sidebar-nav-btn');
        const panels = document.querySelectorAll<HTMLElement>('.panel');

        navBtns[0].click();

        expect(navBtns[0].classList.contains('active')).toBe(true);
        expect(navBtns[1].classList.contains('active')).toBe(false);
        expect(panels[0].classList.contains('active')).toBe(true);
        expect(panels[1].classList.contains('active')).toBe(false);
    });

    it('switches to second panel on second button click', () => {
        const navBtns = document.querySelectorAll<HTMLButtonElement>('.sidebar-nav-btn');
        const panels = document.querySelectorAll<HTMLElement>('.panel');

        navBtns[1].click();

        expect(navBtns[1].classList.contains('active')).toBe(true);
        expect(panels[1].classList.contains('active')).toBe(true);
    });
});

describe('setHtmlLangDir', () => {
    it('sets RTL for Arabic', () => {
        vi.stubGlobal('chrome', {
            ...chrome,
            i18n: {
                ...chrome.i18n,
                getUILanguage: vi.fn().mockReturnValue('ar'),
            },
        });

        setHtmlLangDir();
        expect(document.documentElement.lang).toBe('ar');
        expect(document.documentElement.dir).toBe('rtl');
    });

    it('sets LTR for English', () => {
        vi.stubGlobal('chrome', {
            ...chrome,
            i18n: {
                ...chrome.i18n,
                getUILanguage: vi.fn().mockReturnValue('en'),
            },
        });

        setHtmlLangDir();
        expect(document.documentElement.lang).toBe('en');
        expect(document.documentElement.dir).toBe('ltr');
    });
});

describe('createConnectionStatusElement', () => {
    it('creates success element', () => {
        const result = { success: true, message: 'Connected' };
        const el = createConnectionStatusElement('Test', result, '#22c55e', '#ef4444');

        expect(el.innerHTML).toContain('Test:');
        expect(el.querySelector('span')?.style.color).toBe('rgb(34, 197, 94)');
    });

    it('creates error element', () => {
        const result = { success: false, message: 'Failed' };
        const el = createConnectionStatusElement('Test', result, '#22c55e', '#ef4444');

        expect(el.innerHTML).toContain('Failed');
        expect(el.querySelector('span')?.style.color).toBe('rgb(239, 68, 68)');
    });
});

describe('testObsidianConnection', () => {
    it('calls chrome.runtime.sendMessage with TEST_OBSIDIAN', async () => {
        const sendMessage = vi.fn().mockResolvedValue({
            obsidian: { success: true, message: 'OK' }
        });
        vi.stubGlobal('chrome', {
            ...chrome,
            runtime: { sendMessage },
        });

        const result = await testObsidianConnection('test-api-key');

        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'TEST_OBSIDIAN',
        }));
        expect(result.success).toBe(true);
    });
});

describe('testAiConnection', () => {
    it('calls chrome.runtime.sendMessage with TEST_AI', async () => {
        const sendMessage = vi.fn().mockResolvedValue({
            ai: { success: true, message: 'OK' }
        });
        vi.stubGlobal('chrome', {
            ...chrome,
            runtime: { sendMessage },
        });

        const result = await testAiConnection();

        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'TEST_AI',
        }));
        expect(result.success).toBe(true);
    });
});
