/**
 * trancoNotification.ts
 * Tranco 更新通知バナー UI と同意処理
 */

import { StorageKeys, getSettings, saveSettingsWithAllowedUrls } from '../utils/storage.js';
import { logError, ErrorCode } from '../utils/logger.js';
import { getMessage } from './i18n.js';

async function initTrancoUpdateNotification(): Promise<void> {
    const banner = document.getElementById('trancoUpdateBanner');
    const desc = document.getElementById('trancoUpdateDesc');
    const actions = document.getElementById('trancoUpdateActions');

    if (!banner || !desc || !actions) {
        console.warn('[Popup] Tranco update banner elements not found');
        return;
    }

    try {
        const settings = await getSettings();
        const currentVersion = settings[StorageKeys.TRANCO_VERSION] as string | null;
        const grantedVersion = settings[StorageKeys.TRANCO_CONSENT_GRANTED] as string | null;
        const deniedReason = settings[StorageKeys.TRANCO_CONSENT_DENIED_REASON] as string | null;
        const deniedTimestamp = settings[StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP] as number | null;

        if (!currentVersion) {
            return;
        }

        let needsConsent = false;
        if (grantedVersion !== currentVersion) {
            if (deniedTimestamp) {
                const elapsedDays = (Date.now() - deniedTimestamp) / (1000 * 60 * 60 * 24);
                if (elapsedDays >= 30) {
                    needsConsent = true;
                }
            } else {
                needsConsent = true;
            }
        }

        if (!needsConsent) {
            return;
        }

        banner.classList.remove('hidden');

        const messageKey = 'trancoUpdateNotificationDescription';
        desc.textContent = getMessage(messageKey);

        actions.innerHTML = '';

        const acceptBtn = document.createElement('button');
        acceptBtn.className = 'btn-sm btn-banner-primary';
        acceptBtn.textContent = getMessage('trancoUpdateConfirm');
        acceptBtn.addEventListener('click', () => handleTrancoGrant(currentVersion));

        const denyBtn = document.createElement('button');
        denyBtn.className = 'btn-sm btn-banner-secondary';
        denyBtn.textContent = getMessage('trancoUpdateDeny');
        denyBtn.addEventListener('click', () => handleTrancoDeny());

        actions.appendChild(acceptBtn);
        actions.appendChild(denyBtn);

        console.log('[Popup] Tranco update notification shown');
    } catch (error) {
        logError('[Popup] Error initializing Tranco update notification', { cause: error }, ErrorCode.INTERNAL_ERROR);
    }
}

async function handleTrancoGrant(version: string): Promise<void> {
    try {
        const settings = await getSettings();

        const updatedSettings = { ...settings };
        updatedSettings[StorageKeys.TRANCO_CONSENT_GRANTED] = version;
        updatedSettings[StorageKeys.TRANCO_CONSENT_DENIED_REASON] = null;
        updatedSettings[StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP] = null;

        await saveSettingsWithAllowedUrls(updatedSettings);

        const banner = document.getElementById('trancoUpdateBanner');
        if (banner) {
            banner.classList.add('hidden');
        }

        console.log('[Popup] Tranco consent granted');
    } catch (error) {
        logError('[Popup] Error granting Tranco consent', { cause: error }, ErrorCode.INTERNAL_ERROR);
    }
}

async function handleTrancoDeny(): Promise<void> {
    try {
        const settings = await getSettings();

        const updatedSettings = { ...settings };
        updatedSettings[StorageKeys.TRANCO_CONSENT_GRANTED] = null;
        updatedSettings[StorageKeys.TRANCO_CONSENT_DENIED_REASON] = 'deny';
        updatedSettings[StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP] = Date.now();

        await saveSettingsWithAllowedUrls(updatedSettings);

        const banner = document.getElementById('trancoUpdateBanner');
        if (banner) {
            banner.classList.add('hidden');
        }

        console.log('[Popup] Tranco consent denied');
    } catch (error) {
        logError('[Popup] Error denying Tranco consent', { cause: error }, ErrorCode.INTERNAL_ERROR);
    }
}

export { initTrancoUpdateNotification };