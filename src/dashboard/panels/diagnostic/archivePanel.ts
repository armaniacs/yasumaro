/**
 * archivePanel.ts
 * Dashboard panel for the date-based archive (PBI 2026-09-06-02, phase A).
 *
 * Flow: pick a boundary date → preview counts → create the staging file
 * (main DB untouched) → chunked download of the staging .db → optional
 * cleanup of the staging copy. Deletion of records from the main DB is
 * phase B (pbi/2026-09-06-04), intentionally not wired here.
 *
 * mount only composes three independent lifecycle factories — archive
 * lifecycle, session viewer + edit modal, and restore. The shared
 * controls/busy scope (the in-flight guard surface) and the staging state
 * shared between the lifecycle and restore areas live here.
 */

import { type PanelLifecycle } from '../types.js';
import { mountArchiveLifecycle } from './archiveLifecyclePanel.js';
import { mountArchiveSessionViewer } from './archiveSessionPanel.js';
import { mountArchiveRestore } from './archiveRestorePanel.js';
import { type ArchiveBusyScope, type ArchiveStagingState } from './archivePanelShared.js';

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

      const controls = [previewBtn, createBtn, cleanupBtn, downloadBtn, restoreBtn, purgeBtn, sessionQueryBtn, sessionSaveBtn, sessionCloseBtn, restoreFileInput];
      const setAriaBusy = (busy: boolean): void => {
        if (statusEl) statusEl.setAttribute('aria-busy', String(busy));
      };

      const staging: ArchiveStagingState = { lastStagingName: null, lastFileName: '' };
      const busy: ArchiveBusyScope = { controls, setAriaBusy, statusEl };

      mountArchiveLifecycle({ dateInput, includeDeletedInput, previewBtn, createBtn, downloadBtn, cleanupBtn, purgeBtn, summaryEl, busy, staging });
      const session = mountArchiveSessionViewer({ container, sessionSection, sessionQueryInput, sessionQueryBtn, sessionListEl, sessionSaveBtn, sessionCloseBtn, busy });
      mountArchiveRestore({ restoreFileInput, restorePreviewEl, restoreBtn, sessionSection, session, busy, staging });
    },
  };
}
