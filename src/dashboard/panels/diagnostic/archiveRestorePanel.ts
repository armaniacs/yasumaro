/**
 * archiveRestorePanel.ts
 * Restore area of the archive panel: pick a backup file → size guard →
 * stage the incoming copy in OPFS → restore preview → hand the staged file
 * to the session viewer → create (apply) the restore into the main DB.
 */

import { MAX_ARCHIVE_FILE_BYTES } from '../../../utils/archiveGuards.js';
import { archivePrepareIncoming, archiveRestorePreview, archiveRestore, archiveOpen } from '../../dashboardSqliteService.js';
import { runPanelAction, unwrapServiceResult } from '../panelAction.js';
import { showStatus } from '../../../utils/ui/settingsUiHelper.js';
import { tOrKey as localized } from '../../../utils/i18n.js';
import { EXPORT_CHUNK_BYTES, statusTarget, type ArchiveBusyScope, type ArchiveStagingState } from './archivePanelShared.js';
import { type ArchiveSessionViewer } from './archiveSessionPanel.js';

export interface ArchiveRestoreDeps {
  restoreFileInput: HTMLInputElement | null;
  restorePreviewEl: HTMLElement | null;
  restoreBtn: HTMLButtonElement | null;
  sessionSection: HTMLElement | null;
  session: ArchiveSessionViewer;
  busy: ArchiveBusyScope;
  staging: ArchiveStagingState;
}

export function mountArchiveRestore(deps: ArchiveRestoreDeps): void {
  const { restoreFileInput, restorePreviewEl, restoreBtn, sessionSection, session, busy, staging } = deps;
  const { controls, setAriaBusy, statusEl } = busy;

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
        staging.lastStagingName = stagingName;

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
        session.store.stageSession(stagingName);
        session.store.markOpen();
        if (sessionSection) sessionSection.hidden = false;
        await session.renderList();
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
}
