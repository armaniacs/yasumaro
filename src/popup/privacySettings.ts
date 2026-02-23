/**
 * privacySettings.ts
 * Privacy settings functionality for the popup UI.
 */

import { StorageKeys, saveSettings, getSettings } from '../utils/storage.js';
import { addLog, LogType } from '../utils/logger.js';
import { showStatus } from './settingsUiHelper.js';
import { getMessage } from './i18n.js';

// Elements
const savePrivacySettingsBtn = document.getElementById('savePrivacySettings');
const confirmCheckbox = document.getElementById('piiConfirm') as HTMLInputElement | null;

export function init(): void {
    // Save settings
    if (savePrivacySettingsBtn) {
        savePrivacySettingsBtn.addEventListener('click', savePrivacySettings);
    }

    // Load settings
    loadPrivacySettings();
}

export async function loadPrivacySettings(): Promise<void> {
    const settings = await getSettings();

    // Mode
    const mode = settings[StorageKeys.PRIVACY_MODE] || 'full_pipeline';
    const radio = document.querySelector(`input[name="privacyMode"][value="${mode}"]`) as HTMLInputElement | null;
    if (radio) {
        radio.checked = true;
    }

    // Confirmation
    if (confirmCheckbox) {
        confirmCheckbox.checked = settings[StorageKeys.PII_CONFIRMATION_UI] !== false; // Default true
    }

    // Auto-save privacy behavior
    const behavior = settings[StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR] || 'save';
    const behaviorRadio = document.querySelector(`input[name="autoSavePrivacyBehavior"][value="${behavior}"]`) as HTMLInputElement | null;
    if (behaviorRadio) {
        behaviorRadio.checked = true;
    }
}

async function savePrivacySettings(): Promise<void> {
    try {
        const selectedMode = document.querySelector('input[name="privacyMode"]:checked') as HTMLInputElement | null;
        if (!selectedMode) {
            showStatus('privacyStatus', getMessage('modeRequired'), 'error');
            return;
        }

        const selectedBehavior = document.querySelector('input[name="autoSavePrivacyBehavior"]:checked') as HTMLInputElement | null;
        const newSettings = {
            [StorageKeys.PRIVACY_MODE]: selectedMode.value,
            [StorageKeys.PII_CONFIRMATION_UI]: confirmCheckbox ? confirmCheckbox.checked : true,
            [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: (selectedBehavior?.value || 'save') as 'save' | 'skip' | 'confirm'
        };

        await saveSettings(newSettings);
        showStatus('privacyStatus', getMessage('privacySaved'), 'success');

    } catch (error: any) {
        addLog(LogType.ERROR, 'Error saving privacy settings', { error: error.message });
        showStatus('privacyStatus', `${getMessage('saveError')}: ${error.message}`, 'error');
    }
}

