/**
 * archiveLifecyclePanel.ts
 * Archive lifecycle area of the archive panel: boundary-date preview,
 * staging create, chunked download, purge confirm, and staging cleanup.
 * Owns the date input defaults and the outgoing staging state via the
 * shared ArchiveStagingState holder.
 */

import { archivePreview, archiveCreate, archiveCleanup, archiveExportChunk, archiveDeleteByStaging } from '../../dashboardSqliteService.js';
import { showConfirmDialog } from '../../utils/confirmDialog.js';
import { downloadBlob } from '../../exportLogsService.js';
import { abortPanelAction, runPanelAction, unwrapServiceResult } from '../panelAction.js';
import { showStatus } from '../../../utils/ui/settingsUiHelper.js';
import { cutoffMsFromLocalDate, assertCutoffPair } from '../../../utils/archiveGuards.js';
import { tOrKey as localized } from '../../../utils/i18n.js';
import { formatLocalDateString } from '../../../utils/localDate.js';
import { EXPORT_CHUNK_BYTES, statusTarget, type ArchiveBusyScope, type ArchiveStagingState } from './archivePanelShared.js';

export interface ArchiveLifecycleDeps {
  dateInput: HTMLInputElement | null;
  includeDeletedInput: HTMLInputElement | null;
  previewBtn: HTMLButtonElement | null;
  createBtn: HTMLButtonElement | null;
  downloadBtn: HTMLButtonElement | null;
  cleanupBtn: HTMLButtonElement | null;
  purgeBtn: HTMLButtonElement | null;
  summaryEl: HTMLElement | null;
  busy: ArchiveBusyScope;
  staging: ArchiveStagingState;
}

export function mountArchiveLifecycle(deps: ArchiveLifecycleDeps): void {
  const { dateInput, includeDeletedInput, previewBtn, createBtn, downloadBtn, cleanupBtn, purgeBtn, summaryEl, busy, staging } = deps;
  const { controls, setAriaBusy, statusEl } = busy;

  const isoToday = (): string => formatLocalDateString(Date.now());
  if (dateInput && !dateInput.value) dateInput.value = isoToday();
  if (dateInput) dateInput.max = isoToday();

  const cutoffMsFromInput = (): number => {
    if (!dateInput?.value) {
      throw new Error(localized('archiveDateRequired'));
    }
    // Input derivation goes through the `assertCutoffPair` seam: the
    // derived ms trivially matches itself, but range/format enforcement
    // stays in one place (PBI 2026-09-07-21).
    const derived = cutoffMsFromLocalDate(dateInput.value);
    return assertCutoffPair(dateInput.value, derived);
  };

  const downloadStaging = async (): Promise<void> => {
    if (!staging.lastStagingName) throw new Error(localized('archiveDateRequired'));
    const parts: BlobPart[] = [];
    let offset = 0;
    for (;;) {
      const chunk = unwrapServiceResult(await archiveExportChunk(staging.lastStagingName, offset, EXPORT_CHUNK_BYTES));
      // Uint8Array.from avoids the spread-operator stack overflow on 7MB chunks
      const bytes = Uint8Array.from(chunk.chunk);
      parts.push(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      offset = chunk.nextOffset;
      if (chunk.done) break;
    }
    downloadBlob(new Blob(parts, { type: 'application/x-sqlite3' }), staging.lastFileName);
  };

  previewBtn?.addEventListener('click', () => {
    void runPanelAction({
      buttons: controls,
      onBusy: setAriaBusy,
      onStart: () => showStatus(statusTarget(statusEl), localized('archiveStatusWorking'), 'success'),
      run: async () => {
        const cutoffDate = dateInput?.value ?? '';
        const cutoffMs = cutoffMsFromInput();
        return unwrapServiceResult(await archivePreview(cutoffDate, cutoffMs, includeDeletedInput?.checked === true));
      },
      onSuccess: (p) => {
        if (summaryEl) {
          summaryEl.hidden = false;
          summaryEl.textContent = localized('archivePreviewSummary', {
            total: p.total, starred: p.starred, deleted: p.deleted,
          });
        }
      },
      onError: (message) => showStatus(statusTarget(statusEl), `${localized('archivePreviewFailed')}: ${message}`, 'error'),
    });
  });

  createBtn?.addEventListener('click', () => {
    const cutoffDate = dateInput?.value ?? '';
    void runPanelAction({
      buttons: controls,
      onBusy: setAriaBusy,
      onStart: () => showStatus(statusTarget(statusEl), localized('archiveStatusWorking'), 'success'),
      run: async () => {
        const cutoffMs = cutoffMsFromInput();
        return unwrapServiceResult(await archiveCreate({
          cutoffDate,
          cutoffMs,
          includeDeleted: includeDeletedInput?.checked === true,
          yasumaroVersion: chrome.runtime.getManifest().version,
        }));
      },
      onSuccess: (data) => {
        staging.lastStagingName = data.stagingName;
        staging.lastFileName = `yasumaro_archive_${cutoffDate}.db`;
        if (downloadBtn) downloadBtn.hidden = false;
        if (cleanupBtn) cleanupBtn.hidden = false;
        if (purgeBtn) purgeBtn.hidden = false;
        if (summaryEl) {
          summaryEl.hidden = false;
          summaryEl.textContent = localized('archiveCreatedSummary', { count: data.recordCount });
        }
        showStatus(statusTarget(statusEl), localized('archiveCreatedDownloadHint'), 'success');
      },
      onError: (message) => showStatus(statusTarget(statusEl), `${localized('archiveCreateFailed')}: ${message}`, 'error'),
    });
  });

  downloadBtn?.addEventListener('click', () => {
    void runPanelAction({
      buttons: controls,
      onBusy: setAriaBusy,
      run: downloadStaging,
      onSuccess: () => showStatus(statusTarget(statusEl), localized('archiveDownloadDone'), 'success'),
      onError: (message) => showStatus(statusTarget(statusEl), `${localized('archiveDownloadFailed')}: ${message}`, 'error'),
    });
  });

  purgeBtn?.addEventListener('click', () => {
    void runPanelAction({
      buttons: controls,
      onBusy: setAriaBusy,
      run: async () => {
        if (!staging.lastStagingName) throw new Error(localized('archiveDateRequired'));
        const cutoffDate = dateInput?.value ?? '';
        const confirmed = await showConfirmDialog({
          title: localized('archivePurgeConfirmTitle'),
          message: localized('archivePurgeConfirmMessage', {
            date: cutoffDate,
            legacy: localized('archiveLegacyDisclosure'),
          }),
          confirmLabel: localized('archivePurgeConfirmOk'),
          dangerous: true,
        });
        if (!confirmed) return abortPanelAction();
        return unwrapServiceResult(await archiveDeleteByStaging(staging.lastStagingName));
      },
      onSuccess: (data) => {
        staging.lastStagingName = null;
        if (downloadBtn) downloadBtn.hidden = true;
        if (cleanupBtn) cleanupBtn.hidden = true;
        if (purgeBtn) purgeBtn.hidden = true;
        const done = localized('archivePurgeDone', {
          deleted: data.deleted,
          remaining: data.remaining,
        });
        showStatus(statusTarget(statusEl), data.vacuumOk ? done : `${done} ${localized('archiveVacuumNote')}`, data.vacuumOk ? 'success' : 'error');
      },
      onError: (message) => showStatus(statusTarget(statusEl), `${localized('archivePurgeFailed')}: ${message}`, 'error'),
    });
  });

  cleanupBtn?.addEventListener('click', () => {
    void runPanelAction({
      buttons: controls,
      onBusy: setAriaBusy,
      run: async () => unwrapServiceResult(await archiveCleanup()),
      onSuccess: (data) => {
        staging.lastStagingName = null;
        if (downloadBtn) downloadBtn.hidden = true;
        if (cleanupBtn) cleanupBtn.hidden = true;
        showStatus(statusTarget(statusEl), localized('archiveCleanupDone', { count: data.removed.length }), 'success');
      },
      onError: (message) => showStatus(statusTarget(statusEl), `${localized('archiveCleanupFailed')}: ${message}`, 'error'),
    });
  });
}
