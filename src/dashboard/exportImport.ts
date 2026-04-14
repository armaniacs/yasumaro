/**
 * exportImport.ts
 * Settings export/import functionality for the dashboard
 */

import { getSettings, saveSettingsWithAllowedUrls, Settings } from '../utils/storage.js';
import { getMessage } from '../popup/i18n.js';
import { showStatus } from '../popup/settingsUiHelper.js';
import { focusTrapManager } from '../popup/utils/focusTrap.js';
import { showPasswordAuthModal } from './masterPassword.js';
import {
  exportSettings,
  importSettings,
  validateExportData,
  SettingsExportData,
  exportEncryptedSettings,
  importEncryptedSettings,
  saveEncryptedExportToFile,
  isEncryptedExport,
  EncryptedExportData,
  ExportFileData
} from '../utils/settingsExportImport.js';
import { loadDomainSettings } from '../popup/domainFilter.js';
import { loadPrivacySettings } from '../popup/privacySettings.js';
import { loadContentSettings } from '../popup/contentSettings.js';
import { loadTrustSettings } from '../popup/trustSettings.js';

// DOM Elements
const exportSettingsBtn = document.getElementById('exportSettingsBtn') as HTMLButtonElement | null;
const importSettingsBtn = document.getElementById('importSettingsBtn') as HTMLButtonElement | null;
const importFileInput = document.getElementById('importFileInput') as HTMLInputElement | null;

const importConfirmModal = document.getElementById('importConfirmModal') as HTMLElement | null;
const closeImportModalBtn = document.getElementById('closeImportModalBtn') as HTMLButtonElement | null;
const cancelImportBtn = document.getElementById('cancelImportBtn') as HTMLButtonElement | null;
const confirmImportBtn = document.getElementById('confirmImportBtn') as HTMLButtonElement | null;
const importPreview = document.getElementById('importPreview') as HTMLElement | null;

// State
let importTrapId: string | null = null;
let pendingImportData: Settings | null = null;
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
  pendingImportData = null;
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
  exportSettingsBtn?.addEventListener('click', async () => {
    try {
      const settings = await getSettings();
      const isMpEnabled = settings.mp_protection_enabled === true;
      const isMpEncryptOnExport = settings.mp_encrypt_on_export === true;

      if (isMpEnabled && isMpEncryptOnExport) {
        showPasswordAuthModal('export', async (password) => {
          const result = await exportEncryptedSettings(password);
          if (result.success && result.encryptedData) {
            await saveEncryptedExportToFile(result.encryptedData);
            showStatus('exportImportStatus', getMessage('settingsExported'), 'success');
          } else {
            showStatus('exportImportStatus', `${getMessage('exportError')}: ${result.error || 'Unknown error'}`, 'error');
          }
        });
      } else {
        await exportSettings();
        showStatus('exportImportStatus', getMessage('settingsExported'), 'success');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      showStatus('exportImportStatus', `${getMessage('exportError')}: ${message}`, 'error');
    }
  });

  importSettingsBtn?.addEventListener('click', () => {
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
            showStatus('exportImportStatus', getMessage('settingsImported'), 'success');
            await loadGeneralSettingsForImport();
            await loadDomainSettings();
            await loadPrivacySettings();
            await loadContentSettings();
            await loadTrustSettings();
          } else {
            showStatus('exportImportStatus', `${getMessage('importError')}: Failed to decrypt or apply settings`, 'error');
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

        if (importFileInput) importFileInput.value = '';
        return;
      }

      if (!validateExportData(parsed)) {
        showStatus('exportImportStatus', getMessage('invalidSettingsFile'), 'error');
        if (importFileInput) importFileInput.value = '';
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
      const message = error instanceof Error ? error.message : String(error);
      showStatus('exportImportStatus', `${getMessage('importError')}: ${message}`, 'error');
    }
  });

  closeImportModalBtn?.addEventListener('click', closeImportModal);
  cancelImportBtn?.addEventListener('click', closeImportModal);

  confirmImportBtn?.addEventListener('click', async () => {
    if (!pendingImportJson) { closeImportModal(); return; }
    try {
      const imported = await importSettings(pendingImportJson);
      if (imported) {
        showStatus('exportImportStatus', getMessage('settingsImported'), 'success');
        await loadGeneralSettingsForImport();
        await loadDomainSettings();
        await loadPrivacySettings();
        await loadContentSettings();
        await loadTrustSettings();
      } else {
        showStatus('exportImportStatus', `${getMessage('importError')}: Failed to apply settings`, 'error');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      showStatus('exportImportStatus', `${getMessage('importError')}: ${message}`, 'error');
    }
    closeImportModal();
  });

  importConfirmModal?.addEventListener('click', (e: MouseEvent) => {
    if (e.target === importConfirmModal) closeImportModal();
  });
}

// Helper function to reload general settings after import
async function loadGeneralSettingsForImport(): Promise<void> {
  // This is a placeholder that will be replaced with the actual implementation
  // The actual implementation is in dashboard.ts and will be called via event or callback
  // For now, we dispatch a custom event that dashboard.ts can listen to
  document.dispatchEvent(new CustomEvent('reload-general-settings'));
}
