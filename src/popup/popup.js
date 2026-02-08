import { StorageKeys, saveSettings, getSettings } from '../utils/storage.js';
import { ObsidianClient } from '../background/obsidianClient.js';
import { init as initNavigation } from './navigation.js';
import { init as initDomainFilter } from './domainFilter.js';
import { init as initPrivacySettings, loadPrivacySettings } from './privacySettings.js';
import { loadSettingsToInputs, extractSettingsFromInputs, showStatus } from './settingsUiHelper.js';
import { getMessage } from './i18n.js';
import { exportSettings, importSettings, validateExportData } from '../utils/settingsExportImport.js';
import { loadDomainSettings } from './domainFilter.js';

/** @typedef {import('../types.js').Settings} Settings */
/** @typedef {import('../utils/settingsExportImport.js').SettingsExportData} SettingsExportData */

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

// Settings Export/Import functionality

// Settings menu elements
const settingsMenuBtn = document.getElementById('settingsMenuBtn');
const settingsMenu = document.getElementById('settingsMenu');
const exportSettingsBtn = document.getElementById('exportSettingsBtn');
const importSettingsBtn = document.getElementById('importSettingsBtn');
const importFileInput = document.getElementById('importFileInput');

// Import confirmation modal elements
const importConfirmModal = document.getElementById('importConfirmModal');
const closeImportModalBtn = document.getElementById('closeImportModalBtn');
const cancelImportBtn = document.getElementById('cancelImportBtn');
const confirmImportBtn = document.getElementById('confirmImportBtn');
const importPreview = document.getElementById('importPreview');

let pendingImportData = null;
let pendingImportJson = null;

// Toggle settings menu
if (settingsMenuBtn && settingsMenu) {
    settingsMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsMenu.classList.toggle('hidden');
        settingsMenuBtn.setAttribute('aria-expanded',
            !settingsMenu.classList.contains('hidden').toString());
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (settingsMenuBtn && !settingsMenuBtn.contains(e.target) &&
            settingsMenu && !settingsMenu.contains(e.target)) {
            settingsMenu.classList.add('hidden');
            settingsMenuBtn.setAttribute('aria-expanded', 'false');
        }
    });
}

// Export settings
exportSettingsBtn?.addEventListener('click', async () => {
    settingsMenu?.classList.add('hidden');
    settingsMenuBtn?.setAttribute('aria-expanded', 'false');

    try {
        await exportSettings();
        showStatus('status', getMessage('settingsExported'), 'success');
    } catch (error) {
        console.error('Export error:', error);
        const message = error instanceof Error ? error.message : String(error);
        showStatus('status', `${getMessage('exportError')}: ${message}`, 'error');
    }
});

// Import button click - open file selector
importSettingsBtn?.addEventListener('click', () => {
    settingsMenu?.classList.add('hidden');
    settingsMenuBtn?.setAttribute('aria-expanded', 'false');
    importFileInput?.click();
});

// File selected for import
importFileInput?.addEventListener('change', async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;

    try {
        const text = await file.text();
        const parsed = JSON.parse(text);

        if (!validateExportData(parsed)) {
            showStatus('status', getMessage('invalidSettingsFile'), 'error');
            return;
        }

        pendingImportData = parsed.settings;
        pendingImportJson = text;

        // Show import preview and confirmation modal
        showImportPreview(parsed);
        importConfirmModal?.classList.remove('hidden');

    } catch (error) {
        console.error('Import error:', error);
        const message = error instanceof Error ? error.message : String(error);
        showStatus('status', `${getMessage('importError')}: ${message}`, 'error');
    }

    // Reset to allow selecting the same file again
    if (importFileInput) {
        importFileInput.value = '';
    }
});

// Close import modal
async function closeImportModal() {
    importConfirmModal?.classList.add('hidden');
    pendingImportData = null;
    pendingImportJson = null;
    if (importPreview) {
        importPreview.textContent = '';
    }
}

closeImportModalBtn?.addEventListener('click', closeImportModal);
cancelImportBtn?.addEventListener('click', closeImportModal);

// Confirm import
confirmImportBtn?.addEventListener('click', async () => {
    if (!pendingImportJson) {
        closeImportModal();
        return;
    }

    try {
        const imported = await importSettings(pendingImportJson);
        if (imported) {
            showStatus('status', getMessage('settingsImported'), 'success');
            // Reload all settings
            await load();
            // Reload domain specific settings
            await loadDomainSettings();
            // Reload privacy settings
            await loadPrivacySettings();
        } else {
            showStatus('status', `${getMessage('importError')}: Failed to apply settings`, 'error');
        }
    } catch (error) {
        console.error('Import error:', error);
        const message = error instanceof Error ? error.message : String(error);
        showStatus('status', `${getMessage('importError')}: ${message}`, 'error');
    }

    closeImportModal();
});

// Close modal on escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !importConfirmModal?.classList.contains('hidden')) {
        closeImportModal();
    }
});

// Close modal when clicking outside
importConfirmModal?.addEventListener('click', (e) => {
    if (e.target === importConfirmModal) {
        closeImportModal();
    }
});

// Show import preview (HTML-safe)
function showImportPreview(data) {
    if (!importPreview) return;

    // Create a summary view (hide sensitive data)
    const summary = {
        version: data.version,
        exportedAt: new Date(data.exportedAt).toLocaleString(),
    };

    // Summarize key settings without revealing sensitive data
    const s = data.settings;
    summary.obsidian_protocol = s.obsidian_protocol;
    summary.obsidian_port = s.obsidian_port;
    summary.obsidian_daily_path = s.obsidian_daily_path;
    summary.ai_provider = s.ai_provider;
    summary.gemini_model = s.gemini_model;
    summary.openai_model = s.openai_model;
    summary.openai_2_model = s.openai_2_model;
    summary.min_visit_duration = String(s.min_visit_duration);
    summary.min_scroll_depth = String(s.min_scroll_depth);
    summary.domain_filter_mode = s.domain_filter_mode;
    summary.privacy_mode = s.privacy_mode;
    summary.domain_count = String(
        (s.domain_whitelist?.length || 0) + (s.domain_blacklist?.length || 0)
    );
    summary.ublock_sources_count = String(s.ublock_sources?.length || 0);

    importPreview.textContent = `Summary:\n${JSON.stringify(summary, null, 2)}\n\n` +
        `Note: Full settings will be applied. API keys and lists are included in the file.`;
}

console.log('[Popup] Initialization sequence complete');
