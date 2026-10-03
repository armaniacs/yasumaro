/**
 * archivePanel.ts
 * Dashboard panel for the date-based archive (PBI 2026-09-06-02, phase A).
 *
 * Flow: pick a boundary date → preview counts → create the staging file
 * (main DB untouched) → chunked download of the staging .db → optional
 * cleanup of the staging copy. Deletion of records from the main DB is
 * phase B (pbi/2026-09-06-04), intentionally not wired here.
 */

import { MAX_ARCHIVE_EXPORT_CHUNK_BYTES } from '../../../utils/limits.js';
import { archivePreview, archiveCreate, archiveCleanup, archiveExportChunk, archivePrepareIncoming, archiveRestorePreview, archiveRestore, archiveDeleteByStaging, archiveOpen, archiveQuery, archiveUpdate, archiveSave, archiveClose, archiveStatus, isServiceError } from '../../dashboardSqliteService.js';

import { showConfirmDialog } from '../../utils/confirmDialog.js';
import { downloadBlob } from '../../exportLogsService.js';
import { abortPanelAction, runPanelAction, unwrapServiceResult } from '../panelAction.js';
import { type PanelLifecycle } from '../types.js';
import { showStatus } from '../../../utils/ui/settingsUiHelper.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { cutoffMsFromLocalDate, assertCutoffPair, MAX_ARCHIVE_FILE_BYTES } from '../../../utils/archiveGuards.js';
import { focusTrapManager } from '../../../utils/ui/focusTrap.js';
import { tOrKey as localized } from '../../../utils/i18n.js';
import { formatLocalDateString } from '../../../utils/localDate.js';
import { createArchiveSessionStore } from './archiveSessionStore.js';

/** Per-message binary payload — keeps base64 hops under the 10MB cap. */
const EXPORT_CHUNK_BYTES = MAX_ARCHIVE_EXPORT_CHUNK_BYTES;

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

      const controls = [previewBtn, createBtn, cleanupBtn, downloadBtn, restoreBtn, purgeBtn, sessionQueryBtn, sessionSaveBtn, sessionCloseBtn, restoreFileInput];
      const setAriaBusy = (busy: boolean): void => {
        if (statusEl) statusEl.setAttribute('aria-busy', String(busy));
      };

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
        if (!lastStagingName) throw new Error(localized('archiveDateRequired'));
        const parts: BlobPart[] = [];
        let offset = 0;
        for (;;) {
          const chunk = unwrapServiceResult(await archiveExportChunk(lastStagingName, offset, EXPORT_CHUNK_BYTES));
          // Uint8Array.from avoids the spread-operator stack overflow on 7MB chunks
          const bytes = Uint8Array.from(chunk.chunk);
          parts.push(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
          offset = chunk.nextOffset;
          if (chunk.done) break;
        }
        downloadBlob(new Blob(parts, { type: 'application/x-sqlite3' }), lastFileName);
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
            lastStagingName = data.stagingName;
            lastFileName = `yasumaro_archive_${cutoffDate}.db`;
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
            if (!confirmed) return abortPanelAction();
            return unwrapServiceResult(await archiveDeleteByStaging(lastStagingName));
          },
          onSuccess: (data) => {
            lastStagingName = null;
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
            lastStagingName = null;
            if (downloadBtn) downloadBtn.hidden = true;
            if (cleanupBtn) cleanupBtn.hidden = true;
            showStatus(statusTarget(statusEl), localized('archiveCleanupDone', { count: data.removed.length }), 'success');
          },
          onError: (message) => showStatus(statusTarget(statusEl), `${localized('archiveCleanupFailed')}: ${message}`, 'error'),
        });
      });

      // セッションビューアの staging ライフサイクル（PBI 2026-09-15-09）:
      // idle → staged → open → dirty の状態機械は ArchiveSessionStore が所有。
      const sessionStore = createArchiveSessionStore();

      const renderSessionList = async (): Promise<void> => {
        const staging = sessionStore.getSessionName();
        if (!staging || !sessionListEl) return;
        const { rows } = unwrapServiceResult(await archiveQuery(staging, sessionQueryInput?.value ?? '', 100, 0));
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
                  unwrapServiceResult(await archiveUpdate(staging, row.id, { title: newTitle }));
                  sessionStore.markDirty();
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
        if (isServiceError(status)) return;
        if (status.data.open && status.data.stagingName) {
          sessionStore.reopen(status.data.stagingName, status.data.dirty);
          if (sessionSection) sessionSection.hidden = false;
          try {
            await renderSessionList();
          } catch (err) {
            showStatus(statusTarget(statusEl), errorMessage(err), 'error');
          }
        }
      })();

      sessionQueryBtn?.addEventListener('click', () => {
        void runPanelAction({
          buttons: controls,
          onBusy: setAriaBusy,
          run: renderSessionList,
          onError: (message) => showStatus(statusTarget(statusEl), message, 'error'),
        });
      });

      sessionSaveBtn?.addEventListener('click', () => {
        const staging = sessionStore.getSessionName();
        if (!staging) return;
        void runPanelAction({
          buttons: controls,
          onBusy: setAriaBusy,
          run: async () => unwrapServiceResult(await archiveSave(staging)),
          onSuccess: () => {
            sessionStore.markSaved();
            showStatus(statusTarget(statusEl), localized('archiveSessionSaved'), 'success');
          },
          onError: (message) => showStatus(statusTarget(statusEl), message, 'error'),
        });
      });

      sessionCloseBtn?.addEventListener('click', () => {
        const staging = sessionStore.getSessionName();
        if (!staging) return;
        void runPanelAction({
          buttons: controls,
          onBusy: setAriaBusy,
          run: async () => {
            // The dialog sits inside the busy scope: while it is open the
            // controls stay disabled, so no second action can start.
            if (sessionStore.isDirty()) {
              const confirmed = await showConfirmDialog({
                title: localized('archiveSessionDiscardTitle'),
                message: localized('archiveSessionDiscardMessage'),
                dangerous: true,
              });
              if (!confirmed) return abortPanelAction();
            }
            return unwrapServiceResult(await archiveClose(staging));
          },
          onSuccess: () => {
            sessionStore.clear();
            if (sessionSection) sessionSection.hidden = true;
          },
          onError: (message) => showStatus(statusTarget(statusEl), message, 'error'),
        });
      });

      let restoreStagingName: string | null = null;

      restoreFileInput?.addEventListener('change', () => {
        const file = restoreFileInput?.files?.[0];
        if (!file) return;
        void runPanelAction({
          buttons: controls,
          onBusy: setAriaBusy,
          run: async () => {
            if (file.size > MAX_ARCHIVE_FILE_BYTES) {
              throw new Error(localized('archiveFileTooLarge', {
                max: Math.floor(MAX_ARCHIVE_FILE_BYTES / (1024 * 1024)),
              }));
            }
            // Staging name must be issued by the offscreen registry (fail-closed).
            // Held in a local: a re-pick during the await used to overwrite the
            // shared closure and make this flow preview/stage the other pick.
            const stagingName = unwrapServiceResult(await archivePrepareIncoming());
            restoreStagingName = stagingName;
            lastStagingName = stagingName;

            // Dashboard writes the picked file into the OPFS staging file
            // (same origin); the worker never trusts client paths.
            const root = await navigator.storage.getDirectory();
            const handle = await root.getFileHandle(stagingName, { create: true });
            let writable: FileSystemWritableFileStream | undefined;
            try {
              writable = await handle.createWritable();
              let offset = 0;
              while (offset < file.size) {
                const end = Math.min(offset + EXPORT_CHUNK_BYTES, file.size);
                const buf = await file.slice(offset, end).arrayBuffer();
                await writable.write(buf);
                offset = end;
              }
              await writable.close();
            } catch (err) {
              try { await writable?.abort?.(); } catch { /* ignore */ }
              throw err;
            }

            const meta = unwrapServiceResult(await archiveRestorePreview(stagingName));
            if (restorePreviewEl) {
              restorePreviewEl.hidden = false;
              restorePreviewEl.textContent = localized('archiveRestorePreviewSummary', {
                count: meta.recordCount,
                date: meta.cutoffDate,
              });
            }
            // PBI 2026-09-12-02: hand off to the session viewer inside the busy
            // scope. The staged name must reach the store BEFORE
            // renderSessionList — its guard returns without it, which used to
            // leave the restored session list empty (and save/close dead) until
            // a remount.
            unwrapServiceResult(await archiveOpen(stagingName));
            sessionStore.stageSession(stagingName);
            sessionStore.markOpen();
            if (sessionSection) sessionSection.hidden = false;
            await renderSessionList();
          },
          onSuccess: () => {
            if (restoreBtn) restoreBtn.hidden = false;
            showStatus(statusTarget(statusEl), localized('archiveRestorePreviewReady'), 'success');
          },
          onError: (message) => showStatus(statusTarget(statusEl), `${localized('archiveRestorePreviewFailed')}: ${message}`, 'error'),
        });
      });

      restoreBtn?.addEventListener('click', () => {
        void runPanelAction({
          buttons: controls,
          onBusy: setAriaBusy,
          run: async () => {
            if (!restoreStagingName) throw new Error(localized('archiveDateRequired'));
            return unwrapServiceResult(await archiveRestore(restoreStagingName));
          },
          onSuccess: (data) => {
            if (restorePreviewEl) {
              restorePreviewEl.textContent = localized('archiveRestoreDone', {
                restored: data.restored,
                deleted: data.restoredDeleted,
                skipped: data.skipped,
                invalid: data.skippedInvalid,
              });
            }
            restoreStagingName = null;
            if (restoreBtn) restoreBtn.hidden = true;
            if (restoreFileInput) restoreFileInput.value = '';
            showStatus(statusTarget(statusEl), localized('archiveRestoreDoneStatus'), 'success');
          },
          onError: (message) => showStatus(statusTarget(statusEl), `${localized('archiveRestoreFailed')}: ${message}`, 'error'),
        });
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

interface EditModalHooks {
  onSave: (newTitle: string) => Promise<void>;
  onClosed?: () => Promise<void> | void;
  onError: (message: string) => void;
}

// PBI 2026-09-11-09 (round 6): single definition — was byte-identical twice.
interface ArchiveSessionRowLike {
  id: number;
  title: string | null;
}
