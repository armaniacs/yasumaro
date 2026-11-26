/**
 * exportImport.ts
 * Settings export/import and log import functionality for the dashboard
 */

import type { Settings } from '../utils/storage/types.js';
import { errorMessage } from '../utils/errorUtils.js';
import { getMessage, getMessageOr, getMessageWithSubstitutions } from '../utils/i18n.js';
import { formatLocaleDateTime } from '../utils/localeUtils.js';
import { showStatus } from '../utils/ui/settingsUiHelper.js';
import { createListen } from '../utils/domListen.js';
import { focusTrapManager } from '../utils/ui/focusTrap.js';
import { showPasswordAuthModal } from './masterPassword.js';
import { importSettings } from '../utils/settingsExportImport.js';
import type { SettingsExportData } from '../utils/settingsExportImport.js';
import {
  handleExport,
  handleFileImport,
  applyImportedSettings,
  confirmProfileMigration,
  handleMigrationSettingsImport,
} from '../utils/settingsExportImportUiCore.js';
import type { ExportContext, ImportContext } from '../utils/settingsExportImportUiCore.js';
import { loadDomainSettings } from './settings/domainFilter.js';
import { loadPrivacySettings } from './settings/privacySettings.js';
import { loadContentSettings } from './settings/contentSettings.js';
import { loadTrustSettings } from './settings/trustSettings.js';
import { importFromJson, importFromJsonForMigration, isImportError, IMPORT_SIZE_ERROR } from './importLogsService.js';
import type { ImportLogsResult } from './importLogsService.js';
import { MAX_IMPORT_TEXT_BYTES } from '../utils/limits.js';
import { createAiRepairUi } from './importLogsAiRepairUi.js';

interface ExportImportDom {
  exportSettingsBtn: HTMLButtonElement | null;
  importSettingsBtn: HTMLButtonElement | null;
  importFileInput: HTMLInputElement | null;
  importLogsBtn: HTMLButtonElement | null;
  importLogsFileInput: HTMLInputElement | null;
  importLogsProgress: HTMLElement | null;
  migrateSettingsBtn: HTMLButtonElement | null;
  migrateSettingsFileInput: HTMLInputElement | null;
  migrateLogsBtn: HTMLButtonElement | null;
  migrateLogsFileInput: HTMLInputElement | null;
  importConfirmModal: HTMLElement | null;
  closeImportModalBtn: HTMLButtonElement | null;
  cancelImportBtn: HTMLButtonElement | null;
  confirmImportBtn: HTMLButtonElement | null;
  importPreview: HTMLElement | null;
}

/**
 * Format a log-import failure message. The locale template carries a
 * `%{error}` placeholder (same convention as `importLogsComplete`); when
 * the resolved template lacks it (missing key, test stub), the detail is
 * appended instead of dropping it.
 *
 * The size-cap error is the one case the service returns as a fixed English
 * string (so the wire result stays a plain string): when the exact constant
 * arrives, swap in the localized template instead of leaking the English
 * line into the ja locale. The limit label is re-derived from the constant,
 * not copied, so a future cap change cannot drift the displayed value.
 */
function formatImportLogsError(error: string): string {
  if (error === IMPORT_SIZE_ERROR) {
    return getMessageWithSubstitutions(
      'importLogsFileTooLarge',
      { limit: `${MAX_IMPORT_TEXT_BYTES / (1024 * 1024)} MiB` },
      IMPORT_SIZE_ERROR,
    );
  }
  const template = getMessageOr('importLogsError', 'Import error: %{error}');
  return template.includes('%{error}') ? template.replace('%{error}', error) : `${template}: ${error}`;
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
  /** 取込ファイルの原文。AI修復の収集は入口ボタン押下時にここから解析する。 */
  let lastImportJsonText: string | null = null;
  /** AI修復入口のホスト。取込結果の直後に置き、結果表示と共に更新する。 */
  let aiRepairHost: HTMLElement | null = null;
  const aiRepairUi = createAiRepairUi({
    getParsed: () => {
      if (lastImportJsonText === null) return null;
      try {
        return JSON.parse(lastImportJsonText) as unknown;
      } catch {
        return null;
      }
    },
  });

  /** 修復ホストを進捗表示の直後に用意する (なければ作る)。 */
  function ensureAiRepairHost(): HTMLElement | null {
    ensureDom();
    if (aiRepairHost && aiRepairHost.isConnected) return aiRepairHost;
    if (!dom?.importLogsProgress?.parentElement) return null;
    aiRepairHost = document.createElement('div');
    aiRepairHost.id = 'importLogsAiRepair';
    dom.importLogsProgress.after(aiRepairHost);
    aiRepairUi.mount(aiRepairHost);
    return aiRepairHost;
  }

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
      migrateSettingsBtn: document.getElementById('migrateSettingsBtn') as HTMLButtonElement | null,
      migrateSettingsFileInput: document.getElementById('migrateSettingsFileInput') as HTMLInputElement | null,
      migrateLogsBtn: document.getElementById('migrateLogsBtn') as HTMLButtonElement | null,
      migrateLogsFileInput: document.getElementById('migrateLogsFileInput') as HTMLInputElement | null,
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

  const listen = createListen(teardown);

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
      obsidian_protocol?: string | undefined;
      obsidian_port?: string | undefined;
      ai_provider?: string | undefined;
      domain_filter_mode?: string | undefined;
      privacy_mode?: string | undefined;
      domain_count?: string;
    }
    const summary: ImportPreviewSummary = {
      version: data.version,
      exportedAt: formatLocaleDateTime(data.exportedAt),
    };
    const s = data.settings;
    // Typed Settings access: every field below is already string-typed, so no
    // cast is needed (PBI 20). A missing value stays undefined and JSON.stringify
    // drops it, exactly as before.
    summary.obsidian_protocol = s.obsidian_protocol;
    summary.obsidian_port = s.obsidian_port;
    summary.ai_provider = s.ai_provider;
    summary.domain_filter_mode = s.domain_filter_mode;
    summary.privacy_mode = s.privacy_mode;
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

    function showLogsProgress(current?: number, total?: number): void {
      ensureDom();
      if (!dom?.importLogsProgress) return;
      dom.importLogsProgress.classList.remove('hidden');
      const base = getMessageOr('importLogsProcessing', 'Importing...');
      dom.importLogsProgress.textContent =
        current === undefined || total === undefined ? base : `${base} ${current}/${total}`;
      dom.importLogsProgress.className = 'diag-result';
    }

    function renderLogsImportResult(result: ImportLogsResult): void {
      ensureDom();
      if (!dom?.importLogsProgress) return;
      if (isImportError(result)) {
        dom.importLogsProgress.textContent = formatImportLogsError(result.error);
        dom.importLogsProgress.className = 'diag-result error';
        aiRepairHost?.replaceChildren();
      } else {
        let msg = (getMessageOr('importLogsComplete', 'Import complete: %{inserted} inserted, %{skipped} skipped (of %{total} total)'))
          .replace('%{inserted}', String(result.inserted))
          .replace('%{skipped}', String(result.skipped))
          .replace('%{total}', String(result.total));
        if (result.invalid) {
          const reasons = Object.entries(result.invalidReasons ?? {})
            .map(([reason, count]) => `${reason} x${count}`)
            .join('; ');
          msg += ` (${result.invalid} invalid${reasons ? `: ${reasons}` : ''})`;
          msg += ` ${getMessageOr('aiRepairAvailable', 'AI repair is available (%{invalid} rows)').replace('%{invalid}', String(result.invalid))}`;
        }
        dom.importLogsProgress.textContent = `✓ ${msg}`;
        dom.importLogsProgress.className = 'diag-result success';
        // 取込結果表示の拡張: 却下行がある場合だけ修復入口を出す。
        // 収集・送信・取込はいずれも入口ボタン以降の明示操作で行う。
        const host = ensureAiRepairHost();
        if (host) aiRepairUi.showForResult(result);
      }
    }

    // --- Log Import ---
    listen(dom?.importLogsBtn, 'click', (() => {
      ensureDom();
      dom?.importLogsFileInput?.click();
    }) as EventListener);

    listen(dom?.importLogsFileInput, 'change', (async (e: Event) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;

      showLogsProgress();
      aiRepairHost?.replaceChildren();

      try {
        const text = await file.text();
        lastImportJsonText = text;
        const result = await importFromJson(text, (current, total) => {
          showLogsProgress(current, total);
        });

        renderLogsImportResult(result);
      } catch (error: unknown) {
        renderLogsImportResult({ error: errorMessage(error) });
      }

      ensureDom();
      if (dom?.importLogsFileInput) dom.importLogsFileInput.value = '';
    }) as EventListener);

    // --- Profile Migration (PBI 2026-11-06-03) ---
    // Separate entry points from the normal import above: foreign-signed
    // files keep being rejected there, and only an explicit confirmation
    // (`confirmProfileMigration`) opens the relaxed-verification path.
    listen(dom?.migrateSettingsBtn, 'click', (() => {
      ensureDom();
      dom?.migrateSettingsFileInput?.click();
    }) as EventListener);

    listen(dom?.migrateSettingsFileInput, 'change', (async (e: Event) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;

      await handleMigrationSettingsImport(file, importCtx);

      ensureDom();
      if (dom?.migrateSettingsFileInput) dom.migrateSettingsFileInput.value = '';
    }) as EventListener);

    listen(dom?.migrateLogsBtn, 'click', (() => {
      ensureDom();
      dom?.migrateLogsFileInput?.click();
    }) as EventListener);

    listen(dom?.migrateLogsFileInput, 'change', (async (e: Event) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const confirmed = await confirmProfileMigration();
        if (!confirmed) {
          ensureDom();
          if (dom?.migrateLogsFileInput) dom.migrateLogsFileInput.value = '';
          return;
        }
        showLogsProgress();
        aiRepairHost?.replaceChildren();
        lastImportJsonText = text;
        const result = await importFromJsonForMigration(text, (current, total) => {
          showLogsProgress(current, total);
        });
        renderLogsImportResult(result);
      } catch (error: unknown) {
        renderLogsImportResult({ error: errorMessage(error) });
      }

      ensureDom();
      if (dom?.migrateLogsFileInput) dom.migrateLogsFileInput.value = '';
    }) as EventListener);
  }

  function destroy(): void {
    for (const off of teardown.splice(0)) off();
    aiRepairUi.destroy();
    aiRepairHost = null;
    lastImportJsonText = null;
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
