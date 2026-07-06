/**
 * privacySettings.ts
 * Privacy settings functionality for the popup UI.
 */

import { StorageKeys, saveSettings, getSettings } from '../utils/storage.js';
import { errorMessage } from '../utils/errorUtils.js';
import { addLog, LogType } from '../utils/logger.js';
import { showStatus } from './settingsUiHelper.js';
import { getMessage } from './i18n.js';

// Elements
const savePrivacySettingsBtn = document.getElementById('savePrivacySettings');
const confirmCheckbox = document.getElementById('piiConfirm') as HTMLInputElement | null;

/**
 * Toggle cloud provider settings disabled state based on privacy mode.
 * When local_only is selected, cloud provider settings are disabled.
 */
function toggleCloudProviderSettings(disabled: boolean): void {
    const providerSelect = document.getElementById('aiProvider') as HTMLSelectElement | null;
    const geminiSettings = document.getElementById('geminiSettings');
    const openaiSettings = document.getElementById('openaiSettings');
    const openai2Settings = document.getElementById('openai2Settings');

    if (providerSelect) providerSelect.disabled = disabled;
    if (geminiSettings) {
        geminiSettings.querySelectorAll('input').forEach(el => (el as HTMLInputElement).disabled = disabled);
    }
    if (openaiSettings) {
        openaiSettings.querySelectorAll('input').forEach(el => (el as HTMLInputElement).disabled = disabled);
    }
    if (openai2Settings) {
        openai2Settings.querySelectorAll('input').forEach(el => (el as HTMLInputElement).disabled = disabled);
    }

    // Visual feedback: dim the provider section when disabled
    const providerSection = document.getElementById('aiProvider')?.closest('.form-group')?.parentElement;
    if (providerSection) {
        providerSection.style.opacity = disabled ? '0.5' : '1';
        providerSection.style.pointerEvents = disabled ? 'none' : '';
    }
}

export function init(): void {
    // Save settings
    if (savePrivacySettingsBtn) {
        savePrivacySettingsBtn.addEventListener('click', savePrivacySettings);
    }

    // Load settings
    loadPrivacySettings();

    // React to privacy mode changes for cloud provider guard
    const modeRadios = document.querySelectorAll('input[name="privacyMode"]');
    modeRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            if ((radio as HTMLInputElement).checked) {
                toggleCloudProviderSettings((radio as HTMLInputElement).value === 'local_only');
            }
        });
    });
}

export async function loadPrivacySettings(): Promise<void> {
    const settings = await getSettings();

    // Mode
    const mode = settings[StorageKeys.PRIVACY_MODE] || 'full_pipeline';
    const radio = document.querySelector(`input[name="privacyMode"][value="${mode}"]`) as HTMLInputElement | null;
    if (radio) {
        radio.checked = true;
    }

    // Apply cloud provider guard based on current mode
    toggleCloudProviderSettings(mode === 'local_only');

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

    } catch (error: unknown) {
        addLog(LogType.ERROR, 'Error saving privacy settings', { error: errorMessage(error) });
        showStatus('privacyStatus', `${getMessage('saveError')}: ${errorMessage(error)}`, 'error');
    }
}

