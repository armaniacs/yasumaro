/**
 * popup.ts
 * 設定画面のメイン初期化モジュール
 */

import { StorageKeys, saveSettingsWithAllowedUrls, getSettings, Settings } from '../utils/storage.js';
import { init as initNavigation } from './navigation.js';
import { init as initDomainFilter, loadDomainSettings } from './domainFilter.js';
import { init as initPrivacySettings, loadPrivacySettings } from './privacySettings.js';
import { initCustomPromptManager } from './customPromptManager.js';
import { loadSettingsToInputs, extractSettingsFromInputs, showStatus } from './settingsUiHelper.js';
import { getMessage } from './i18n.js';
import { exportSettings, importSettings, validateExportData, SettingsExportData } from '../utils/settingsExportImport.js';

import { setupAIProviderChangeListener, updateAIProviderVisibility, AIProviderElements } from './settings/aiProvider.js';
import {
    validateAllFields,
    setupAllFieldValidations,
    clearAllFieldErrors,
    validateProtocol,
    validatePort,
    validateMinVisitDuration,
    validateMinScrollDepth,
    setFieldError,
    clearFieldError
} from './settings/fieldValidation.js';
import { setupSaveButtonListener } from './settings/settingsSaver.js';
import { focusTrapManager } from './utils/focusTrap.js';

// ============================================================================
// DOM Elements - Settings Form
// ============================================================================

const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const protocolInput = document.getElementById('protocol') as HTMLInputElement;
const portInput = document.getElementById('port') as HTMLInputElement;
const dailyPathInput = document.getElementById('dailyPath') as HTMLInputElement;

const aiProviderSelect = document.getElementById('aiProvider') as HTMLSelectElement;
const geminiSettingsDiv = document.getElementById('geminiSettings') as HTMLElement;
const openaiSettingsDiv = document.getElementById('openaiSettings') as HTMLElement;
const openai2SettingsDiv = document.getElementById('openai2Settings') as HTMLElement;

const geminiApiKeyInput = document.getElementById('geminiApiKey') as HTMLInputElement;
const geminiModelInput = document.getElementById('geminiModel') as HTMLInputElement;

const openaiBaseUrlInput = document.getElementById('openaiBaseUrl') as HTMLInputElement;
const openaiApiKeyInput = document.getElementById('openaiApiKey') as HTMLInputElement;
const openaiModelInput = document.getElementById('openaiModel') as HTMLInputElement;

const openai2BaseUrlInput = document.getElementById('openai2BaseUrl') as HTMLInputElement;
const openai2ApiKeyInput = document.getElementById('openai2ApiKey') as HTMLInputElement;
const openai2ModelInput = document.getElementById('openai2Model') as HTMLInputElement;

const minVisitDurationInput = document.getElementById('minVisitDuration') as HTMLInputElement;
const minScrollDepthInput = document.getElementById('minScrollDepth') as HTMLInputElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLElement;

// Mapping of StorageKeys to DOM elements
const settingsMapping: Record<string, HTMLInputElement | HTMLSelectElement> = {
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

const aiProviderElements: AIProviderElements = {
    select: aiProviderSelect,
    geminiSettings: geminiSettingsDiv,
    openaiSettings: openaiSettingsDiv,
    openai2Settings: openai2SettingsDiv
};

// ============================================================================
// Load Settings
// ============================================================================

async function load(): Promise<void> {
    const settings = await getSettings();
    loadSettingsToInputs(settings, settingsMapping);
    updateAIProviderVisibility(aiProviderElements);
}

// ============================================================================
// Field Validation (setup on initialization)
// ============================================================================

const errorPairs: [HTMLInputElement, string][] = [
    [protocolInput, 'protocolError'],
    [portInput, 'portError'],
    [minVisitDurationInput, 'minVisitDurationError'],
    [minScrollDepthInput, 'minScrollDepthError']
];

// ============================================================================
// Settings Export/Import functionality
// ============================================================================

// Settings menu elements
const settingsMenuBtn = document.getElementById('settingsMenuBtn') as HTMLButtonElement | null;
const settingsMenu = document.getElementById('settingsMenu') as HTMLElement | null;
const exportSettingsBtn = document.getElementById('exportSettingsBtn') as HTMLButtonElement | null;
const importSettingsBtn = document.getElementById('importSettingsBtn') as HTMLButtonElement | null;
const importFileInput = document.getElementById('importFileInput') as HTMLInputElement | null;

// Import confirmation modal elements
const importConfirmModal = document.getElementById('importConfirmModal') as HTMLElement | null;
const closeImportModalBtn = document.getElementById('closeImportModalBtn') as HTMLButtonElement | null;
const cancelImportBtn = document.getElementById('cancelImportBtn') as HTMLButtonElement | null;
const confirmImportBtn = document.getElementById('confirmImportBtn') as HTMLButtonElement | null;
const importPreview = document.getElementById('importPreview') as HTMLElement | null;

// Import modal focus management
let importTrapId: string | null = null;

let pendingImportData: Settings | null = null;
let pendingImportJson: string | null = null;

// Toggle settings menu
if (settingsMenuBtn && settingsMenu) {
    settingsMenuBtn.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        settingsMenu.classList.toggle('hidden');
        settingsMenuBtn.setAttribute('aria-expanded',
            (!settingsMenu.classList.contains('hidden')).toString());
    });

    document.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
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
    } catch (error: any) {
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
importFileInput?.addEventListener('change', async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
        const text = await file.text();
        const parsed = JSON.parse(text) as SettingsExportData;

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

    } catch (error: any) {
        console.error('Import error:', error);
        const message = error instanceof Error ? error.message : String(error);
        showStatus('status', `${getMessage('importError')}: ${message}`, 'error');
    }

    if (importFileInput) {
        importFileInput.value = '';
    }
});

// Close import modal
function closeImportModal(): void {
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
        } else {
            showStatus('status', `${getMessage('importError')}: Failed to apply settings`, 'error');
        }
    } catch (error: any) {
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
importConfirmModal?.addEventListener('click', (e: MouseEvent) => {
    if (e.target === importConfirmModal) {
        closeImportModal();
    }
});

// Show import preview (HTML-safe)
function showImportPreview(data: SettingsExportData): void {
    if (!importPreview) return;

    const summary: any = {
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
    summary.domain_count = String(
        (s.domain_whitelist?.length || 0) + (s.domain_blacklist?.length || 0)
    );
    summary.ublock_sources_count = String(s.ublock_sources?.length || 0);

    const summaryMsg = chrome.i18n.getMessage('importPreviewSummary');
    const noteMsg = chrome.i18n.getMessage('importPreviewNote');

    importPreview.textContent = `${summaryMsg}\n${JSON.stringify(summary, null, 2)}\n\n${noteMsg}`;
}

// ============================================================================
// Tab Navigation
// ============================================================================

function initTabNavigation(): void {
    const tabButtons = document.querySelectorAll<HTMLButtonElement>('#tabList .tab-btn');
    const tabPanels = document.querySelectorAll<HTMLElement>('.tab-panel');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetPanelId = btn.getAttribute('aria-controls');
            if (!targetPanelId) return;

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
                } else {
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
} catch (error) {
    console.error('[Popup] Error in initNavigation:', error);
}

try {
    initTabNavigation();
} catch (error) {
    console.error('[Popup] Error in initTabNavigation:', error);
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

// Load settings and initialize custom prompt manager after other modules
async function initCustomPromptFeature(): Promise<void> {
    try {
        const settings = await getSettings();
        initCustomPromptManager(settings);
        console.log('[Popup] initCustomPromptManager complete');
    } catch (error) {
        console.error('[Popup] Error in initCustomPromptManager:', error);
    }
}
initCustomPromptFeature();

try {
    console.log('[Popup] Calling load...');
    load();
    console.log('[Popup] load complete');
} catch (error) {
    console.error('[Popup] Error in load:', error);
}

// Setup AI provider change listener
setupAIProviderChangeListener(aiProviderElements);

// Setup field validation listeners
setupAllFieldValidations(
    protocolInput,
    portInput,
    minVisitDurationInput,
    minScrollDepthInput
);

// Setup save button listener
if (saveBtn) {
    setupSaveButtonListener(
        saveBtn,
        statusDiv,
        protocolInput,
        portInput,
        minVisitDurationInput,
        minScrollDepthInput,
        settingsMapping
    );
}

console.log('[Popup] Initialization sequence complete');