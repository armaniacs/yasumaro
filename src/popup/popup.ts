/**
 * popup.ts
 * ポップアップのメイン初期化モジュール
 *
 * PBI-27: 設定 UI は dashboard (options.html) に集約し、popup では
 * mainScreen の機能（ページ記録、ステータス、同意、ペンディングページなど）
 * のみを初期化する。
 */

import { logError, ErrorCode } from '../utils/logger.js';
import { init as initNavigation } from './navigation.js';
import { initPrivacyConsent, setupPrivacyConsentListeners } from './privacyConsentController.js';
import { initTrancoUpdateNotification } from './trancoNotification.js';
import { loadPendingPages } from './pendingPages.js';
import { getPendingPages, isPrivacyPendingReason, renderPendingReason } from '../utils/pendingStorage.js';
import { showPrivatePageDialog, showRecordingFailedDialog } from './privatePageDialog.js';
import { getPrivacyConsent } from './privacyConsent.js';
import { hasCompletedWizard, initOnboardingWizard } from './onboardingWizard.js';

// ============================================================================
// Helper Functions (exported for testability)
// ============================================================================

export function setHtmlLangDir(): void {
    const locale = chrome.i18n.getUILanguage();
    const langCode = locale.split('-')[0];
    document.documentElement.lang = locale;

    const rtlLanguages = ['ar', 'he', 'fa', 'ur', 'ku', 'yi', 'dv'];
    if (langCode != null && rtlLanguages.includes(langCode)) {
        document.documentElement.dir = 'rtl';
    } else {
        document.documentElement.dir = 'ltr';
    }
}

// ============================================================================
// Main Initialization Function (exported for testability)
// ============================================================================

export async function initPopup(): Promise<void> {
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
            if (page != null) {
                if (isPrivacyPendingReason(page.reason)) {
                    showPrivatePageDialog(page.url, page.reason, page.headerValue || '');
                } else {
                    showRecordingFailedDialog(page.url, renderPendingReason(page.reason));
                }
            }
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