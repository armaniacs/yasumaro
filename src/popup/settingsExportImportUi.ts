/**
 * settingsExportImportUi.ts
 * 設定メニュー切替・エクスポート/インポート UI・インポート確認モーダル
 */

import { getSettings, saveSettingsWithAllowedUrls, Settings } from '../utils/storage.js';
import { errorMessage } from '../utils/errorUtils.js';
import { logError, ErrorCode } from '../utils/logger.js';
import {
    exportSettings,
    importSettings,
    validateExportData,
    SettingsExportData,
    exportEncryptedSettings,
    importEncryptedSettings,
    saveEncryptedExportToFile,
    isEncryptedExport,
    ExportFileData
} from '../utils/settingsExportImport.js';
import { showStatus } from './settingsUiHelper.js';
import { getMessage } from './i18n.js';
import { loadDomainSettings } from './domainFilter.js';
import { loadPrivacySettings } from './privacySettings.js';

// DOM Elements (lazily resolved for testability)
function getSettingsMenuBtnEl(): HTMLButtonElement | null { return document.getElementById('settingsMenuBtn') as HTMLButtonElement; }
function getSettingsMenuEl(): HTMLElement | null { return document.getElementById('settingsMenu') as HTMLElement; }
function getExportSettingsBtnEl(): HTMLButtonElement | null { return document.getElementById('exportSettingsBtn') as HTMLButtonElement; }
function getImportSettingsBtnEl(): HTMLButtonElement | null { return document.getElementById('importSettingsBtn') as HTMLButtonElement; }
function getImportFileInputEl(): HTMLInputElement | null { return document.getElementById('importFileInput') as HTMLInputElement; }
function getImportConfirmModalEl(): HTMLDialogElement | null { return document.getElementById('importConfirmModal') as HTMLDialogElement; }
function getCloseImportModalBtnEl(): HTMLButtonElement | null { return document.getElementById('closeImportModalBtn') as HTMLButtonElement; }
function getCancelImportBtnEl(): HTMLButtonElement | null { return document.getElementById('cancelImportBtn') as HTMLButtonElement; }
function getConfirmImportBtnEl(): HTMLButtonElement | null { return document.getElementById('confirmImportBtn') as HTMLButtonElement; }
function getImportPreviewEl(): HTMLElement | null { return document.getElementById('importPreview') as HTMLElement; }

let pendingImportData: Settings | null = null;
let pendingImportJson: string | null = null;

type ReloadFn = () => Promise<void>;

function initSettingsExportImportUi(reloadFn: ReloadFn, showPasswordAuthModal: (actionType: 'export' | 'import', action: (password: string) => Promise<void>) => void): void {
    const settingsMenuBtn = getSettingsMenuBtnEl();
    const settingsMenu = getSettingsMenuEl();

    if (settingsMenuBtn && settingsMenu) {
        settingsMenuBtn.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            settingsMenu.classList.toggle('hidden');
            settingsMenuBtn.setAttribute('aria-expanded',
                (!settingsMenu.classList.contains('hidden')).toString());
        });

        document.addEventListener('click', (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (settingsMenuBtn && !settingsMenuBtn.contains(target) &&
                settingsMenu && !settingsMenu.contains(target)) {
                settingsMenu.classList.add('hidden');
                settingsMenuBtn.setAttribute('aria-expanded', 'false');
            }
        });
    }

    const exportSettingsBtn = getExportSettingsBtnEl();
    const importSettingsBtn = getImportSettingsBtnEl();
    const importFileInput = getImportFileInputEl();

    exportSettingsBtn?.addEventListener('click', async () => {
        settingsMenu?.classList.add('hidden');
        settingsMenuBtn?.setAttribute('aria-expanded', 'false');

        try {
            const settings = await getSettings();
            const isMpEnabled = settings.mp_protection_enabled === true;
            const isMpEncryptOnExport = settings.mp_encrypt_on_export === true;

            if (isMpEnabled && isMpEncryptOnExport) {
                showPasswordAuthModal('export', async (password) => {
                    const result = await exportEncryptedSettings(password);
                    if (result.success && result.encryptedData) {
                        await saveEncryptedExportToFile(result.encryptedData);
                        showStatus('status', getMessage('settingsExported'), 'success');
                    } else {
                        showStatus('status', `${getMessage('exportError')}: ${result.error || 'Unknown error'}`, 'error');
                    }
                });
            } else {
                await exportSettings();
                showStatus('status', getMessage('settingsExported'), 'success');
            }
        } catch (error: unknown) {
            logError('Export error', { cause: errorMessage(error) }, ErrorCode.SETTINGS_EXPORT_FAILURE);
            showStatus('status', `${getMessage('exportError')}: ${errorMessage(error)}`, 'error');
        }
    });

    importSettingsBtn?.addEventListener('click', () => {
        settingsMenu?.classList.add('hidden');
        settingsMenuBtn?.setAttribute('aria-expanded', 'false');
        importFileInput?.click();
    });

    importFileInput?.addEventListener('change', async (e: Event) => {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const parsed = JSON.parse(text) as ExportFileData;

            if (isEncryptedExport(parsed)) {
                const settings = await getSettings();
                const isMpRequireOnImport = settings.mp_require_on_import === true;

                const handleEncryptedImport = async (password: string) => {
                    const imported = await importEncryptedSettings(text, password);
                    if (imported) {
                        showStatus('status', getMessage('settingsImported'), 'success');
                        await reloadFn();
                        await loadDomainSettings();
                        await loadPrivacySettings();
                    } else {
                        showStatus('status', `${getMessage('importError')}: Failed to decrypt or apply settings`, 'error');
                    }
                };

                if (isMpRequireOnImport) {
                    showPasswordAuthModal('import', handleEncryptedImport);
                } else {
                    const warningMsg = getMessage('importPasswordRequired') || 'Master password is required to import encrypted settings.';
                    if (confirm(warningMsg)) {
                        showPasswordAuthModal('import', handleEncryptedImport);
                    }
                }

                if (importFileInput) {
                    importFileInput.value = '';
                }
                return;
            }

            if (!validateExportData(parsed)) {
                showStatus('status', getMessage('invalidSettingsFile'), 'error');
                if (importFileInput) {
                    importFileInput.value = '';
                }
                return;
            }

            pendingImportData = parsed.settings;
            pendingImportJson = text;

            showImportPreview(parsed);

            getImportConfirmModalEl()?.showModal();

        } catch (error: unknown) {
            logError('Import error', { cause: errorMessage(error) }, ErrorCode.SETTINGS_IMPORT_FAILURE);
            showStatus('status', `${getMessage('importError')}: ${errorMessage(error)}`, 'error');
        }
    });

    getCloseImportModalBtnEl()?.addEventListener('click', closeImportModal);
    getCancelImportBtnEl()?.addEventListener('click', closeImportModal);

    getConfirmImportBtnEl()?.addEventListener('click', async () => {
        if (!pendingImportJson) {
            closeImportModal();
            return;
        }

        try {
            const imported = await importSettings(pendingImportJson);
            if (imported) {
                showStatus('status', getMessage('settingsImported'), 'success');
                await reloadFn();
                await loadDomainSettings();
                await loadPrivacySettings();
            } else {
                showStatus('status', `${getMessage('importError')}: Failed to apply settings`, 'error');
            }
        } catch (error: unknown) {
            logError('Import error', { cause: errorMessage(error) }, ErrorCode.SETTINGS_IMPORT_FAILURE);
            showStatus('status', `${getMessage('importError')}: ${errorMessage(error)}`, 'error');
        }

        closeImportModal();
    });

    const importConfirmModalOnClick = getImportConfirmModalEl();
    importConfirmModalOnClick?.addEventListener('click', (e: MouseEvent) => {
        if (e.target === importConfirmModalOnClick) {
            closeImportModal();
        }
    });

    // ESC key fires the dialog's native close without going through
    // closeImportModal(), so run the same state cleanup here too.
    importConfirmModalOnClick?.addEventListener('close', resetImportState);
}

function closeImportModal(): void {
    getImportConfirmModalEl()?.close();
}

function resetImportState(): void {
    pendingImportData = null;
    pendingImportJson = null;
    const importPreview = getImportPreviewEl();
    if (importPreview) {
        importPreview.textContent = '';
    }
}

function showImportPreview(data: SettingsExportData): void {
    const importPreview = getImportPreviewEl();
    if (!importPreview) return;

    const summary: Record<string, unknown> = {
        version: data.version,
        exportedAt: new Date(data.exportedAt).toLocaleString(),
    };

    const s = data.settings;
    summary.obsidian_protocol = s.obsidian_protocol;
    summary.obsidian_port = s.obsidian_port;
    summary.obsidian_daily_path = s.obsidian_daily_path;
    summary.ai_provider = s.ai_provider;
    summary.gemini_model = s.gemini_model;
    summary.openai_model = s.openai_model;
    summary.openai_2_model = s.openai_2_model;
    summary.min_visit_duration = String(s.min_visit_duration);
    summary.min_scroll_depth = String(s.min_scroll_depth);
    summary.domain_filter_mode = s.domain_filter_mode;
    summary.privacy_mode = s.privacy_mode;
    summary.domain_count = String(
        (s.domain_whitelist?.length || 0) + (s.domain_blacklist?.length || 0)
    );
    summary.ublock_sources_count = String(s.ublock_sources?.length || 0);

    const summaryMsg = chrome.i18n.getMessage('importPreviewSummary') || 'Summary:';
    const noteMsg = chrome.i18n.getMessage('importPreviewNote') || 'Note: Full settings will be applied. API keys and lists are included in the file.';

    importPreview.textContent = `${summaryMsg}\n${JSON.stringify(summary, null, 2)}\n\n${noteMsg}`;
}

export { initSettingsExportImportUi };