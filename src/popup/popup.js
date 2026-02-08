import { StorageKeys, saveSettings, getSettings } from '../utils/storage.js';
import { ObsidianClient } from '../background/obsidianClient.js';
import { init as initNavigation } from './navigation.js';
import { init as initDomainFilter } from './domainFilter.js';
import { init as initPrivacySettings } from './privacySettings.js';
import { loadSettingsToInputs, extractSettingsFromInputs } from './settingsUiHelper.js';
import { getMessage } from './i18n.js';

// Elements
const apiKeyInput = document.getElementById('apiKey');
const protocolInput = document.getElementById('protocol');
const portInput = document.getElementById('port');
const dailyPathInput = document.getElementById('dailyPath');

const aiProviderSelect = document.getElementById('aiProvider');
const geminiSettingsDiv = document.getElementById('geminiSettings');
const openaiSettingsDiv = document.getElementById('openaiSettings');
const openai2SettingsDiv = document.getElementById('openai2Settings');

const geminiApiKeyInput = document.getElementById('geminiApiKey');
const geminiModelInput = document.getElementById('geminiModel');

const openaiBaseUrlInput = document.getElementById('openaiBaseUrl');
const openaiApiKeyInput = document.getElementById('openaiApiKey');
const openaiModelInput = document.getElementById('openaiModel');

const openai2BaseUrlInput = document.getElementById('openai2BaseUrl');
const openai2ApiKeyInput = document.getElementById('openai2ApiKey');
const openai2ModelInput = document.getElementById('openai2Model');

const minVisitDurationInput = document.getElementById('minVisitDuration');
const minScrollDepthInput = document.getElementById('minScrollDepth');
const saveBtn = document.getElementById('save');
const statusDiv = document.getElementById('status');

// Mapping of StorageKeys to DOM elements
const settingsMapping = {
    [StorageKeys.OBSIDIAN_API_KEY]: apiKeyInput,
    [StorageKeys.OBSIDIAN_PROTOCOL]: protocolInput,
    [StorageKeys.OBSIDIAN_PORT]: portInput,
    [StorageKeys.OBSIDIAN_DAILY_PATH]: dailyPathInput,
    [StorageKeys.AI_PROVIDER]: aiProviderSelect,
    [StorageKeys.GEMINI_API_KEY]: geminiApiKeyInput,
    [StorageKeys.GEMINI_MODEL]: geminiModelInput,
    [StorageKeys.OPENAI_BASE_URL]: openaiBaseUrlInput,
    [StorageKeys.OPENAI_API_KEY]: openaiApiKeyInput,
    [StorageKeys.OPENAI_MODEL]: openaiModelInput,
    [StorageKeys.OPENAI_2_BASE_URL]: openai2BaseUrlInput,
    [StorageKeys.OPENAI_2_API_KEY]: openai2ApiKeyInput,
    [StorageKeys.OPENAI_2_MODEL]: openai2ModelInput,
    [StorageKeys.MIN_VISIT_DURATION]: minVisitDurationInput,
    [StorageKeys.MIN_SCROLL_DEPTH]: minScrollDepthInput
};

function updateVisibility() {
    const provider = aiProviderSelect.value;
    geminiSettingsDiv.style.display = 'none';
    openaiSettingsDiv.style.display = 'none';
    openai2SettingsDiv.style.display = 'none';

    if (provider === 'gemini') {
        geminiSettingsDiv.style.display = 'block';
    } else if (provider === 'openai') {
        openaiSettingsDiv.style.display = 'block';
    } else if (provider === 'openai2') {
        openai2SettingsDiv.style.display = 'block';
    }
}

aiProviderSelect.addEventListener('change', updateVisibility);

// Load current settings
async function load() {
    const settings = await getSettings();
    loadSettingsToInputs(settings, settingsMapping);
    updateVisibility();
}

// Save and Test
saveBtn.addEventListener('click', async () => {
    statusDiv.textContent = getMessage('testingConnection');
    statusDiv.className = '';

    // Input validation
    const protocol = protocolInput.value.trim().toLowerCase();
    if (protocol !== 'http' && protocol !== 'https') {
        statusDiv.textContent = getMessage('errorProtocol');
        statusDiv.className = 'error';
        return;
    }

    const port = parseInt(portInput.value.trim(), 10);
    if (isNaN(port) || port < 1 || port > 65535) {
        statusDiv.textContent = getMessage('errorPort');
        statusDiv.className = 'error';
        return;
    }

    const minVisitDuration = parseInt(minVisitDurationInput.value, 10);
    if (isNaN(minVisitDuration) || minVisitDuration < 0) {
        statusDiv.textContent = getMessage('errorDuration');
        statusDiv.className = 'error';
        return;
    }

    const minScrollDepth = parseInt(minScrollDepthInput.value, 10);
    if (isNaN(minScrollDepth) || minScrollDepth < 0 || minScrollDepth > 100) {
        statusDiv.textContent = getMessage('errorScrollDepth');
        statusDiv.className = 'error';
        return;
    }

    const newSettings = extractSettingsFromInputs(settingsMapping);
    await saveSettings(newSettings);

    // Test connection
    const client = new ObsidianClient();
    const result = await client.testConnection();

    if (result && result.success) {
        statusDiv.textContent = getMessage('successConnected');
        statusDiv.className = 'success';
    } else {
        statusDiv.textContent = getMessage('connectionFailed', { message: result?.message || 'Unknown error' });
        statusDiv.className = 'error';

        if (result.message.includes('Failed to fetch') && protocolInput.value === 'https') {
            // SECURITY FIX (SECURITY-001): Use the validated 'port' variable, NOT portInput.value
            // This prevents XSS when portInput.value contains malicious content like:
            //   - 1234"><script>alert('XSS')</script>
            //   - 1234"><img src=x onerror=alert('XSS')>
            const url = `https://127.0.0.1:${port}/`;

            // Use createElement instead of innerHTML to prevent XSS
            const link = document.createElement('a');
            link.href = url;
            link.target = '_blank';
            link.textContent = getMessage('acceptCertificate');
            link.rel = 'noopener noreferrer';

            statusDiv.appendChild(document.createElement('br'));
            statusDiv.appendChild(link);
        }
    }
});

// Initialize (ES6 modules are deferred, so DOM is already ready)
console.log('[Popup] Starting initialization...');

try {
    console.log('[Popup] Calling initNavigation...');
    initNavigation();
    console.log('[Popup] initNavigation complete');
} catch (error) {
    console.error('[Popup] Error in initNavigation:', error);
}

try {
    console.log('[Popup] Calling initDomainFilter...');
    initDomainFilter();
    console.log('[Popup] initDomainFilter complete');
} catch (error) {
    console.error('[Popup] Error in initDomainFilter:', error);
}

try {
    console.log('[Popup] Calling initPrivacySettings...');
    initPrivacySettings();
    console.log('[Popup] initPrivacySettings complete');
} catch (error) {
    console.error('[Popup] Error in initPrivacySettings:', error);
}

try {
    console.log('[Popup] Calling load...');
    load();
    console.log('[Popup] load complete');
} catch (error) {
    console.error('[Popup] Error in load:', error);
}

console.log('[Popup] Initialization sequence complete');
