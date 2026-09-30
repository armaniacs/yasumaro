/**
 * trancoNotification.ts
 * Tranco 更新通知バナー UI と同意処理
 */

import { settingsRepository } from '../utils/storage/SettingsRepository.js';
import { needsTrancoConsent, persistTrancoConsentDeny, persistTrancoConsentGrant } from '../utils/storage/trancoConsent.js';
import { StorageKeys } from '../utils/storage/types.js';
import { ErrorCode } from '../utils/logger/types.js';
import { logError } from '../utils/logger/api.js';
import { getMessage } from '../utils/i18n.js';
import { clearElement } from './domUtils.js';

async function initTrancoUpdateNotification(): Promise<void> {
    const banner = document.getElementById('trancoUpdateBanner');
    const desc = document.getElementById('trancoUpdateDesc');
    const actions = document.getElementById('trancoUpdateActions');

    if (!banner || !desc || !actions) {
        console.warn('[Popup] Tranco update banner elements not found');
        return;
    }

    try {
        const settings = await settingsRepository.getAll();
        const currentVersion = settings[StorageKeys.TRANCO_VERSION] as string | null;
        const grantedVersion = settings[StorageKeys.TRANCO_CONSENT_GRANTED] as string | null;
        const deniedTimestamp = settings[StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP] as number | null;

        if (!currentVersion) {
            return;
        }

        const needsConsent = needsTrancoConsent({
            currentVersion,
            grantedVersion,
            deniedTimestamp,
        });

        if (!needsConsent) {
            return;
        }

        banner.classList.remove('hidden');

        const messageKey = 'trancoUpdateNotificationDescription';
        desc.textContent = getMessage(messageKey);

        clearElement(actions);

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
        await persistTrancoConsentGrant(version);

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
        await persistTrancoConsentDeny();

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