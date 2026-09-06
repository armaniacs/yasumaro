/**
 * archivePanel.ts
 * Dashboard panel for the date-based archive (PBI 2026-09-06-02, phase A).
 *
 * Flow: pick a boundary date → preview counts → create the staging file
 * (main DB untouched) → chunked download of the staging .db → optional
 * cleanup of the staging copy. Deletion of records from the main DB is
 * phase B (pbi/2026-09-06-04), intentionally not wired here.
 */

import { archivePreview, archiveCreate, archiveCleanup, archiveExportChunk } from '../../dashboardSqliteService.js';
import { downloadBlob } from '../../exportLogsService.js';
import { type PanelLifecycle } from '../types.js';
import { showStatus } from '../../../utils/ui/settingsUiHelper.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { cutoffMsFromLocalDate } from '../../../utils/archiveGuards.js';
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

      let lastStagingName: string | null = null;
      let lastFileName = '';

      const controls = [previewBtn, createBtn, cleanupBtn, downloadBtn];
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

      // Local helper keeping showStatus target id logic in one place.
      function statusTarget(el: HTMLElement | null): HTMLElement | string {
        return el ?? 'archive-status';
      }
    },
  };
}
