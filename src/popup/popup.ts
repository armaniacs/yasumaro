/**
 * popup.ts
 * 設定画面のメイン初期化モジュール
 */

import { logError, ErrorCode } from '../utils/logger.js';
import { init as initNavigation } from './navigation.js';
import { init as initDomainFilter } from './domainFilter.js';
import { init as initPrivacySettings } from './privacySettings.js';
import { initCustomPromptManager } from './customPromptManager.js';
import { setupAIProviderChangeListener } from './settings/aiProvider.js';
import { setupAllFieldValidations } from './settings/fieldValidation.js';
import { setupSaveButtonListener } from './settings/settingsSaver.js';
import { initPrivacyConsent, setupPrivacyConsentListeners } from './privacyConsentController.js';

import {
    getSettingsFormElements,
    getSettingsMapping,
    getAiProviderElements,
    getErrorPairs,
    load,
    setupOllamaPresetListener,
} from './settingsForm.js';

import { initSettingsExportImportUi } from './settingsExportImportUi.js';
import { initMasterPasswordUi, loadMasterPasswordSettings, showPasswordAuthModal } from './masterPasswordUi.js';
import { initTrancoUpdateNotification } from './trancoNotification.js';
import { loadPendingPages } from './pendingPages.js';
import { getPendingPages } from '../utils/pendingStorage.js';
import { showPrivatePageDialog } from './privatePageDialog.js';
import { getPrivacyConsent } from './privacyConsent.js';
import { hasCompletedWizard, initOnboardingWizard } from './onboardingWizard.js';

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
                    panel.removeAttribute('inert');
                } else {
                    panel.classList.remove('active');
                    panel.removeAttribute('style');
                    panel.setAttribute('aria-hidden', 'true');
                    panel.setAttribute('inert', '');
                }
            });
        });
    });

    // Set inert on initially hidden panels for a11y compliance
    tabPanels.forEach(panel => {
        if (!panel.classList.contains('active')) {
            panel.setAttribute('inert', '');
        }
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

export async function initPopup(): Promise<void> {
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

    const el = getSettingsFormElements();
    const aiProviderEl = getAiProviderElements();
    const settingsMap = getSettingsMapping();
    const _errors = getErrorPairs();

    // AI provider change listener
    if (aiProviderEl.select) {
        setupAIProviderChangeListener(aiProviderEl);
    }

    // Field validations
    setupAllFieldValidations(
        el.protocolInput,
        el.portInput,
        el.minVisitDurationInput,
        el.minScrollDepthInput,
        el.maxTokensPerPromptInput
    );

    // Save button listener
    if (el.saveBtn && el.statusDiv && el.protocolInput && el.portInput && el.minVisitDurationInput && el.minScrollDepthInput && el.maxTokensPerPromptInput) {
        setupSaveButtonListener(
            el.saveBtn,
            el.statusDiv,
            el.protocolInput,
            el.portInput,
            el.minVisitDurationInput,
            el.minScrollDepthInput,
            el.maxTokensPerPromptInput,
            settingsMap as Record<string, HTMLInputElement | HTMLSelectElement>
        );
    }

    // Ollama preset button
    setupOllamaPresetListener();

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

    // Pending pages handling: load list and show dialog only if exactly one pending page
    try {
        loadPendingPages();
        const pending = await getPendingPages();
        if (pending.length === 1) {
            const page = pending[0];
            showPrivatePageDialog(page.url, page.reason, page.headerValue || '');
        }
    } catch (error) {
        logError('[Popup] Error in pending pages handling', { cause: error }, ErrorCode.INTERNAL_ERROR);
    }

    // Onboarding Wizard — only show after privacy consent acceptance
    try {
        const consent = await getPrivacyConsent();
        const showWizard = consent.hasConsented && !(await hasCompletedWizard());
        if (showWizard) {
            initOnboardingWizard();
        }
    } catch (error) {
        logError('[Popup] Error initializing onboarding wizard', { cause: error }, ErrorCode.INTERNAL_ERROR);
    }
  }

// ============================================================================
// Auto-initialize when loaded in browser context
// ============================================================================

if (typeof window !== 'undefined') {
    initPopup();
}