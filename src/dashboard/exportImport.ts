/**
 * exportImport.ts
 * Settings export/import and log import functionality for the dashboard
 */

import type { Settings } from '../utils/storage.js';
import { errorMessage } from '../utils/errorUtils.js';
import { getMessage } from '../utils/i18n.js';
import { showStatus } from '../utils/ui/settingsUiHelper.js';
import { focusTrapManager } from '../utils/ui/focusTrap.js';
import { showPasswordAuthModal } from './masterPassword.js';
import { importSettings } from '../utils/settingsExportImport.js';
import type { SettingsExportData } from '../utils/settingsExportImport.js';
import {
  handleExport,
  handleFileImport,
  applyImportedSettings,
} from '../utils/settingsExportImportUiCore.js';
import type { ExportContext, ImportContext } from '../utils/settingsExportImportUiCore.js';
import { loadDomainSettings } from './settings/domainFilter.js';
import { loadPrivacySettings } from './settings/privacySettings.js';
import { loadContentSettings } from './settings/contentSettings.js';
import { loadTrustSettings } from './settings/trustSettings.js';
import { importFromJson } from './importLogsService.js';

// DOM Elements
const exportSettingsBtn = document.getElementById('exportSettingsBtn') as HTMLButtonElement | null;
const importSettingsBtn = document.getElementById('importSettingsBtn') as HTMLButtonElement | null;
const importFileInput = document.getElementById('importFileInput') as HTMLInputElement | null;
const importLogsBtn = document.getElementById('importLogsBtn') as HTMLButtonElement | null;
const importLogsFileInput = document.getElementById('importLogsFileInput') as HTMLInputElement | null;
const importLogsProgress = document.getElementById('importLogsProgress') as HTMLElement | null;

const importConfirmModal = document.getElementById('importConfirmModal') as HTMLElement | null;
const closeImportModalBtn = document.getElementById('closeImportModalBtn') as HTMLButtonElement | null;
const cancelImportBtn = document.getElementById('cancelImportBtn') as HTMLButtonElement | null;
const confirmImportBtn = document.getElementById('confirmImportBtn') as HTMLButtonElement | null;
const importPreview = document.getElementById('importPreview') as HTMLElement | null;

// State
let importTrapId: string | null = null;
let _pendingImportData: Settings | null = null;
let pendingImportJson: string | null = null;

export function closeImportModal(): void {
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
  _pendingImportData = null;
  pendingImportJson = null;
  if (importPreview) importPreview.textContent = '';
}

function showImportPreview(data: SettingsExportData): void {
  if (!importPreview) return;
  interface ImportPreviewSummary {
    version: string;
    exportedAt: string;
    obsidian_protocol?: string;
    obsidian_port?: string;
    ai_provider?: string;
    domain_filter_mode?: string;
    privacy_mode?: string;
    domain_count?: string;
  }
  const summary: ImportPreviewSummary = {
    version: data.version,
    exportedAt: new Date(data.exportedAt).toLocaleString(),
  };
  const s = data.settings;
  summary.obsidian_protocol = s.obsidian_protocol as string;
  summary.obsidian_port = s.obsidian_port as string;
  summary.ai_provider = s.ai_provider as string;
  summary.domain_filter_mode = s.domain_filter_mode as string;
  summary.privacy_mode = s.privacy_mode as string;
  summary.domain_count = String((s.domain_whitelist?.length || 0) + (s.domain_blacklist?.length || 0));
  const summaryMsg = chrome.i18n.getMessage('importPreviewSummary') || 'Summary:';
  const noteMsg = chrome.i18n.getMessage('importPreviewNote') || 'API keys and lists are included.';
  importPreview.textContent = `${summaryMsg}\n${JSON.stringify(summary, null, 2)}\n\n${noteMsg}`;
}

export function initExportImport(): void {
  const exportCtx: ExportContext = {
    showStatus: (message, type) => showStatus('exportImportStatus', message, type),
  };

  const importCtx: ImportContext = {
    reloadFn: async () => {},
    showStatus: (message, type) => showStatus('exportImportStatus', message, type),
    loadDomainSettings,
    loadPrivacySettings,
    loadContentSettings,
    loadTrustSettings,
    loadGeneralSettings: async () => {
      document.dispatchEvent(new CustomEvent('reload-general-settings'));
    },
  };

  exportSettingsBtn?.addEventListener('click', async () => {
    await handleExport(exportCtx, showPasswordAuthModal);
  });

  importSettingsBtn?.addEventListener('click', () => {
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

      if (importConfirmModal) {
        importConfirmModal.classList.remove('hidden');
        importConfirmModal.style.display = 'flex';
        void importConfirmModal.offsetHeight;
        importConfirmModal.classList.add('show');
        importConfirmModal.setAttribute('aria-hidden', 'false');
        importTrapId = focusTrapManager.trap(importConfirmModal, closeImportModal);
      }
    });

    if (importFileInput) importFileInput.value = '';
  });

  closeImportModalBtn?.addEventListener('click', closeImportModal);
  cancelImportBtn?.addEventListener('click', closeImportModal);

  confirmImportBtn?.addEventListener('click', async () => {
    if (!pendingImportJson) { closeImportModal(); return; }
    try {
      const imported = await importSettings(pendingImportJson);
      await applyImportedSettings(importCtx, imported);
    } catch (error: unknown) {
      showStatus('exportImportStatus', `${getMessage('importError')}: ${errorMessage(error)}`, 'error');
    }
    closeImportModal();
  });

  importConfirmModal?.addEventListener('click', (e: MouseEvent) => {
    if (e.target === importConfirmModal) closeImportModal();
  });

  // --- Log Import ---
  importLogsBtn?.addEventListener('click', () => {
    importLogsFileInput?.click();
  });

  importLogsFileInput?.addEventListener('change', async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (importLogsProgress) {
      importLogsProgress.classList.remove('hidden');
      importLogsProgress.textContent = getMessage('importLogsProcessing') || 'Importing...';
      importLogsProgress.className = 'diag-result';
    }

    try {
      const text = await file.text();
      const result = await importFromJson(text, (current, total) => {
        if (importLogsProgress) {
          importLogsProgress.textContent = `${getMessage('importLogsProcessing') || 'Importing...'} ${current}/${total}`;
        }
      });

      if ('error' in result) {
        if (importLogsProgress) {
          importLogsProgress.textContent = `${getMessage('importLogsError') || 'Import error'}: ${result.error}`;
          importLogsProgress.className = 'diag-result error';
        }
      } else {
        const msg = (getMessage('importLogsComplete') || 'Import complete: %{inserted} inserted, %{skipped} skipped (of %{total} total)')
          .replace('%{inserted}', String(result.inserted))
          .replace('%{skipped}', String(result.skipped))
          .replace('%{total}', String(result.total));
        if (importLogsProgress) {
          importLogsProgress.textContent = `✓ ${msg}`;
          importLogsProgress.className = 'diag-result success';
        }
      }
    } catch (error: unknown) {
      if (importLogsProgress) {
        importLogsProgress.textContent = `${getMessage('importLogsError') || 'Import error'}: ${errorMessage(error)}`;
        importLogsProgress.className = 'diag-result error';
      }
    }

    if (importLogsFileInput) importLogsFileInput.value = '';
  });
}
