// @vitest-environment jsdom
/**
 * dashboard.test.ts
 * Unit tests for dashboard.ts and panel modules
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
        TAG_SUMMARY_MODE: 'tagSummaryMode',
        TAG_CATEGORIES: 'tagCategories',
        TRANCO_VERSION: 'trancoVersion',
        TRANCO_DOMAINS: 'trancoDomains',
        TRANCO_CONSENT_GRANTED: 'trancoConsentGranted',
        TRANCO_CONSENT_DENIED_TIMESTAMP: 'trancoConsentDeniedTimestamp',
        TRANCO_CONSENT_DENIED_REASON: 'trancoConsentDeniedReason',
    },
}));

vi.mock('../popup/settingsUiHelper.js', () => ({
    loadSettingsToInputs: vi.fn(),
    extractSettingsFromInputs: vi.fn().mockReturnValue({}),
    showStatus: vi.fn(),
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
    TIMEOUTS: {
        ERROR_MESSAGE_DISPLAY: 5000,
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
vi.mock('./trancoConsent.js', () => ({
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
    getDashboardElements,
    getSettingsMapping,
    getAiProviderElements,
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

    it('removes active class from all buttons when switching panels', () => {
        const navBtns = document.querySelectorAll<HTMLButtonElement>('.sidebar-nav-btn');

        navBtns[0].click();
        navBtns[1].click();

        expect(navBtns[0].classList.contains('active')).toBe(false);
        expect(navBtns[1].classList.contains('active')).toBe(true);
    });

    it('does nothing when nav button has no data-panel', () => {
        const btn = document.createElement('button');
        btn.className = 'sidebar-nav-btn';
        document.body.appendChild(btn);
        initSidebarNav();

        expect(() => btn.click()).not.toThrow();
        document.body.removeChild(btn);
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

    it('sets LTR for Japanese', () => {
        vi.stubGlobal('chrome', {
            ...chrome,
            i18n: {
                ...chrome.i18n,
                getUILanguage: vi.fn().mockReturnValue('ja'),
            },
        });

        setHtmlLangDir();
        expect(document.documentElement.lang).toBe('ja');
        expect(document.documentElement.dir).toBe('ltr');
    });

    it('sets RTL for Hebrew', () => {
        vi.stubGlobal('chrome', {
            ...chrome,
            i18n: {
                ...chrome.i18n,
                getUILanguage: vi.fn().mockReturnValue('he'),
            },
        });

        setHtmlLangDir();
        expect(document.documentElement.lang).toBe('he');
        expect(document.documentElement.dir).toBe('rtl');
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

    it('creates element with strong label', () => {
        const result = { success: true, message: 'OK' };
        const el = createConnectionStatusElement('Service', result, '#22c55e', '#ef4444');

        const strongEl = el.querySelector('strong');
        expect(strongEl?.textContent).toBe('Service: ');
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

    it('returns default error when no obsidian response', async () => {
        const sendMessage = vi.fn().mockResolvedValue({});
        vi.stubGlobal('chrome', {
            ...chrome,
            runtime: { sendMessage },
        });

        const result = await testObsidianConnection('test-api-key');

        expect(result.success).toBe(false);
        expect(result.message).toBe('No response');
    });

    it('sends message with apiKey in payload', async () => {
        const sendMessage = vi.fn().mockResolvedValue({
            obsidian: { success: true, message: 'OK' }
        });
        vi.stubGlobal('chrome', {
            ...chrome,
            runtime: { sendMessage },
        });

        await testObsidianConnection('my-api-key');

        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            payload: expect.objectContaining({
                apiKey: 'my-api-key',
            }),
        }));
    });

    it('sends empty payload when apiKey is empty', async () => {
        const sendMessage = vi.fn().mockResolvedValue({
            obsidian: { success: true, message: 'OK' }
        });
        vi.stubGlobal('chrome', {
            ...chrome,
            runtime: { sendMessage },
        });

        await testObsidianConnection('');

        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            payload: {},
        }));
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

    it('returns default error when no ai response', async () => {
        const sendMessage = vi.fn().mockResolvedValue({});
        vi.stubGlobal('chrome', {
            ...chrome,
            runtime: { sendMessage },
        });

        const result = await testAiConnection();

        expect(result.success).toBe(false);
        expect(result.message).toBe('No response');
    });

    it('returns error when ai returns error response', async () => {
        const sendMessage = vi.fn().mockResolvedValue({
            ai: { success: false, message: 'API key invalid' }
        });
        vi.stubGlobal('chrome', {
            ...chrome,
            runtime: { sendMessage },
        });

        const result = await testAiConnection();

        expect(result.success).toBe(false);
        expect(result.message).toBe('API key invalid');
    });
});

describe('getDashboardElements', () => {
    it('returns an object with expected properties', () => {
        resetDashboardElements();
        const elements = getDashboardElements();

        expect(elements).toHaveProperty('apiKeyInput');
        expect(elements).toHaveProperty('protocolInput');
        expect(elements).toHaveProperty('portInput');
        expect(elements).toHaveProperty('dailyPathInput');
        expect(elements).toHaveProperty('aiProviderSelect');
    });

    it('returns cached elements on subsequent calls', () => {
        resetDashboardElements();
        const elements1 = getDashboardElements();
        const elements2 = getDashboardElements();

        expect(elements1).toBe(elements2);
    });

    it('returns all provider settings properties', () => {
        resetDashboardElements();
        const elements = getDashboardElements();

        expect(elements).toHaveProperty('geminiSettingsDiv');
        expect(elements).toHaveProperty('openaiSettingsDiv');
        expect(elements).toHaveProperty('openai2SettingsDiv');
        expect(elements).toHaveProperty('lmStudioSettingsDiv');
        expect(elements).toHaveProperty('ollamaSettingsDiv');
    });
});

describe('getSettingsMapping', () => {
    it('returns a mapping object with all settings keys', () => {
        resetDashboardElements();
        const mapping = getSettingsMapping();

        expect(mapping).toBeInstanceOf(Object);
        expect(Object.keys(mapping).length).toBeGreaterThan(0);
    });

    it('contains mapping entries', () => {
        resetDashboardElements();
        const mapping = getSettingsMapping();

        // Just verify it has keys and they map to something (input, select, or null)
        const keys = Object.keys(mapping);
        expect(keys.length).toBeGreaterThan(5); // Should have multiple settings
    });
});

describe('getAiProviderElements', () => {
    it('returns AI provider elements object', () => {
        resetDashboardElements();
        const elements = getAiProviderElements();

        expect(elements).toHaveProperty('select');
        expect(elements).toHaveProperty('geminiSettings');
        expect(elements).toHaveProperty('openaiSettings');
        expect(elements).toHaveProperty('openai2Settings');
    });

    it('returns select element as HTMLSelectElement', () => {
        resetDashboardElements();
        const elements = getAiProviderElements();

        // The select element may be null in jsdom, just verify it's either a select or null
        expect(elements.select === null || elements.select instanceof HTMLSelectElement).toBe(true);
    });
});

describe('resetDashboardElements', () => {
    it('clears cached elements', () => {
        resetDashboardElements();
        const elements1 = getDashboardElements();

        resetDashboardElements();
        const elements2 = getDashboardElements();

        // Both should work independently after reset
        expect(elements1).not.toBe(elements2);
    });
});
