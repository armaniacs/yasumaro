/**
 * consentBadge.ts
 * Toolbar badge indicator reflecting privacy consent state (M3)
 *
 * Uses a global badge (no tabId) so it does not conflict with the
 * per-tab transient badges used for recording status.
 */

import { hasPrivacyConsent } from '../utils/storage/privacyConsent.js';
import { setBadge } from './badgePolicy.js';
import { logWarn } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';

/**
 * Reflects the current privacy consent state on the extension's toolbar icon.
 * Call this after any consent state change and on Service Worker startup/install.
 * Consent is inherently GLOBAL state — the only badge kind written without a
 * tabId (PBI 2026-09-12-07).
 */
export async function updateConsentBadge(): Promise<void> {
    try {
        const consented = await hasPrivacyConsent();

        if (consented) {
            await setBadge({ kind: 'clear' });
            return;
        }

        await setBadge({ kind: 'no-consent' });
    } catch (error) {
        logWarn(
            '[ConsentBadge] Failed to update consent badge',
            { error: errorMessage(error) },
            undefined,
            'consentBadge.ts'
        );
    }
}
