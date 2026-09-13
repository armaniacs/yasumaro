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
import { getPrivacyConsent } from '../utils/storage/privacyConsent.js';
import { hasCompletedWizard, initOnboardingWizard } from './onboardingWizard.js';

// ============================================================================
// Main Initialization Function (exported for testability)
// ============================================================================

export async function initPopup(): Promise<void> {
    // Navigation initialization (sets lang/dir via i18n-dom's
    // setHtmlLangAndDir — the single lang/dir helper, PBI 2026-09-11-04).
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

// PBI 2026-09-11-04 (round 7): the import-time auto-run is gone — the
// entrypoint (entrypoints/popup/main.ts) calls initPopup() once after
// applyI18n, so initialization has a single entry point and order.