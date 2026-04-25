/**
 * popup.ts
 * 設定画面のメイン初期化モジュール
 */

import { logError, ErrorCode } from '../utils/logger.js';
import { init as initNavigation } from './navigation.js';
import { init as initDomainFilter, loadDomainSettings } from './domainFilter.js';
import { init as initPrivacySettings, loadPrivacySettings } from './privacySettings.js';
import { initCustomPromptManager } from './customPromptManager.js';
import { setupAIProviderChangeListener } from './settings/aiProvider.js';
import { setupAllFieldValidations, clearAllFieldErrors } from './settings/fieldValidation.js';
import { setupSaveButtonListener } from './settings/settingsSaver.js';
import { initPrivacyConsent, setupPrivacyConsentListeners } from './privacyConsentController.js';

import {
    apiKeyInput,
    protocolInput,
    portInput,
    dailyPathInput,
    aiProviderSelect,
    geminiSettingsDiv,
    openaiSettingsDiv,
    openai2SettingsDiv,
    geminiApiKeyInput,
    geminiModelInput,
    openaiBaseUrlInput,
    openaiApiKeyInput,
    openaiModelInput,
    openai2BaseUrlInput,
    openai2ApiKeyInput,
    openai2ModelInput,
    minVisitDurationInput,
    minScrollDepthInput,
    maxTokensPerPromptInput,
    saveBtn,
    statusDiv,
    settingsMapping,
    aiProviderElements,
    errorPairs,
    load
} from './settingsForm.js';

import { initSettingsExportImportUi } from './settingsExportImportUi.js';
import { initMasterPasswordUi, loadMasterPasswordSettings, showPasswordAuthModal } from './masterPasswordUi.js';
import { initTrancoUpdateNotification } from './trancoNotification.js';

// ============================================================================
// Tab Navigation
// ============================================================================

export function initTabNavigation(): void {
    const tabButtons = document.querySelectorAll<HTMLButtonElement>('#tabList .tab-btn');
    const tabPanels = document.querySelectorAll<HTMLElement>('.tab-panel');

    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetPanelId = btn.getAttribute('aria-controls');
            if (!targetPanelId) return;

            tabButtons.forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');

            tabPanels.forEach(panel => {
                if (panel.id === targetPanelId) {
                    panel.classList.add('active');
                    panel.removeAttribute('style');
                    panel.setAttribute('aria-hidden', 'false');
                } else {
                    panel.classList.remove('active');
                    panel.removeAttribute('style');
                    panel.setAttribute('aria-hidden', 'true');
                }
            });
        });
    });
}

// ============================================================================
// Helper Functions (exported for testability)
// ============================================================================

export function setHtmlLangDir(): void {
    const locale = chrome.i18n.getUILanguage();
    const langCode = locale.split('-')[0];
    document.documentElement.lang = locale;

    const rtlLanguages = ['ar', 'he', 'fa', 'ur', 'ku', 'yi', 'dv'];
    if (rtlLanguages.includes(langCode)) {
        document.documentElement.dir = 'rtl';
    } else {
        document.documentElement.dir = 'ltr';
    }
}

async function initCustomPromptFeature(): Promise<void> {
    try {
        const { getSettings } = await import('../utils/storage.js');
        const settings = await getSettings();
        initCustomPromptManager(settings);
    } catch (error) {
        logError('[Popup] Error in initCustomPromptManager', { cause: error }, ErrorCode.INTERNAL_ERROR);
    }
}

// ============================================================================
// Main Initialization Function (exported for testability)
// ============================================================================

export function initPopup(): void {
    // Settings Export/Import UI Initialization
    initSettingsExportImportUi(load, showPasswordAuthModal);

    // Master Password UI Initialization
    initMasterPasswordUi();

    // HTML lang/dir setup
    try {
        setHtmlLangDir();
    } catch (error) {
        logError('[Popup] Error setting HTML lang/dir', { cause: error }, ErrorCode.INTERNAL_ERROR);
    }

    // Navigation initialization
    try {
        initNavigation();
    } catch (error) {
        logError('[Popup] Error in initNavigation', { cause: error }, ErrorCode.INTERNAL_ERROR);
    }

    // Tab navigation initialization
    try {
        initTabNavigation();
    } catch (error) {
        logError('[Popup] Error in initTabNavigation', { cause: error }, ErrorCode.INTERNAL_ERROR);
    }

    // Domain filter initialization
    try {
        initDomainFilter();
    } catch (error) {
        logError('[Popup] Error in initDomainFilter', { cause: error }, ErrorCode.INTERNAL_ERROR);
    }

    // Privacy settings initialization
    try {
        initPrivacySettings();
    } catch (error) {
        logError('[Popup] Error in initPrivacySettings', { cause: error }, ErrorCode.INTERNAL_ERROR);
    }

    // Custom prompt feature initialization
    initCustomPromptFeature();

    // Load settings
    try {
        load();
    } catch (error) {
        logError('[Popup] Error in load', { cause: error }, ErrorCode.INTERNAL_ERROR);
    }

    // AI provider change listener
    setupAIProviderChangeListener(aiProviderElements);

    // Field validations
    setupAllFieldValidations(
        protocolInput,
        portInput,
        minVisitDurationInput,
        minScrollDepthInput,
        maxTokensPerPromptInput
    );

    // Save button listener
    if (saveBtn && statusDiv && protocolInput && portInput && minVisitDurationInput && minScrollDepthInput && maxTokensPerPromptInput) {
        setupSaveButtonListener(
            saveBtn,
            statusDiv,
            protocolInput,
            portInput,
            minVisitDurationInput,
            minScrollDepthInput,
            maxTokensPerPromptInput,
            settingsMapping as Record<string, HTMLInputElement | HTMLSelectElement>
        );
    }

    // Privacy Consent Initialization
    try {
        initPrivacyConsent();
    } catch (error) {
        logError('[Popup] Error in initPrivacyConsent', { cause: error }, ErrorCode.INTERNAL_ERROR);
    }

    try {
        setupPrivacyConsentListeners();
    } catch (error) {
        logError('[Popup] Error in setupPrivacyConsentListeners', { cause: error }, ErrorCode.INTERNAL_ERROR);
    }

    // Master Password Settings Load
    try {
        loadMasterPasswordSettings();
    } catch (error) {
        logError('[Popup] Error in loadMasterPasswordSettings', { cause: error }, ErrorCode.INTERNAL_ERROR);
    }

    // Tranco Update Notification
    try {
        initTrancoUpdateNotification();
    } catch (error) {
        logError('[Popup] Error in initTrancoUpdateNotification', { cause: error }, ErrorCode.INTERNAL_ERROR);
    }
}

// ============================================================================
// Auto-initialize when loaded in browser context
// ============================================================================

if (typeof window !== 'undefined') {
    initPopup();
}