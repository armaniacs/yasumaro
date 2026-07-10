/**
 * consentBadge.ts
 * Toolbar badge indicator reflecting privacy consent state (M3)
 *
 * Uses a global badge (no tabId) so it does not conflict with the
 * per-tab transient badges used for recording status.
 */

import { hasPrivacyConsent } from '../popup/privacyConsent.js';
import { BADGE_COLORS } from '../constants/appConstants.js';
import { logWarn } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';

const CONSENT_MISSING_BADGE_TEXT = '!';

/**
 * Reflects the current privacy consent state on the extension's toolbar icon.
 * Call this after any consent state change and on Service Worker startup/install.
 */
export async function updateConsentBadge(): Promise<void> {
    try {
        const consented = await hasPrivacyConsent();

        if (consented) {
            await chrome.action.setBadgeText({ text: '' });
            return;
        }

        await chrome.action.setBadgeText({ text: CONSENT_MISSING_BADGE_TEXT });
        await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS.ORANGE as string });
    } catch (error) {
        logWarn(
            '[ConsentBadge] Failed to update consent badge',
            { error: errorMessage(error) },
            undefined,
            'consentBadge.ts'
        );
    }
}
