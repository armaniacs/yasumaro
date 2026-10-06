/**
 * exportImport.ts
 * Settings export/import and log import functionality for the dashboard
 */

import type { Settings } from '../utils/storage/types.js';
import { errorMessage } from '../utils/errorUtils.js';
import { getMessage, getMessageOr } from '../utils/i18n.js';
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
import { importFromJson, isImportError } from './importLogsService.js';

interface ExportImportDom {
  exportSettingsBtn: HTMLButtonElement | null;
  importSettingsBtn: HTMLButtonElement | null;
  importFileInput: HTMLInputElement | null;
  importLogsBtn: HTMLButtonElement | null;
  importLogsFileInput: HTMLInputElement | null;
  importLogsProgress: HTMLElement | null;
  importConfirmModal: HTMLElement | null;
  closeImportModalBtn: HTMLButtonElement | null;
  cancelImportBtn: HTMLButtonElement | null;
  confirmImportBtn: HTMLButtonElement | null;
  importPreview: HTMLElement | null;
}

export interface ExportImportController {
  /** Wire every export/import button. Re-resolves the DOM first. */
  initExportImport(): void;
  /** Hide the import-confirm modal and clear its pending state. */
  closeImportModal(): void;
  /**
   * Detach every listener this instance attached and drop every element
   * reference. A later initExportImport() re-resolves from the document.
   */
  destroy(): void;
}

export function createExportImport(): ExportImportController {
  let dom: ExportImportDom | null = null;
  /** Removers for every listener initExportImport() attached, in attach order. */
  const teardown: Array<() => void> = [];

  // State
  let importTrapId: string | null = null;
  let _pendingImportData: Settings | null = null;
  let pendingImportJson: string | null = null;

  /**
   * Resolve all DOM references. Called at the top of initExportImport() and
   * lazily by closeImportModal() so importing this module never touches
   * `document`.
   */
  function resolveDom(): void {
    dom = {
      exportSettingsBtn: document.getElementById('exportSettingsBtn') as HTMLButtonElement | null,
      importSettingsBtn: document.getElementById('importSettingsBtn') as HTMLButtonElement | null,
      importFileInput: document.getElementById('importFileInput') as HTMLInputElement | null,
      importLogsBtn: document.getElementById('importLogsBtn') as HTMLButtonElement | null,
      importLogsFileInput: document.getElementById('importLogsFileInput') as HTMLInputElement | null,
      importLogsProgress: document.getElementById('importLogsProgress') as HTMLElement | null,
      importConfirmModal: document.getElementById('importConfirmModal') as HTMLElement | null,
      closeImportModalBtn: document.getElementById('closeImportModalBtn') as HTMLButtonElement | null,
      cancelImportBtn: document.getElementById('cancelImportBtn') as HTMLButtonElement | null,
      confirmImportBtn: document.getElementById('confirmImportBtn') as HTMLButtonElement | null,
      importPreview: document.getElementById('importPreview') as HTMLElement | null,
    };
  }

  /** Resolve on first use so direct calls work without initExportImport(). */
  function ensureDom(): void {
    if (!dom) resolveDom();
  }

  /** Attach a listener and record how to undo it, so destroy() is complete. */
  function listen(target: EventTarget | null | undefined, type: string, handler: EventListenerOrEventListenerObject): void {
    if (!target) return;
    target.addEventListener(type, handler);
    teardown.push(() => target.removeEventListener(type, handler));
  }

  function closeImportModal(): void {
    ensureDom();
    if (dom?.importConfirmModal) {
      dom.importConfirmModal.setAttribute('aria-hidden', 'true');
      if (importTrapId) {
        focusTrapManager.release(importTrapId);
        importTrapId = null;
      }
      dom.importConfirmModal.classList.remove('show');
      dom.importConfirmModal.style.display = 'none';
      dom.importConfirmModal.classList.add('hidden');
    }
    _pendingImportData = null;
    pendingImportJson = null;
    if (dom?.importPreview) dom.importPreview.textContent = '';
  }

  function showImportPreview(data: SettingsExportData): void {
    ensureDom();
    if (!dom?.importPreview) return;
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
    const summaryMsg = getMessageOr('importPreviewSummary', 'Summary:');
    const noteMsg = getMessageOr('importPreviewNote', 'API keys and lists are included.');
    dom.importPreview.textContent = `${summaryMsg}\n${JSON.stringify(summary, null, 2)}\n\n${noteMsg}`;
  }

  function initExportImport(): void {
    destroy();
    resolveDom();
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

    listen(dom?.exportSettingsBtn, 'click', (() => {
      void handleExport(exportCtx, showPasswordAuthModal);
    }) as EventListener);

    listen(dom?.importSettingsBtn, 'click', (() => {
      ensureDom();
      dom?.importFileInput?.click();
    }) as EventListener);

    listen(dom?.importFileInput, 'change', (async (e: Event) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;

      await handleFileImport(file, importCtx, showPasswordAuthModal, (data, jsonText) => {
        ensureDom();
        _pendingImportData = data.settings;
        pendingImportJson = jsonText;
        showImportPreview(data);

        if (dom?.importConfirmModal) {
          dom.importConfirmModal.classList.remove('hidden');
          dom.importConfirmModal.style.display = 'flex';
          void dom.importConfirmModal.offsetHeight;
          dom.importConfirmModal.classList.add('show');
          dom.importConfirmModal.setAttribute('aria-hidden', 'false');
          importTrapId = focusTrapManager.trap(dom.importConfirmModal, closeImportModal);
        }
      });

      ensureDom();
      if (dom?.importFileInput) dom.importFileInput.value = '';
    }) as EventListener);

    listen(dom?.closeImportModalBtn, 'click', (() => closeImportModal()) as EventListener);
    listen(dom?.cancelImportBtn, 'click', (() => closeImportModal()) as EventListener);

    listen(dom?.confirmImportBtn, 'click', (async () => {
      if (!pendingImportJson) { closeImportModal(); return; }
      try {
        const imported = await importSettings(pendingImportJson);
        await applyImportedSettings(importCtx, imported);
      } catch (error: unknown) {
        showStatus('exportImportStatus', `${getMessage('importError')}: ${errorMessage(error)}`, 'error');
      }
      closeImportModal();
    }) as EventListener);

    listen(dom?.importConfirmModal, 'click', ((e: MouseEvent) => {
      if (e.target === dom?.importConfirmModal) closeImportModal();
    }) as EventListener);

    // --- Log Import ---
    listen(dom?.importLogsBtn, 'click', (() => {
      ensureDom();
      dom?.importLogsFileInput?.click();
    }) as EventListener);

    listen(dom?.importLogsFileInput, 'change', (async (e: Event) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;

      ensureDom();
      if (dom?.importLogsProgress) {
        dom.importLogsProgress.classList.remove('hidden');
        dom.importLogsProgress.textContent = getMessageOr('importLogsProcessing', 'Importing...');
        dom.importLogsProgress.className = 'diag-result';
      }

      try {
        const text = await file.text();
        const result = await importFromJson(text, (current, total) => {
          if (dom?.importLogsProgress) {
            dom.importLogsProgress.textContent = `${getMessageOr('importLogsProcessing', 'Importing...')} ${current}/${total}`;
          }
        });

        if (isImportError(result)) {
          if (dom?.importLogsProgress) {
            dom.importLogsProgress.textContent = `${getMessageOr('importLogsError', 'Import error')}: ${result.error}`;
            dom.importLogsProgress.className = 'diag-result error';
          }
        } else {
          const msg = (getMessageOr('importLogsComplete', 'Import complete: %{inserted} inserted, %{skipped} skipped (of %{total} total)'))
            .replace('%{inserted}', String(result.inserted))
            .replace('%{skipped}', String(result.skipped))
            .replace('%{total}', String(result.total));
          if (dom?.importLogsProgress) {
            dom.importLogsProgress.textContent = `✓ ${msg}`;
            dom.importLogsProgress.className = 'diag-result success';
          }
        }
      } catch (error: unknown) {
        if (dom?.importLogsProgress) {
          dom.importLogsProgress.textContent = `${getMessageOr('importLogsError', 'Import error')}: ${errorMessage(error)}`;
          dom.importLogsProgress.className = 'diag-result error';
        }
      }

      ensureDom();
      if (dom?.importLogsFileInput) dom.importLogsFileInput.value = '';
    }) as EventListener);
  }

  function destroy(): void {
    for (const off of teardown.splice(0)) off();
    dom = null;
  }

  return {
    initExportImport,
    closeImportModal,
    destroy,
  };
}

/**
 * The instance the module-level functions below delegate to. One per page is
 * the whole reason this module is a singleton today; `createExportImport`
 * exists so a test (or a second mount) can hold an isolated one instead.
 */
const sharedExportImport = createExportImport();

export function closeImportModal(): void {
  sharedExportImport.closeImportModal();
}

export function initExportImport(): void {
  sharedExportImport.initExportImport();
}

export function destroyExportImport(): void {
  sharedExportImport.destroy();
}
