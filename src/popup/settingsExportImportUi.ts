/**
 * settingsExportImportUi.ts
 * 設定メニュー切替・エクスポート/インポート UI・インポート確認モーダル
 */

import { getSettings, saveSettingsWithAllowedUrls, Settings } from '../utils/storage.js';
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
import { focusTrapManager } from './utils/focusTrap.js';

const settingsMenuBtn = document.getElementById('settingsMenuBtn') as HTMLButtonElement | null;
const settingsMenu = document.getElementById('settingsMenu') as HTMLElement | null;
const exportSettingsBtn = document.getElementById('exportSettingsBtn') as HTMLButtonElement | null;
const importSettingsBtn = document.getElementById('importSettingsBtn') as HTMLButtonElement | null;
const importFileInput = document.getElementById('importFileInput') as HTMLInputElement | null;

const importConfirmModal = document.getElementById('importConfirmModal') as HTMLElement | null;
const closeImportModalBtn = document.getElementById('closeImportModalBtn') as HTMLButtonElement | null;
const cancelImportBtn = document.getElementById('cancelImportBtn') as HTMLButtonElement | null;
const confirmImportBtn = document.getElementById('confirmImportBtn') as HTMLButtonElement | null;
const importPreview = document.getElementById('importPreview') as HTMLElement | null;

let importTrapId: string | null = null;

let pendingImportData: Settings | null = null;
let pendingImportJson: string | null = null;

type ReloadFn = () => Promise<void>;

function initSettingsExportImportUi(reloadFn: ReloadFn, showPasswordAuthModal: (actionType: 'export' | 'import', action: (password: string) => Promise<void>) => void): void {
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
            const errorMessage = error instanceof Error ? error.message : String(error);
            logError('Export error', { cause: errorMessage }, ErrorCode.SETTINGS_EXPORT_FAILURE);
            showStatus('status', `${getMessage('exportError')}: ${errorMessage}`, 'error');
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

            if (importConfirmModal) {
                importConfirmModal.classList.remove('hidden');
                importConfirmModal.style.display = 'flex';
                void importConfirmModal.offsetHeight;
                importConfirmModal.classList.add('show');
                importConfirmModal.setAttribute('aria-hidden', 'false');

                importTrapId = focusTrapManager.trap(importConfirmModal, closeImportModal);
            }

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logError('Import error', { cause: errorMessage }, ErrorCode.SETTINGS_IMPORT_FAILURE);
            showStatus('status', `${getMessage('importError')}: ${errorMessage}`, 'error');
        }
    });

    closeImportModalBtn?.addEventListener('click', closeImportModal);
    cancelImportBtn?.addEventListener('click', closeImportModal);

    confirmImportBtn?.addEventListener('click', async () => {
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
            const errorMessage = error instanceof Error ? error.message : String(error);
            logError('Import error', { cause: errorMessage }, ErrorCode.SETTINGS_IMPORT_FAILURE);
            showStatus('status', `${getMessage('importError')}: ${errorMessage}`, 'error');
        }

        closeImportModal();
    });

    importConfirmModal?.addEventListener('click', (e: MouseEvent) => {
        if (e.target === importConfirmModal) {
            closeImportModal();
        }
    });
}

function closeImportModal(): void {
    if (importConfirmModal) {
        importConfirmModal.setAttribute('aria-hidden', 'true');

        if (importTrapId) {
            focusTrapManager.release(importTrapId);
            importTrapId = null;
        }

        importConfirmModal.classList.remove('show');
        importConfirmModal.style.display = 'none';
        importConfirmModal.classList.add('hidden');
    }

    pendingImportData = null;
    pendingImportJson = null;
    if (importPreview) {
        importPreview.textContent = '';
    }
}

function showImportPreview(data: SettingsExportData): void {
    if (!importPreview) return;

    const summary: any = {
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