/**
 * archivePanel.ts
 * Dashboard panel for the date-based archive (PBI 2026-09-06-02, phase A).
 *
 * Flow: pick a boundary date → preview counts → create the staging file
 * (main DB untouched) → chunked download of the staging .db → optional
 * cleanup of the staging copy. Deletion of records from the main DB is
 * phase B (pbi/2026-09-06-04), intentionally not wired here.
 */

import { archivePreview, archiveCreate, archiveCleanup, archiveExportChunk, archivePrepareIncoming, archiveRestorePreview, archiveRestore, archiveDeleteByStaging } from '../../dashboardSqliteService.js';
import { showConfirmDialog } from '../../utils/confirmDialog.js';
import { downloadBlob } from '../../exportLogsService.js';
import { type PanelLifecycle } from '../types.js';
import { showStatus } from '../../../utils/ui/settingsUiHelper.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { cutoffMsFromLocalDate, MAX_ARCHIVE_FILE_BYTES } from '../../../utils/archiveGuards.js';
import { getMessage } from '../../../utils/i18n.js';

/** Per-message binary payload — keeps base64 hops under the 10MB cap. */
const EXPORT_CHUNK_BYTES = 8 * 1024 * 1024;

function localized(key: string, args?: Record<string, string | number>): string {
  return getMessage(key, args ?? null) || key;
}

export function createArchivePanel(): PanelLifecycle {
  return {
    id: 'panel-archive',
    category: 'diagnostic',
    async mount(container) {
      const dateInput = container.querySelector('#archive-date') as HTMLInputElement | null;
      const includeDeletedInput = container.querySelector('#archive-include-deleted') as HTMLInputElement | null;
      const previewBtn = container.querySelector('#archive-preview-btn') as HTMLButtonElement | null;
      const createBtn = container.querySelector('#archive-create-btn') as HTMLButtonElement | null;
      const downloadBtn = container.querySelector('#archive-download-btn') as HTMLButtonElement | null;
      const cleanupBtn = container.querySelector('#archive-cleanup-btn') as HTMLButtonElement | null;
      const summaryEl = container.querySelector('#archive-preview-summary') as HTMLElement | null;
      const statusEl = container.querySelector('#archive-status') as HTMLElement | null;
      const purgeBtn = container.querySelector('#archive-purge-btn') as HTMLButtonElement | null;
      const restoreFileInput = container.querySelector('#archive-restore-file') as HTMLInputElement | null;
      const restorePreviewEl = container.querySelector('#archive-restore-preview-summary') as HTMLElement | null;
      const restoreBtn = container.querySelector('#archive-restore-btn') as HTMLButtonElement | null;

      let lastStagingName: string | null = null;
      let lastFileName = '';

      const controls = [previewBtn, createBtn, cleanupBtn, downloadBtn, restoreBtn, purgeBtn];
      const setBusy = (busy: boolean): void => {
        for (const el of controls) if (el) el.disabled = busy;
        if (statusEl) statusEl.setAttribute('aria-busy', String(busy));
      };

      const isoToday = (): string => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      };
      if (dateInput && !dateInput.value) dateInput.value = isoToday();
      if (dateInput) dateInput.max = isoToday();

      const cutoffMsFromInput = (): number => {
        if (!dateInput?.value) {
          throw new Error(localized('archiveDateRequired'));
        }
        return cutoffMsFromLocalDate(dateInput.value);
      };

      const downloadStaging = async (): Promise<void> => {
        if (!lastStagingName) throw new Error(localized('archiveDateRequired'));
        const parts: BlobPart[] = [];
        let offset = 0;
        for (;;) {
          const result = await archiveExportChunk(lastStagingName, offset, EXPORT_CHUNK_BYTES);
          if ('error' in result) throw new Error(result.error);
          // Uint8Array.from avoids the spread-operator stack overflow on 7MB chunks
          const bytes = Uint8Array.from(result.data.chunk);
          parts.push(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
          offset = result.data.nextOffset;
          if (result.data.done) break;
        }
        downloadBlob(new Blob(parts, { type: 'application/x-sqlite3' }), lastFileName);
      };

      previewBtn?.addEventListener('click', async () => {
        if (!previewBtn) return;
        try {
          setBusy(true);
          showStatus(statusTarget(statusEl), localized('archiveStatusWorking'), 'success');
          const cutoffMs = cutoffMsFromInput();
          const result = await archivePreview(cutoffMs, includeDeletedInput?.checked === true);
          if ('error' in result) throw new Error(result.error);
          const p = result.data;
          if (summaryEl) {
            summaryEl.hidden = false;
            summaryEl.textContent = localized('archivePreviewSummary', {
              total: p.total, starred: p.starred, deleted: p.deleted,
            });
          }
        } catch (err) {
          showStatus(statusTarget(statusEl), `${localized('archivePreviewFailed')}: ${errorMessage(err)}`, 'error');
        } finally {
          setBusy(false);
        }
      });

      createBtn?.addEventListener('click', async () => {
        if (!createBtn) return;
        try {
          setBusy(true);
          showStatus(statusTarget(statusEl), localized('archiveStatusWorking'), 'success');
          const cutoffDate = dateInput?.value ?? '';
          const cutoffMs = cutoffMsFromInput();
          const result = await archiveCreate({
            cutoffDate,
            cutoffMs,
            includeDeleted: includeDeletedInput?.checked === true,
            yasumaroVersion: chrome.runtime.getManifest().version,
          });
          if ('error' in result) throw new Error(result.error);
          lastStagingName = result.data.stagingName;
          lastFileName = `yasumaro_archive_${cutoffDate}.db`;
          if (downloadBtn) downloadBtn.hidden = false;
          if (cleanupBtn) cleanupBtn.hidden = false;
          if (purgeBtn) purgeBtn.hidden = false;
          if (summaryEl) {
            summaryEl.hidden = false;
            summaryEl.textContent = localized('archiveCreatedSummary', { count: result.data.recordCount });
          }
          showStatus(statusTarget(statusEl), localized('archiveCreatedDownloadHint'), 'success');
        } catch (err) {
          showStatus(statusTarget(statusEl), `${localized('archiveCreateFailed')}: ${errorMessage(err)}`, 'error');
        } finally {
          setBusy(false);
        }
      });

      downloadBtn?.addEventListener('click', async () => {
        if (!downloadBtn) return;
        try {
          setBusy(true);
          await downloadStaging();
          showStatus(statusTarget(statusEl), localized('archiveDownloadDone'), 'success');
        } catch (err) {
          showStatus(statusTarget(statusEl), `${localized('archiveDownloadFailed')}: ${errorMessage(err)}`, 'error');
        } finally {
          setBusy(false);
        }
      });

      purgeBtn?.addEventListener('click', async () => {
        if (!purgeBtn) return;
        try {
          setBusy(true);
          if (!lastStagingName) throw new Error(localized('archiveDateRequired'));
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
          if (!confirmed) return;
          const result = await archiveDeleteByStaging(lastStagingName);
          if ('error' in result) throw new Error(result.error);
          lastStagingName = null;
          if (downloadBtn) downloadBtn.hidden = true;
          if (cleanupBtn) cleanupBtn.hidden = true;
          if (purgeBtn) purgeBtn.hidden = true;
          const done = localized('archivePurgeDone', {
            deleted: result.data.deleted,
            remaining: result.data.remaining,
          });
          showStatus(statusTarget(statusEl), result.data.vacuumOk ? done : `${done} ${localized('archiveVacuumNote')}`, result.data.vacuumOk ? 'success' : 'error');
        } catch (err) {
          showStatus(statusTarget(statusEl), `${localized('archivePurgeFailed')}: ${errorMessage(err)}`, 'error');
        } finally {
          setBusy(false);
        }
      });

      cleanupBtn?.addEventListener('click', async () => {
        if (!cleanupBtn) return;
        try {
          setBusy(true);
          const result = await archiveCleanup();
          if ('error' in result) throw new Error(result.error);
          lastStagingName = null;
          if (downloadBtn) downloadBtn.hidden = true;
          if (cleanupBtn) cleanupBtn.hidden = true;
          showStatus(statusTarget(statusEl), localized('archiveCleanupDone', { count: result.data.removed.length }), 'success');
        } catch (err) {
          showStatus(statusTarget(statusEl), `${localized('archiveCleanupFailed')}: ${errorMessage(err)}`, 'error');
        } finally {
          setBusy(false);
        }
      });

      let restoreStagingName: string | null = null;

      restoreFileInput?.addEventListener('change', async () => {
        const file = restoreFileInput?.files?.[0];
        if (!restoreFileInput || !file) return;
        try {
          setBusy(true);
          if (file.size > MAX_ARCHIVE_FILE_BYTES) {
            throw new Error(localized('archiveFileTooLarge', {
              max: Math.floor(MAX_ARCHIVE_FILE_BYTES / (1024 * 1024)),
            }));
          }
          // Staging name must be issued by the offscreen registry (fail-closed).
          const prepared = await archivePrepareIncoming();
          if ('error' in prepared) throw new Error(prepared.error);
          lastStagingName = prepared.data;
          restoreStagingName = prepared.data;

          // Dashboard writes the picked file into the OPFS staging file
          // (same origin); the worker never trusts client paths.
          const root = await navigator.storage.getDirectory();
          const handle = await root.getFileHandle(restoreStagingName, { create: true });
          const writable = await handle.createWritable();
          try {
            let offset = 0;
            while (offset < file.size) {
              const end = Math.min(offset + EXPORT_CHUNK_BYTES, file.size);
              const buf = await file.slice(offset, end).arrayBuffer();
              await writable.write(buf);
              offset = end;
            }
            await writable.close();
          } catch (err) {
            try { await writable.abort?.(); } catch { /* ignore */ }
            throw err;
          }

          const previewResult = await archiveRestorePreview(restoreStagingName);
          if ('error' in previewResult) throw new Error(previewResult.error);
          const meta = previewResult.data;
          if (restorePreviewEl) {
            restorePreviewEl.hidden = false;
            restorePreviewEl.textContent = localized('archiveRestorePreviewSummary', {
              count: meta.recordCount,
              date: meta.cutoffDate,
            });
          }
          if (restoreBtn) restoreBtn.hidden = false;
          showStatus(statusTarget(statusEl), localized('archiveStatusWorking') === 'Working… other archive operations are disabled until this finishes.' ? 'Preview ready.' : 'Preview ready.', 'success');
        } catch (err) {
          showStatus(statusTarget(statusEl), `${localized('archiveRestorePreviewFailed')}: ${errorMessage(err)}`, 'error');
        } finally {
          setBusy(false);
        }
      });

      restoreBtn?.addEventListener('click', async () => {
        if (!restoreBtn) return;
        try {
          setBusy(true);
          if (!restoreStagingName) throw new Error(localized('archiveDateRequired'));
          const result = await archiveRestore(restoreStagingName);
          if ('error' in result) throw new Error(result.error);
          if (restorePreviewEl) {
            restorePreviewEl.textContent = localized('archiveRestoreDone', {
              restored: result.data.restored,
              deleted: result.data.restoredDeleted,
              skipped: result.data.skipped,
              invalid: result.data.skippedInvalid,
            });
          }
          restoreStagingName = null;
          if (restoreBtn) restoreBtn.hidden = true;
          if (restoreFileInput) restoreFileInput.value = '';
          showStatus(statusTarget(statusEl), localized('archiveRestoreDoneStatus'), 'success');
        } catch (err) {
          showStatus(statusTarget(statusEl), `${localized('archiveRestoreFailed')}: ${errorMessage(err)}`, 'error');
        } finally {
          setBusy(false);
        }
      });

      // Local helper keeping showStatus target id logic in one place.
      function statusTarget(el: HTMLElement | null): HTMLElement | string {
        return el ?? 'archive-status';
      }
    },
  };
}
