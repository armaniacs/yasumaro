/**
 * privacySettings.ts
 * Privacy settings functionality for the popup UI.
 */

import { settingsRepository } from '../../utils/storage/SettingsRepository.js';
import { StorageKeys } from '../../utils/storage/types.js';
import { errorMessage } from '../../utils/errorUtils.js';
import { LogType } from '../../utils/logger/types.js';
import { addLog } from '../../utils/logger/core.js';
import { showStatus } from '../../utils/ui/settingsUiHelper.js';
import { getMessage } from '../../utils/i18n.js';
import { sanitizeRegex } from '../../utils/piiSanitizer.js';

/** Fixed dummy text used to preview PII masking behavior (M4). Never sent anywhere. */
const PII_SAMPLE_TEXT = 'Contact John Smith at john.smith@example.com or 090-1234-5678.';

interface PrivacySettingsDom {
    savePrivacySettingsBtn: HTMLElement | null;
    confirmCheckbox: HTMLInputElement | null;
}

export interface PrivacySettingsController {
    /** Wire the save button and mode radios. Re-resolves the DOM first. */
    init(): void;
    /** Re-read persisted privacy settings into the panel. */
    loadPrivacySettings(): Promise<void>;
    /**
     * Detach every listener this instance attached and drop every element
     * reference. A later init() re-resolves from the document.
     */
    destroy(): void;
}

export function createPrivacySettings(): PrivacySettingsController {
    let dom: PrivacySettingsDom | null = null;
    /** Removers for every listener init() attached, in attach order. */
    const teardown: Array<() => void> = [];

    /**
     * Resolve all DOM references. Called at the top of init() and lazily by
     * the other entries so importing this module never touches `document`.
     */
    function resolveDom(): void {
        dom = {
            savePrivacySettingsBtn: document.getElementById('savePrivacySettings'),
            confirmCheckbox: document.getElementById('piiConfirm') as HTMLInputElement | null,
        };
    }

    /** Resolve on first use so direct calls work without init(). */
    function ensureDom(): void {
        if (!dom) resolveDom();
    }

    /** Attach a listener and record how to undo it, so destroy() is complete. */
    function listen(target: EventTarget | null | undefined, type: string, handler: EventListenerOrEventListenerObject): void {
        if (!target) return;
        target.addEventListener(type, handler);
        teardown.push(() => target.removeEventListener(type, handler));
    }

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

    function init(): void {
        destroy();
        resolveDom();

        // Save settings
        if (dom?.savePrivacySettingsBtn) {
            listen(dom.savePrivacySettingsBtn, 'click', (() => { void savePrivacySettings(); }) as EventListener);
        }

        // Load settings
        void loadPrivacySettings();

        // Render PII masking before/after sample (M4)
        void renderPiiSample();

        // React to privacy mode changes for cloud provider guard
        const modeRadios = document.querySelectorAll('input[name="privacyMode"]');
        modeRadios.forEach(radio => {
            listen(radio, 'change', () => {
                if ((radio as HTMLInputElement).checked) {
                    toggleCloudProviderSettings((radio as HTMLInputElement).value === 'local_only');
                }
            });
        });
    }

    async function loadPrivacySettings(): Promise<void> {
        ensureDom();
        const settings = await settingsRepository.getAll();

        // Mode
        const mode = settings[StorageKeys.PRIVACY_MODE] || 'full_pipeline';
        const radio = document.querySelector(`input[name="privacyMode"][value="${mode}"]`) as HTMLInputElement | null;
        if (radio) {
            radio.checked = true;
        }

        // Apply cloud provider guard based on current mode
        toggleCloudProviderSettings(mode === 'local_only');

        // Confirmation
        if (dom?.confirmCheckbox) {
            dom.confirmCheckbox.checked = settings[StorageKeys.PII_CONFIRMATION_UI] !== false; // Default true
        }

        // Auto-save privacy behavior
        const behavior = settings[StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR] || 'save';
        const behaviorRadio = document.querySelector(`input[name="autoSavePrivacyBehavior"][value="${behavior}"]`) as HTMLInputElement | null;
        if (behaviorRadio) {
            behaviorRadio.checked = true;
        }
    }

    /**
     * Show a fixed dummy sample before/after PII masking, so users can see
     * what kind of data gets redacted before cloud AI submission (M4).
     */
    async function renderPiiSample(): Promise<void> {
        const originalEl = document.getElementById('piiSampleOriginal');
        const maskedEl = document.getElementById('piiSampleMasked');
        if (!originalEl || !maskedEl) return;

        originalEl.textContent = PII_SAMPLE_TEXT;

        try {
            const result = await sanitizeRegex(PII_SAMPLE_TEXT, { skipSizeLimit: true });
            maskedEl.textContent = result.text;
        } catch (error) {
            addLog(LogType.ERROR, 'Error rendering PII sample', { error: errorMessage(error) });
        }
    }

    async function savePrivacySettings(): Promise<void> {
        ensureDom();
        try {
            const selectedMode = document.querySelector('input[name="privacyMode"]:checked') as HTMLInputElement | null;
            if (!selectedMode) {
                showStatus('privacyStatus', getMessage('modeRequired'), 'error');
                return;
            }

            const selectedBehavior = document.querySelector('input[name="autoSavePrivacyBehavior"]:checked') as HTMLInputElement | null;
            const newSettings = {
                [StorageKeys.PRIVACY_MODE]: selectedMode.value,
                [StorageKeys.PII_CONFIRMATION_UI]: dom?.confirmCheckbox ? dom.confirmCheckbox.checked : true,
                [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: (selectedBehavior?.value || 'save') as 'save' | 'skip' | 'confirm'
            };

            await settingsRepository.setAll(newSettings);
            showStatus('privacyStatus', getMessage('privacySaved'), 'success');

        } catch (error: unknown) {
            addLog(LogType.ERROR, 'Error saving privacy settings', { error: errorMessage(error) });
            showStatus('privacyStatus', `${getMessage('saveError')}: ${errorMessage(error)}`, 'error');
        }
    }

    function destroy(): void {
        for (const off of teardown.splice(0)) off();
        dom = null;
    }

    return {
        init,
        loadPrivacySettings,
        destroy,
    };
}

/**
 * The instance the module-level functions below delegate to. One per page is
 * the whole reason this module is a singleton today; `createPrivacySettings`
 * exists so a test (or a second mount) can hold an isolated one instead.
 */
const sharedSettings = createPrivacySettings();

export function init(): void {
    sharedSettings.init();
}

export function loadPrivacySettings(): Promise<void> {
    return sharedSettings.loadPrivacySettings();
}

export function destroyPrivacySettings(): void {
    sharedSettings.destroy();
}
