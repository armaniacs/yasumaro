/**
 * popup.ts
 * ポップアップのメイン初期化モジュール
 *
 * PBI-27: 設定 UI は dashboard (options.html) に集約し、popup では
 * mainScreen の機能（ページ記録、ステータス、同意、ペンディングページなど）
 * のみを初期化する。
 */

import { ErrorCode } from '../utils/logger/types.js';
import { logError } from '../utils/logger/api.js';
import { init as initNavigation } from './navigation.js';
import { initPrivacyConsent, setupPrivacyConsentListeners } from './privacyConsentController.js';
import { initTrancoUpdateNotification } from './trancoNotification.js';
import { loadPendingPages, setupEventListeners } from './pendingPages.js';
import { getPendingPages, isPrivacyPendingReason, renderPendingReason } from '../utils/pendingStorage.js';
import { showPrivatePageDialog, showRecordingFailedDialog, wireDialogButtons } from './privatePageDialog.js';
import { initSkipReasonPanel } from './skipReasonPanel.js';
import { getPrivacyConsent, subscribeConsentChanges } from '../utils/storage/privacyConsent.js';
import { subscribeSessionLockRequest } from '../utils/storage/sessionLockReceiver.js';
import { isLocked as isSessionLocked } from '../utils/storage/authGuard.js';
import { clearEncryptionKeyCache } from '../utils/storage/encryptionSession.js';
import { hasCompletedWizard, initOnboardingWizard } from '../utils/ui/onboardingWizard.js';

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

    // PBI 2026-10-05-31: dialog/pending-list wiring is explicit — no
    // import-time side effects. Called from initPopup (the single entry
    // point) instead of at module load.
    try {
        setupEventListeners();
        wireDialogButtons();
    } catch (error) {
        logError('[Popup] Error in dialog wiring', { cause: error }, ErrorCode.INTERNAL_ERROR);
    }

    // Last skip reason panel (PBI 2026-10-31-01): 理由種別と回数のみの直近表示。
    // 記録が skip された直近の理由をポップアップを開いたときに見せる。
    try {
        await initSkipReasonPanel();
    } catch (error) {
        logError('[Popup] Error in skip reason panel', { cause: error }, ErrorCode.INTERNAL_ERROR);
    }

    // Pending pages handling: load list and show dialog only if exactly one pending page
    try {
        await loadPendingPages();
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
    const maybeShowOnboardingWizard = async (): Promise<void> => {
        try {
            const consent = await getPrivacyConsent();
            const showWizard = consent.hasConsented && !(await hasCompletedWizard());
            if (showWizard) {
                initOnboardingWizard();
            }
        } catch (error) {
            logError('[Popup] Error initializing onboarding wizard', { cause: error }, ErrorCode.INTERNAL_ERROR);
        }
    };

    await maybeShowOnboardingWizard();

    // A first-run user who just accepted the consent modal must see onboarding
    // in this same popup session — initPopup()'s one-shot check above already
    // ran with hasConsented=false, so re-check on consent changes rather than
    // relying on a single-shot callback tied to initialization order.
    // subscribeConsentChanges hides both delivery channels (the same-document
    // event that reaches the sender's own context, and the runtime channel
    // that reaches every other context) — the Chrome sender-not-self-delivery
    // spec stays inside privacyConsent.ts.
    subscribeConsentChanges(() => {
        void maybeShowOnboardingWizard();
    });

    // PBI 2026-10-21-12: the popup is a real fan-out destination for the
    // auto-lock notification. SESSION_LOCK_REQUEST carries no payload, so the
    // receiver re-reads authGuard's lock state: a locked re-read drops this
    // context's cached key, so the next getOrCreateEncryptionKey() call
    // re-derives instead of decrypting with the stale cached key (VULN-017's
    // extension-page half). The popup shows no lock UI of its own, so no UI
    // transition callback is wired; the response body confirms delivery to
    // the sender's retry contract. The listener is released on pagehide so
    // a closed popup leaves no dangling runtime listener.
    const disposeSessionLockReceiver = subscribeSessionLockRequest({
        isLocked: isSessionLocked,
        clearKeyCache: clearEncryptionKeyCache,
    });
    window.addEventListener('pagehide', () => disposeSessionLockReceiver(), { once: true });
}

// PBI 2026-09-11-04 (round 7): the import-time auto-run is gone — the
// entrypoint (entrypoints/popup/main.ts) calls initPopup() once after
// applyI18n, so initialization has a single entry point and order.