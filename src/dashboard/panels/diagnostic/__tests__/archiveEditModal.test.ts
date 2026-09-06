// @vitest-environment jsdom
/**
 * archiveEditModal.test.ts
 * PBI 2026-09-06-07: the archive session edit UI must be an accessible modal
 * (role=dialog, aria-modal, focus trap, Esc, focus restore) instead of
 * window.prompt.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ArchiveSessionRow } from '../../../messaging/sqliteMessages.js';

vi.mock('../../../dashboardSqliteService.js', () => ({
  archivePreview: vi.fn(),
  archiveCreate: vi.fn(),
  archiveCleanup: vi.fn(),
  archiveExportChunk: vi.fn(),
  archivePrepareIncoming: vi.fn(),
  archiveRestorePreview: vi.fn(),
  archiveRestore: vi.fn(),
  archiveDeleteByStaging: vi.fn(),
  archiveOpen: vi.fn(),
  archiveQuery: vi.fn(),
  archiveUpdate: vi.fn(),
  archiveSave: vi.fn(),
  archiveClose: vi.fn(),
  archiveStatus: vi.fn(),
}));

import { createArchivePanel } from '../archivePanel.js';
import { archiveQuery, archiveUpdate, archiveStatus } from '../../../dashboardSqliteService.js';
import { focusTrapManager } from '../../../../utils/ui/focusTrap.js';

const STAGING = 'archive_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db';

function makeRow(overrides: Partial<ArchiveSessionRow> = {}): ArchiveSessionRow {
  return {
    id: 7,
    url: 'https://x.test/7',
    title: 'old title',
    summary: null,
    tags: null,
    created_at: 1700000000000,
    is_starred: 0,
    is_deleted: 0,
    ...overrides,
  };
}

async function mountWithSession(rows: ArchiveSessionRow[]) {
  vi.mocked(archiveQuery).mockResolvedValue({ success: true, data: { rows, total: rows.length } } as never);
  // The reconnect probe must report an open session so the panel binds to it.
  vi.mocked(archiveStatus).mockResolvedValue({
    success: true,
    data: { open: true, stagingName: STAGING, dirty: false },
  } as never);

  const container = document.createElement('section');
  container.innerHTML = `
    <input type="date" id="archive-date">
    <input type="checkbox" id="archive-include-deleted">
    <button id="archive-preview-btn"></button>
    <button id="archive-create-btn"></button>
    <button id="archive-download-btn" hidden></button>
    <button id="archive-purge-btn" hidden></button>
    <button id="archive-cleanup-btn" hidden></button>
    <button id="archive-restore-btn" hidden></button>
    <input type="file" id="archive-restore-file">
    <div id="archive-preview-summary" hidden></div>
    <div id="archive-restore-preview-summary" hidden></div>
    <div id="archive-status" aria-live="polite"></div>
    <div id="archive-session-section">
      <input type="text" id="archive-session-query">
      <button id="archive-session-query-btn"></button>
      <button id="archive-session-save-btn"></button>
      <button id="archive-session-close-btn"></button>
      <div id="archive-session-list"></div>
    </div>
  `;
  document.body.appendChild(container);

  const panel = createArchivePanel();
  await panel.mount(container);
  // Open the session by re-running the query-driven render path (the panel
  // renders the list on mount when a session is open; in tests we trigger it
  // through the search button which calls renderSessionList internally).
  (container.querySelector('#archive-session-query-btn') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(container.querySelectorAll('.archive-session-row').length).toBe(rows.length),
  );
  return container;
}

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: { getManifest: () => ({ version: '6.7.114' }) },
    i18n: {
      getMessage: (key: string) => {
        const templates: Record<string, string> = {
          archiveSessionEditBtn: 'Edit title',
          archiveModalTitle: 'Edit title',
          archiveModalTitleLabel: 'Title',
          archiveModalSave: 'Save',
          archiveModalCancel: 'Cancel',
          archiveModalTitleRequired: 'Title is required',
          archiveModalTitleTooLong: 'Title is too long',
        };
        return templates[key] ?? key;
      },
    },
  };
});

describe('archive edit modal (PBI 2026-09-06-07)', () => {
  it('opens an accessible dialog on Edit click and focuses the input', async () => {
    const container = await mountWithSession([makeRow(7)]);
    const editBtn = container.querySelector('.archive-session-row button') as HTMLButtonElement;
    editBtn.click();

    const modal = document.querySelector('[role="dialog"][aria-modal="true"]');
    expect(modal).not.toBeNull();
    expect(modal?.getAttribute('aria-labelledby')).toBeTruthy();
    const input = modal?.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input.value).toBe('old title');
    expect(document.activeElement).toBe(input);
  });

  it('traps Tab inside the modal (focus cycles back)', async () => {
    const container = await mountWithSession([makeRow(7)]);
    (container.querySelector('.archive-session-row button') as HTMLButtonElement).click();

    const modal = document.querySelector('[role="dialog"]') as HTMLElement;
    const cancelBtn = modal.querySelector('button.archive-modal-cancel') as HTMLButtonElement;
    cancelBtn.focus();

    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    modal.dispatchEvent(tabEvent);
    // focus cycles from the last focusable back to the first focusable
    const firstFocusable = modal.querySelector('input[type="text"]') as HTMLInputElement;
    expect(document.activeElement).toBe(firstFocusable);
  });

  it('save commits via archive_update, closes, restores focus to the edit button', async () => {
    vi.mocked(archiveUpdate).mockResolvedValue({ success: true, data: { dirty: true } } as never);
    const container = await mountWithSession([makeRow(7)]);
    const editBtn = container.querySelector('.archive-session-row button') as HTMLButtonElement;
    editBtn.click();

    const modal = document.querySelector('[role="dialog"]') as HTMLElement;
    const input = modal.querySelector('input[type="text"]') as HTMLInputElement;
    input.value = 'new title';
    (modal.querySelector('.archive-modal-save') as HTMLButtonElement).click();

    await vi.waitFor(() =>
      expect(vi.mocked(archiveUpdate)).toHaveBeenCalledWith(STAGING, 7, { title: 'new title' }),
    );
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    // focus restored to the session list row (re-rendered after save)
    await vi.waitFor(() => {
      const rowEl = container.querySelector(`.archive-session-row[data-row-id="7"]`);
      expect(document.activeElement).toBe(rowEl?.querySelector('button'));
    });
  });

  it('Esc cancels without calling archive_update', async () => {
    const container = await mountWithSession([makeRow(7)]);
    const editBtn = container.querySelector('.archive-session-row button') as HTMLButtonElement;
    editBtn.click();

    const modal = document.querySelector('[role="dialog"]') as HTMLElement;
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(vi.mocked(archiveUpdate)).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(editBtn);
  });

  it('rejects an empty title on save (modal stays open with the error)', async () => {
    const container = await mountWithSession([makeRow(7)]);
    (container.querySelector('.archive-session-row button') as HTMLButtonElement).click();

    const modal = document.querySelector('[role="dialog"]') as HTMLElement;
    const input = modal.querySelector('input[type="text"]') as HTMLInputElement;
    input.value = '';
    (modal.querySelector('.archive-modal-save') as HTMLButtonElement).click();

    const errorEl = modal.querySelector('.archive-modal-error') as HTMLElement;
    expect(errorEl?.textContent).toMatch(/required/i);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(vi.mocked(archiveUpdate)).not.toHaveBeenCalled();
  });
});
