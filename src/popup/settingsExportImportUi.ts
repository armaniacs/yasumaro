/**
 * settingsExportImportUi.ts
 * 設定メニュー切替・エクスポート/インポート UI・インポート確認モーダル
 */

import type { Settings } from '../utils/storage.js';
import { errorMessage } from '../utils/errorUtils.js';
import { logError, ErrorCode } from '../utils/logger.js';
import { importSettings } from '../utils/settingsExportImport.js';
import type { SettingsExportData } from '../utils/settingsExportImport.js';
import { handleExport, handleFileImport, applyImportedSettings } from '../utils/settingsExportImportUiCore.js';
import type { ExportContext, ImportContext, ShowPasswordAuthModal } from '../utils/settingsExportImportUiCore.js';
import { showStatus } from './settingsUiHelper.js';
import { getMessage } from '../utils/i18n.js';
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

let _pendingImportData: Settings | null = null;
let pendingImportJson: string | null = null;

type ReloadFn = () => Promise<void>;

function initSettingsExportImportUi(reloadFn: ReloadFn, showPasswordAuthModal: ShowPasswordAuthModal): void {
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

    const exportCtx: ExportContext = {
        showStatus: (message, type) => showStatus('status', message, type),
        logExportError: (cause) => logError('Export error', { cause }, ErrorCode.SETTINGS_EXPORT_FAILURE),
    };

    const importCtx: ImportContext = {
        reloadFn,
        showStatus: (message, type) => showStatus('status', message, type),
        logImportError: (cause) => logError('Import error', { cause }, ErrorCode.SETTINGS_IMPORT_FAILURE),
        loadDomainSettings,
        loadPrivacySettings,
    };

    exportSettingsBtn?.addEventListener('click', async () => {
        settingsMenu?.classList.add('hidden');
        settingsMenuBtn?.setAttribute('aria-expanded', 'false');
        await handleExport(exportCtx, showPasswordAuthModal);
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

        await handleFileImport(file, importCtx, showPasswordAuthModal, (data, jsonText) => {
            _pendingImportData = data.settings;
            pendingImportJson = jsonText;
            showImportPreview(data);
            getImportConfirmModalEl()?.showModal();
        });

        if (importFileInput) {
            importFileInput.value = '';
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
            await applyImportedSettings(importCtx, imported);
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
    _pendingImportData = null;
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
