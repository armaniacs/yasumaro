/**
 * archivePanel.ts
 * Dashboard panel for the date-based archive (PBI 2026-09-06-02, phase A).
 *
 * Flow: pick a boundary date → preview counts → create the staging file
 * (main DB untouched) → chunked download of the staging .db → optional
 * cleanup of the staging copy. Deletion of records from the main DB is
 * phase B (pbi/2026-09-06-04), intentionally not wired here.
 */

import { MAX_ARCHIVE_EXPORT_CHUNK_BYTES } from '../../../messaging/limits.js';
import { archivePreview, archiveCreate, archiveCleanup, archiveExportChunk, archivePrepareIncoming, archiveRestorePreview, archiveRestore, archiveDeleteByStaging, archiveOpen, archiveQuery, archiveUpdate, archiveSave, archiveClose, archiveStatus } from '../../dashboardSqliteService.js';

import { showConfirmDialog } from '../../utils/confirmDialog.js';
import { downloadBlob } from '../../exportLogsService.js';
import { type PanelLifecycle } from '../types.js';
import { showStatus } from '../../../utils/ui/settingsUiHelper.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { cutoffMsFromLocalDate, assertCutoffPair, MAX_ARCHIVE_FILE_BYTES } from '../../../utils/archiveGuards.js';
import { focusTrapManager } from '../../../utils/ui/focusTrap.js';
import { getMessage } from '../../../utils/i18n.js';

/** Per-message binary payload — keeps base64 hops under the 10MB cap. */
const EXPORT_CHUNK_BYTES = MAX_ARCHIVE_EXPORT_CHUNK_BYTES;

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
      const sessionSection = container.querySelector('#archive-session-section') as HTMLElement | null;
      const sessionQueryInput = container.querySelector('#archive-session-query') as HTMLInputElement | null;
      const sessionQueryBtn = container.querySelector('#archive-session-query-btn') as HTMLButtonElement | null;
      const sessionListEl = container.querySelector('#archive-session-list') as HTMLElement | null;
      const sessionSaveBtn = container.querySelector('#archive-session-save-btn') as HTMLButtonElement | null;
      const sessionCloseBtn = container.querySelector('#archive-session-close-btn') as HTMLButtonElement | null;
      const restoreFileInput = container.querySelector('#archive-restore-file') as HTMLInputElement | null;
      const restorePreviewEl = container.querySelector('#archive-restore-preview-summary') as HTMLElement | null;
      const restoreBtn = container.querySelector('#archive-restore-btn') as HTMLButtonElement | null;

      let lastStagingName: string | null = null;
      let lastFileName = '';

      const controls = [previewBtn, createBtn, cleanupBtn, downloadBtn, restoreBtn, purgeBtn, sessionQueryBtn, sessionSaveBtn, sessionCloseBtn];
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
        // Input derivation goes through the `assertCutoffPair` seam: the
        // derived ms trivially matches itself, but range/format enforcement
        // stays in one place (PBI 2026-09-07-21).
        const derived = cutoffMsFromLocalDate(dateInput.value);
        return assertCutoffPair(dateInput.value, derived);
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
          const cutoffDate = dateInput?.value ?? '';
          const cutoffMs = cutoffMsFromInput();
          const result = await archivePreview(cutoffDate, cutoffMs, includeDeletedInput?.checked === true);
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

      let sessionStaging: string | null = null;

      const renderSessionList = async (): Promise<void> => {
        if (!sessionStaging || !sessionListEl) return;
        const result = await archiveQuery(sessionStaging, sessionQueryInput?.value ?? '', 100, 0);
        if ('error' in result) throw new Error(result.error);
        const rows = result.data.rows;
        if (!rows.length) {
          sessionListEl.textContent = localized('archiveSessionEmpty');
          return;
        }
        sessionListEl.replaceChildren(
          ...rows.map((row) => {
            const item = document.createElement('div');
            item.className = 'archive-session-row';
            item.dataset.rowId = String(row.id);
            const label = document.createElement('span');
            label.textContent = `${new Date(row.created_at).toISOString().slice(0, 16).replace('T', ' ')} ${row.title || row.url}`;
            const editBtn = document.createElement('button');
            editBtn.className = 'btn btn-secondary btn-sm';
            editBtn.textContent = localized('archiveSessionEditBtn');
            editBtn.addEventListener('click', () => {
              openEditModal(row, editBtn, {
                onSave: async (newTitle: string) => {
                  const update = await archiveUpdate(sessionStaging as string, row.id, { title: newTitle });
                  if ('error' in update) throw new Error(update.error);
                  archiveDirtyLocal = true;
                },
                onClosed: async () => {
                  await renderSessionList();
                },
                onError: (message: string) => showStatus(statusTarget(statusEl), message, 'error'),
              });
            });
            item.appendChild(label);
            item.appendChild(editBtn);
            return item;
          }),
        );
      };

      let archiveDirtyLocal = false;

      const openEditModal = (
        row: ArchiveSessionRowLike,
        trigger: HTMLElement,
        hooks: EditModalHooks,
      ): void => {
        const overlay = document.createElement('div');
        overlay.className = 'archive-modal-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'archive-modal';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');

        const titleId = 'archive-edit-modal-title';
        const heading = document.createElement('h3');
        heading.id = titleId;
        heading.setAttribute('data-i18n', 'archiveModalTitle');
        heading.textContent = localized('archiveModalTitle');
        dialog.appendChild(heading);

        const label = document.createElement('label');
        label.setAttribute('for', 'archive-edit-input');
        label.setAttribute('data-i18n', 'archiveModalTitleLabel');
        label.textContent = localized('archiveModalTitleLabel');
        dialog.appendChild(label);

        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'archive-edit-input';
        input.value = row.title ?? '';
        dialog.appendChild(input);

        const errorEl = document.createElement('p');
        errorEl.className = 'archive-modal-error';
        errorEl.setAttribute('role', 'alert');
        errorEl.hidden = true;
        dialog.appendChild(errorEl);

        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn btn-primary archive-modal-save';
        saveBtn.setAttribute('data-i18n', 'archiveModalSave');
        saveBtn.textContent = localized('archiveModalSave');

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-secondary archive-modal-cancel';
        cancelBtn.textContent = localized('archiveModalCancel');

        const buttonRow = document.createElement('div');
        buttonRow.className = 'archive-modal-buttons';
        buttonRow.appendChild(saveBtn);
        buttonRow.appendChild(cancelBtn);
        dialog.appendChild(buttonRow);

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const close = (): void => {
          focusTrapManager.release(trapId);
          overlay.remove();
          trigger.focus();
        };

        const closeModalAndSave = async (): Promise<void> => {
          const next = input.value.trim();
          if (next.length === 0) {
            errorEl.hidden = false;
            errorEl.textContent = localized('archiveModalTitleRequired');
            input.focus();
            return;
          }
          if (next.length > 500) {
            errorEl.hidden = false;
            errorEl.textContent = localized('archiveModalTitleTooLong');
            input.focus();
            return;
          }
          errorEl.hidden = true;
          try {
            await hooks.onSave(next);
            // Restore focus to the originating row BEFORE the list re-renders.
            close();
            await hooks.onClosed?.();
            // The list re-render recreates the row: keep focus on its edit button.
            const rowEl = container.querySelector(`.archive-session-row[data-row-id="${row.id}"]`);
            (rowEl?.querySelector('button') as HTMLElement | null)?.focus();
          } catch (err) {
            errorEl.hidden = false;
            errorEl.textContent = errorMessage(err);
          }
        };

        saveBtn.addEventListener('click', () => {
          void closeModalAndSave();
        });
        cancelBtn.addEventListener('click', close);
        dialog.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && e.target === input) {
            e.preventDefault();
            void closeModalAndSave();
          }
        });

        dialog.setAttribute('aria-labelledby', titleId);
        const trapId = focusTrapManager.trap(dialog, close);
        input.focus();
      };


      // 再接続: mount時にstatusを取得し、open中なら一覧を再表示
      void (async () => {
        const status = await archiveStatus();
        if ('error' in status) return;
        if (status.data.open && status.data.stagingName) {
          sessionStaging = status.data.stagingName;
          archiveDirtyLocal = status.data.dirty;
          if (sessionSection) sessionSection.hidden = false;
          try {
            await renderSessionList();
          } catch (err) {
            showStatus(statusTarget(statusEl), errorMessage(err), 'error');
          }
        }
      })();

      sessionQueryBtn?.addEventListener('click', async () => {
        try {
          setBusy(true);
          await renderSessionList();
        } catch (err) {
          showStatus(statusTarget(statusEl), errorMessage(err), 'error');
        } finally {
          setBusy(false);
        }
      });

      sessionSaveBtn?.addEventListener('click', async () => {
        if (!sessionStaging || !sessionSaveBtn) return;
        try {
          setBusy(true);
          const result = await archiveSave(sessionStaging);
          if ('error' in result) throw new Error(result.error);
          archiveDirtyLocal = false;
          showStatus(statusTarget(statusEl), localized('archiveSessionSaved'), 'success');
        } catch (err) {
          showStatus(statusTarget(statusEl), errorMessage(err), 'error');
        } finally {
          setBusy(false);
        }
      });

      sessionCloseBtn?.addEventListener('click', async () => {
        if (!sessionStaging || !sessionCloseBtn) return;
        try {
          if (archiveDirtyLocal) {
            const confirmed = await showConfirmDialog({
              title: localized('archiveSessionDiscardTitle'),
              message: localized('archiveSessionDiscardMessage'),
              dangerous: true,
            });
            if (!confirmed) return;
          }
          setBusy(true);
          const result = await archiveClose(sessionStaging);
          if ('error' in result) throw new Error(result.error);
          sessionStaging = null;
          archiveDirtyLocal = false;
          if (sessionSection) sessionSection.hidden = true;
        } catch (err) {
          showStatus(statusTarget(statusEl), errorMessage(err), 'error');
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
          void (async () => {
            const openResult = await archiveOpen(restoreStagingName as string);
            if ('error' in openResult) throw new Error(openResult.error);
            if (sessionSection) sessionSection.hidden = false;
            await renderSessionList();
          })().catch((err) => showStatus(statusTarget(statusEl), errorMessage(err), 'error'));
          if (restoreBtn) restoreBtn.hidden = false;
          showStatus(statusTarget(statusEl), localized('archiveRestorePreviewReady'), 'success');
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


// ============================================================================
// Edit modal (PBI 2026-09-06-07) — accessible dialog replacing window.prompt
// ============================================================================

interface ArchiveSessionRowLike {
  id: number;
  title: string | null;
}


interface EditModalHooks {
  onSave: (newTitle: string) => Promise<void>;
  onClosed?: () => Promise<void> | void;
  onError: (message: string) => void;
}

interface ArchiveSessionRowLike {
  id: number;
  title: string | null;
}
