/**
 * archiveSessionPanel.ts
 * Session viewer area of the archive panel: the staged-session lifecycle
 * (owned by ArchiveSessionStore), the session list rendering, the accessible
 * edit modal, the mount-time reconnect, and the query/save/close actions.
 * Exposes the store and the list renderer for the restore area, which hands
 * a restored staging file into the same session lifecycle.
 */

import { archiveQuery, archiveUpdate, archiveSave, archiveClose, archiveStatus, isServiceError } from '../../dashboardSqliteService.js';
import { showConfirmDialog } from '../../utils/confirmDialog.js';
import { abortPanelAction, runPanelAction, unwrapServiceResult } from '../panelAction.js';
import { showStatus } from '../../../utils/ui/settingsUiHelper.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { focusTrapManager } from '../../../utils/ui/focusTrap.js';
import { tOrKey as localized } from '../../../utils/i18n.js';
import { createArchiveSessionStore, type ArchiveSessionStore } from './archiveSessionStore.js';
import { statusTarget, type ArchiveBusyScope } from './archivePanelShared.js';

interface EditModalHooks {
  onSave: (newTitle: string) => Promise<void>;
  onClosed?: () => Promise<void> | void;
  onError: (message: string) => void;
}

interface ArchiveSessionRowLike {
  id: number;
  title: string | null;
}

export interface ArchiveSessionViewerDeps {
  container: HTMLElement;
  sessionSection: HTMLElement | null;
  sessionQueryInput: HTMLInputElement | null;
  sessionQueryBtn: HTMLButtonElement | null;
  sessionListEl: HTMLElement | null;
  sessionSaveBtn: HTMLButtonElement | null;
  sessionCloseBtn: HTMLButtonElement | null;
  busy: ArchiveBusyScope;
}

export interface ArchiveSessionViewer {
  store: ArchiveSessionStore;
  renderList(): Promise<void>;
}

export function mountArchiveSessionViewer(deps: ArchiveSessionViewerDeps): ArchiveSessionViewer {
  const { container, sessionSection, sessionQueryInput, sessionQueryBtn, sessionListEl, sessionSaveBtn, sessionCloseBtn, busy } = deps;
  const { controls, setAriaBusy, statusEl } = busy;

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

  return { store: sessionStore, renderList: renderSessionList };
}
