/**
 * popup.ts
 * 設定画面のメイン初期化モジュール
 */
import { StorageKeys, getSettings } from '../utils/storage.js';
import { init as initNavigation } from './navigation.js';
import { init as initDomainFilter, loadDomainSettings } from './domainFilter.js';
import { init as initPrivacySettings, loadPrivacySettings } from './privacySettings.js';
import { initCustomPromptManager } from './customPromptManager.js';
import { loadSettingsToInputs, showStatus } from './settingsUiHelper.js';
import { getMessage } from './i18n.js';
import { exportSettings, importSettings, validateExportData } from '../utils/settingsExportImport.js';
import { setupAIProviderChangeListener, updateAIProviderVisibility } from './settings/aiProvider.js';
import { setupAllFieldValidations } from './settings/fieldValidation.js';
import { setupSaveButtonListener } from './settings/settingsSaver.js';
import { focusTrapManager } from './utils/focusTrap.js';
// ============================================================================
// DOM Elements - Settings Form
// ============================================================================
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
// ============================================================================
// AI Provider UI
// ============================================================================
const aiProviderElements = {
    select: aiProviderSelect,
    geminiSettings: geminiSettingsDiv,
    openaiSettings: openaiSettingsDiv,
    openai2Settings: openai2SettingsDiv
};
// ============================================================================
// Load Settings
// ============================================================================
async function load() {
    const settings = await getSettings();
    loadSettingsToInputs(settings, settingsMapping);
    updateAIProviderVisibility(aiProviderElements);
}
// ============================================================================
// Field Validation (setup on initialization)
// ============================================================================
const errorPairs = [
    [protocolInput, 'protocolError'],
    [portInput, 'portError'],
    [minVisitDurationInput, 'minVisitDurationError'],
    [minScrollDepthInput, 'minScrollDepthError']
];
// ============================================================================
// Settings Export/Import functionality
// ============================================================================
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
// Import modal focus management
let importTrapId = null;
let pendingImportData = null;
let pendingImportJson = null;
// Toggle settings menu
if (settingsMenuBtn && settingsMenu) {
    settingsMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsMenu.classList.toggle('hidden');
        settingsMenuBtn.setAttribute('aria-expanded', (!settingsMenu.classList.contains('hidden')).toString());
    });
    document.addEventListener('click', (e) => {
        const target = e.target;
        if (settingsMenuBtn && !settingsMenuBtn.contains(target) &&
            settingsMenu && !settingsMenu.contains(target)) {
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
    }
    catch (error) {
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
    const input = e.target;
    const file = input.files?.[0];
    if (!file)
        return;
    try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!validateExportData(parsed)) {
            showStatus('status', getMessage('invalidSettingsFile'), 'error');
            return;
        }
        pendingImportData = parsed.settings;
        pendingImportJson = text;
        showImportPreview(parsed);
        if (importConfirmModal) {
            // Show modal
            importConfirmModal.classList.remove('hidden');
            importConfirmModal.style.display = 'flex';
            void importConfirmModal.offsetHeight;
            importConfirmModal.classList.add('show');
            // Set up focus trap with the new manager
            importTrapId = focusTrapManager.trap(importConfirmModal, closeImportModal);
        }
    }
    catch (error) {
        console.error('Import error:', error);
        const message = error instanceof Error ? error.message : String(error);
        showStatus('status', `${getMessage('importError')}: ${message}`, 'error');
    }
    if (importFileInput) {
        importFileInput.value = '';
    }
});
// Close import modal
function closeImportModal() {
    if (importConfirmModal) {
        // Release focus trap
        if (importTrapId) {
            focusTrapManager.release(importTrapId);
            importTrapId = null;
        }
        importConfirmModal.classList.remove('show');
        importConfirmModal.style.display = 'none';
        importConfirmModal.classList.add('hidden');
    }
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
            await load();
            await loadDomainSettings();
            await loadPrivacySettings();
        }
        else {
            showStatus('status', `${getMessage('importError')}: Failed to apply settings`, 'error');
        }
    }
    catch (error) {
        console.error('Import error:', error);
        const message = error instanceof Error ? error.message : String(error);
        showStatus('status', `${getMessage('importError')}: ${message}`, 'error');
    }
    closeImportModal();
});
// Close modal on escape key (now handled by focus trap)
// document.addEventListener('keydown', (e) => {
//     if (e.key === 'Escape' && !importConfirmModal?.classList.contains('hidden')) {
//         closeImportModal();
//     }
// });
// Close modal when clicking outside
importConfirmModal?.addEventListener('click', (e) => {
    if (e.target === importConfirmModal) {
        closeImportModal();
    }
});
// Show import preview (HTML-safe)
function showImportPreview(data) {
    if (!importPreview)
        return;
    const summary = {
        version: data.version,
        exportedAt: new Date(data.exportedAt).toLocaleString(),
    };
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
    summary.domain_count = String((s.domain_whitelist?.length || 0) + (s.domain_blacklist?.length || 0));
    summary.ublock_sources_count = String(s.ublock_sources?.length || 0);
    importPreview.textContent = `Summary:\n${JSON.stringify(summary, null, 2)}\n\n` +
        `Note: Full settings will be applied. API keys and lists are included in the file.`;
}
// ============================================================================
// Tab Navigation
// ============================================================================
function initTabNavigation() {
    const tabButtons = document.querySelectorAll('#tabList .tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetPanelId = btn.getAttribute('aria-controls');
            if (!targetPanelId)
                return;
            // Update tab buttons
            tabButtons.forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            // Update panels
            tabPanels.forEach(panel => {
                if (panel.id === targetPanelId) {
                    panel.classList.add('active');
                    panel.setAttribute('aria-hidden', 'false');
                }
                else {
                    panel.classList.remove('active');
                    panel.setAttribute('aria-hidden', 'true');
                }
            });
        });
    });
}
// ============================================================================
// Initialization
// ============================================================================
console.log('[Popup] Starting initialization...');
try {
    console.log('[Popup] Calling initNavigation...');
    initNavigation();
    console.log('[Popup] initNavigation complete');
}
catch (error) {
    console.error('[Popup] Error in initNavigation:', error);
}
try {
    initTabNavigation();
}
catch (error) {
    console.error('[Popup] Error in initTabNavigation:', error);
}
try {
    console.log('[Popup] Calling initDomainFilter...');
    initDomainFilter();
    console.log('[Popup] initDomainFilter complete');
}
catch (error) {
    console.error('[Popup] Error in initDomainFilter:', error);
}
try {
    console.log('[Popup] Calling initPrivacySettings...');
    initPrivacySettings();
    console.log('[Popup] initPrivacySettings complete');
}
catch (error) {
    console.error('[Popup] Error in initPrivacySettings:', error);
}
// Load settings and initialize custom prompt manager after other modules
async function initCustomPromptFeature() {
    try {
        const settings = await getSettings();
        initCustomPromptManager(settings);
        console.log('[Popup] initCustomPromptManager complete');
    }
    catch (error) {
        console.error('[Popup] Error in initCustomPromptManager:', error);
    }
}
initCustomPromptFeature();
try {
    console.log('[Popup] Calling load...');
    load();
    console.log('[Popup] load complete');
}
catch (error) {
    console.error('[Popup] Error in load:', error);
}
// Setup AI provider change listener
setupAIProviderChangeListener(aiProviderElements);
// Setup field validation listeners
setupAllFieldValidations(protocolInput, portInput, minVisitDurationInput, minScrollDepthInput);
// Setup save button listener
if (saveBtn) {
    setupSaveButtonListener(saveBtn, statusDiv, protocolInput, portInput, minVisitDurationInput, minScrollDepthInput, settingsMapping);
}
console.log('[Popup] Initialization sequence complete');
//# sourceMappingURL=popup.js.map