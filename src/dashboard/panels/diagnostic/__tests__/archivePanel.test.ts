// @vitest-environment jsdom
/**
 * archivePanel.test.ts
 * Unit tests for the archive panel mount behavior (PBI 2026-09-06-02).
 * The dashboard-ui e2e spec loads dist/options.html via file:// where module
 * scripts are CORS-blocked, so JS-driven behavior is verified here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../dashboardSqliteService.js', () => ({
  archivePreview: vi.fn(),
  archiveCreate: vi.fn(),
  archiveCleanup: vi.fn(),
  archiveExportChunk: vi.fn(),
  // Temp-open session + restore flow functions (PBI 2026-09-06-03/04/05) —
  // the panel imports all of them at mount; a missing mock export surfaces
  // as an unhandled rejection, not a test failure.
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
  // The shared unwrap guard: without it on the mock every result read through
  // it throws "No ... export is defined on the mock".
  isServiceError: (result: object): boolean => 'error' in result,
}));

vi.mock('../../../utils/confirmDialog.js', () => ({
  showConfirmDialog: vi.fn(),
}));

vi.mock('../../../exportLogsService.js', () => ({
  downloadBlob: vi.fn(),
}));

import { createArchivePanel } from '../archivePanel.js';
import { showConfirmDialog } from '../../../utils/confirmDialog.js';
import { downloadBlob } from '../../../exportLogsService.js';
import { archivePreview, archiveCreate, archiveStatus } from '../../../dashboardSqliteService.js';
import { MAX_ARCHIVE_EXPORT_CHUNK_BYTES } from '../../../../utils/limits.js';
import { drainMacrotask } from '../../../../../testDir/waitPolicy.js';

async function mountPanel(): Promise<{
  container: HTMLElement;
  dateInput: HTMLInputElement;
  includeDeleted: HTMLInputElement;
  previewBtn: HTMLButtonElement;
  createBtn: HTMLButtonElement;
  downloadBtn: HTMLButtonElement;
  cleanupBtn: HTMLButtonElement;
  summaryEl: HTMLElement;
  statusEl: HTMLElement;
}> {
  const container = document.createElement('section');
  container.innerHTML = `
    <input type="date" id="archive-date">
    <input type="checkbox" id="archive-include-deleted">
    <button id="archive-preview-btn"></button>
    <button id="archive-create-btn"></button>
    <button id="archive-download-btn" hidden></button>
    <button id="archive-cleanup-btn" hidden></button>
    <div id="archive-preview-summary" hidden></div>
    <div id="archive-status" aria-live="polite"></div>
  `;
  document.body.appendChild(container);
  const panel = createArchivePanel();
  await panel.mount(container);
  const q = <T extends Element>(sel: string): T => container.querySelector(sel) as T;
  return {
    container,
    dateInput: q('#archive-date'),
    includeDeleted: q('#archive-include-deleted'),
    previewBtn: q('#archive-preview-btn'),
    createBtn: q('#archive-create-btn'),
    downloadBtn: q('#archive-download-btn') as HTMLButtonElement,
    cleanupBtn: q('#archive-cleanup-btn') as HTMLButtonElement,
    summaryEl: q('#archive-preview-summary'),
    statusEl: q('#archive-status'),
  };
}

async function stubOpfs(): Promise<void> {
  const writable = { write: vi.fn(), close: vi.fn(), abort: vi.fn() };
  (globalThis.navigator as unknown as { storage: unknown }).storage = {
    getDirectory: async () => ({
      getFileHandle: async () => ({ createWritable: async () => writable }),
    }),
  };
}

async function mountFullPanel(): Promise<{
  container: HTMLElement;
  dateInput: HTMLInputElement;
  createBtn: HTMLButtonElement;
  downloadBtn: HTMLButtonElement;
  cleanupBtn: HTMLButtonElement;
  statusEl: HTMLElement;
}> {
  const container = document.createElement('section');
  container.innerHTML = `
    <input type="date" id="archive-date">
    <input type="checkbox" id="archive-include-deleted">
    <button id="archive-preview-btn"></button>
    <button id="archive-create-btn"></button>
    <button id="archive-download-btn" hidden></button>
    <button id="archive-cleanup-btn" hidden></button>
    <button id="archive-purge-btn" hidden></button>
    <div id="archive-preview-summary" hidden></div>
    <div id="archive-status" aria-live="polite"></div>
    <section id="archive-session-section" hidden>
      <input id="archive-session-query">
      <button id="archive-session-query-btn"></button>
      <div id="archive-session-list"></div>
      <button id="archive-session-save-btn"></button>
      <button id="archive-session-close-btn"></button>
    </section>
    <input type="file" id="archive-restore-file">
    <div id="archive-restore-preview-summary" hidden></div>
    <button id="archive-restore-btn" hidden></button>
  `;
  document.body.appendChild(container);
  const panel = createArchivePanel();
  await panel.mount(container);
  const q = <T extends Element>(sel: string): T => container.querySelector(sel) as T;
  return {
    container,
    dateInput: q('#archive-date'),
    createBtn: q('#archive-create-btn'),
    downloadBtn: q('#archive-download-btn'),
    cleanupBtn: q('#archive-cleanup-btn'),
    statusEl: q('#archive-status'),
  };
}

describe('archivePanel mount (PBI 2026-09-06-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The panel probes the session state on mount; give it a closed-session
    // default so the fire-and-forget reconnect path resolves a ServiceResult.
    vi.mocked(archiveStatus).mockResolvedValue({
      data: { open: false, stagingName: null, dirty: false },
    } as never);
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: { getManifest: () => ({ version: '6.7.113' }) },
      i18n: {
        getMessage: (key: string, subs?: string | Record<string, string | number>) => {
          const templates: Record<string, string> = {
            archiveDateRequired: 'Choose a date first',
            archiveStatusWorking: 'Working…',
            archivePreviewSummary: 'To archive: {total} (starred: {starred}). Deleted: {deleted}',
            archiveCreatedSummary: 'Archive created: {count} exported.',
            archiveCreatedDownloadHint: 'Download ready',
            archiveDownloadDone: 'Download done',
            archiveCleanupDone: 'Cleaned up: {count}',
            archiveSessionSaved: 'Session saved',
            archiveSessionEmpty: 'No sessions',
            archiveSessionEditBtn: 'Edit',
            archiveModalTitle: 'Edit session',
            archiveModalTitleLabel: 'Title',
            archiveModalSave: 'Save',
            archiveModalCancel: 'Cancel',
            archiveModalTitleRequired: 'Title is required',
            archiveModalTitleTooLong: 'Title is too long',
            archiveRestorePreviewSummary: '{count} records from {date}',
            archiveRestorePreviewReady: 'Restore preview ready',
            archiveRestoreDone: 'Restored {restored} (deleted {deleted}, skipped {skipped}, invalid {invalid})',
            archiveRestoreDoneStatus: 'Restore complete',
          };
          let text = templates[key] ?? '';
          if (subs && typeof subs === 'object' && !Array.isArray(subs)) {
            for (const [k, v] of Object.entries(subs)) {
              text = text.replaceAll(`{${k}}`, String(v));
            }
          }
          return text;
        },
      },
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('defaults the date to today and caps it at today', async () => {
    mountPanel();
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const dateInput = document.querySelector('#archive-date') as HTMLInputElement;
    expect(dateInput.value).toBe(iso);
    expect(dateInput.max).toBe(iso);
  });

  it('preview click shows the localized counts summary', async () => {
    vi.mocked(archivePreview).mockResolvedValue({
      data: { total: 10, starred: 2, deleted: 1, oldest: 100, newest: 200, includeDeleted: false },
    } as never);
    const { previewBtn, summaryEl, statusEl } = await mountPanel();
    previewBtn.click();
    await vi.waitFor(() => expect(summaryEl.hidden).toBe(false));
    expect(summaryEl.textContent).toContain('To archive: 10');
    expect(statusEl.getAttribute('aria-busy')).toBe('false');
    expect(vi.mocked(archivePreview).mock.calls[0]?.[2]).toBe(false);
  });

  it('create click stores the staging name and reveals download/cleanup', async () => {
    vi.mocked(archiveCreate).mockResolvedValue({
      data: { stagingName: 'archive_outgoing_abc.db', recordCount: 5 },
    } as never);
    const { createBtn, downloadBtn, cleanupBtn, summaryEl, statusEl } = await mountPanel();
    createBtn.click();
    await vi.waitFor(() => expect(downloadBtn.hidden).toBe(false));
    expect(cleanupBtn.hidden).toBe(false);
    expect(summaryEl.textContent).toContain('Archive created: 5 exported.');
    expect(statusEl.getAttribute('aria-busy')).toBe('false');
    expect(vi.mocked(archiveCreate).mock.calls[0]?.[0]).toEqual({
      cutoffDate: expect.any(String),
      cutoffMs: expect.any(Number),
      includeDeleted: false,
      yasumaroVersion: '6.7.113',
    });
  });

  it('create failure surfaces the reason and keeps controls enabled', async () => {
    vi.mocked(archiveCreate).mockResolvedValue({ error: 'insufficient storage quota' } as never);
    const { createBtn, downloadBtn, statusEl } = await mountPanel();
    createBtn.click();
    await vi.waitFor(() => expect(statusEl.textContent).toContain('insufficient storage quota'));
    expect(createBtn.disabled).toBe(false);
    expect(downloadBtn.hidden).toBe(true);
  });

  it('preview with an out-of-range date shows the boundary error without calling the service', async () => {
    const { previewBtn, statusEl } = await mountPanel();
    // jsdom sanitizes invalid date values (e.g. 2026-02-30 → ''), so use a
    // well-formed date outside the allowed range instead.
    (document.querySelector('#archive-date') as HTMLInputElement).value = '1999-12-31';
    previewBtn.click();
    await vi.waitFor(() => expect(statusEl.textContent).toContain('out of range'));
    expect(archivePreview).not.toHaveBeenCalled();
  });

  it('restore preview hands the staging name to the session viewer (PBI 2026-09-12-02)', async () => {
    const svc = await import('../../../dashboardSqliteService.js');
    vi.mocked(svc.archivePrepareIncoming).mockResolvedValue({ data: 'archive_incoming_test.db' } as never);
    vi.mocked(svc.archiveRestorePreview).mockResolvedValue({
      data: { recordCount: 3, cutoffDate: '2026-09-01' },
    } as never);
    vi.mocked(svc.archiveOpen).mockResolvedValue({ data: {} } as never);
    vi.mocked(svc.archiveQuery).mockResolvedValue({
      data: { rows: [{ id: 1, created_at: 1727000000000, title: 'Row A', url: 'https://a.example.com' }], total: 1 },
    } as never);

    // Stub the OPFS write the restore flow uses to stage the picked file.
    const writable = { write: vi.fn(), close: vi.fn(), abort: vi.fn() };
    (globalThis.navigator as unknown as { storage: unknown }).storage = {
      getDirectory: async () => ({
        getFileHandle: async () => ({ createWritable: async () => writable }),
      }),
    };

    const container = document.createElement('section');
    container.innerHTML = `
      <input type="date" id="archive-date">
      <input type="checkbox" id="archive-include-deleted">
      <button id="archive-preview-btn"></button>
      <button id="archive-create-btn"></button>
      <div id="archive-preview-summary" hidden></div>
      <div id="archive-status" aria-live="polite"></div>
      <section id="archive-session-section" hidden>
        <input id="archive-session-query">
        <button id="archive-session-query-btn"></button>
        <div id="archive-session-list"></div>
        <button id="archive-session-save-btn"></button>
        <button id="archive-session-close-btn"></button>
      </section>
      <input type="file" id="archive-restore-file">
      <div id="archive-restore-preview-summary" hidden></div>
      <button id="archive-restore-btn" hidden></button>
    `;
    document.body.appendChild(container);
    const panel = createArchivePanel();
    await panel.mount(container);

    const input = container.querySelector('#archive-restore-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['sqlite-bytes'], 'backup.db')] });
    input.dispatchEvent(new Event('change'));

    const list = container.querySelector('#archive-session-list') as HTMLElement;
    const sessionSection = container.querySelector('#archive-session-section') as HTMLElement;
    await vi.waitFor(() => expect(list.querySelectorAll('.archive-session-row').length).toBe(1));

    // The handoff fix: open succeeded → sessionStaging is set → the list
    // renders (previously the guard returned and the section stayed empty)
    // and the query runs against the restored staging name.
    expect(svc.archiveOpen).toHaveBeenCalledWith('archive_incoming_test.db');
    expect(svc.archiveQuery).toHaveBeenCalledWith('archive_incoming_test.db', '', 100, 0);
    expect(sessionSection.hidden).toBe(false);
  });

  it('ignores a file re-pick while a restore is in flight (staging race guard)', async () => {
    const svc = await import('../../../dashboardSqliteService.js');
    const firstPrepare = Promise.withResolvers<{ data: string }>();
    let prepareCalls = 0;
    vi.mocked(svc.archivePrepareIncoming).mockImplementation(async () => {
      prepareCalls += 1;
      if (prepareCalls === 1) return firstPrepare.promise;
      return { data: 'archive_incoming_second.db' };
    });
    vi.mocked(svc.archiveRestorePreview).mockResolvedValue({
      data: { recordCount: 3, cutoffDate: '2026-09-01' },
    } as never);
    vi.mocked(svc.archiveOpen).mockResolvedValue({ data: {} } as never);
    vi.mocked(svc.archiveQuery).mockResolvedValue({
      data: { rows: [{ id: 1, created_at: 1727000000000, title: 'Row A', url: 'https://a.example.com' }], total: 1 },
    } as never);

    // Stub the OPFS write the restore flow uses to stage the picked file.
    const writable = { write: vi.fn(), close: vi.fn(), abort: vi.fn() };
    (globalThis.navigator as unknown as { storage: unknown }).storage = {
      getDirectory: async () => ({
        getFileHandle: async () => ({ createWritable: async () => writable }),
      }),
    };

    const container = document.createElement('section');
    container.innerHTML = `
      <input type="date" id="archive-date">
      <input type="checkbox" id="archive-include-deleted">
      <button id="archive-preview-btn"></button>
      <button id="archive-create-btn"></button>
      <div id="archive-preview-summary" hidden></div>
      <div id="archive-status" aria-live="polite"></div>
      <section id="archive-session-section" hidden>
        <input id="archive-session-query">
        <button id="archive-session-query-btn"></button>
        <div id="archive-session-list"></div>
        <button id="archive-session-save-btn"></button>
        <button id="archive-session-close-btn"></button>
      </section>
      <input type="file" id="archive-restore-file">
      <div id="archive-restore-preview-summary" hidden></div>
      <button id="archive-restore-btn" hidden></button>
    `;
    document.body.appendChild(container);
    const panel = createArchivePanel();
    await panel.mount(container);

    const input = container.querySelector('#archive-restore-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['first-db'], 'first.db')], configurable: true });
    input.dispatchEvent(new Event('change'));

    // In flight: the first flow is parked on archivePrepareIncoming.
    await vi.waitFor(() => expect(prepareCalls).toBe(1));
    // The file input belongs to the busy scope: disabled while the flow runs.
    expect(input.disabled).toBe(true);

    // Re-pick a different file while the first restore is still in flight.
    Object.defineProperty(input, 'files', { value: [new File(['second-db'], 'second.db')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await drainMacrotask();

    // FAIL pre-fix: the re-pick started a second runPanelAction, so
    // archivePrepareIncoming was called twice and the shared staging closure
    // crossed wires between the two flows.
    expect(prepareCalls).toBe(1);

    firstPrepare.resolve({ data: 'archive_incoming_first.db' });
    const list = container.querySelector('#archive-session-list') as HTMLElement;
    await vi.waitFor(() => expect(list.querySelectorAll('.archive-session-row').length).toBe(1));

    // flow1 must preview/open its OWN staging name, never the re-pick's.
    expect(svc.archiveRestorePreview).toHaveBeenCalledTimes(1);
    expect(svc.archiveRestorePreview).toHaveBeenCalledWith('archive_incoming_first.db');
    expect(svc.archiveOpen).toHaveBeenCalledTimes(1);
    expect(svc.archiveOpen).toHaveBeenCalledWith('archive_incoming_first.db');
  });

  it('keeps controls disabled while the session-close confirm dialog is open', async () => {
    const svc = await import('../../../dashboardSqliteService.js');
    vi.mocked(archiveStatus).mockResolvedValue({
      data: { open: true, stagingName: 'session_open.db', dirty: true },
    } as never);
    vi.mocked(svc.archiveQuery).mockResolvedValue({ data: { rows: [], total: 0 } } as never);
    vi.mocked(svc.archiveClose).mockResolvedValue({ data: { dirty: false } } as never);
    const gate = Promise.withResolvers<boolean>();
    vi.mocked(showConfirmDialog).mockImplementation(() => gate.promise);

    const container = document.createElement('section');
    container.innerHTML = `
      <input type="date" id="archive-date">
      <input type="checkbox" id="archive-include-deleted">
      <button id="archive-preview-btn"></button>
      <button id="archive-create-btn"></button>
      <div id="archive-preview-summary" hidden></div>
      <div id="archive-status" aria-live="polite"></div>
      <section id="archive-session-section" hidden>
        <input id="archive-session-query">
        <button id="archive-session-query-btn"></button>
        <div id="archive-session-list"></div>
        <button id="archive-session-save-btn"></button>
        <button id="archive-session-close-btn"></button>
      </section>
      <input type="file" id="archive-restore-file">
      <div id="archive-restore-preview-summary" hidden></div>
      <button id="archive-restore-btn" hidden></button>
    `;
    document.body.appendChild(container);
    const panel = createArchivePanel();
    await panel.mount(container);

    const closeBtn = container.querySelector('#archive-session-close-btn') as HTMLButtonElement;
    const sessionSection = container.querySelector('#archive-session-section') as HTMLElement;
    closeBtn.click();
    await vi.waitFor(() => expect(showConfirmDialog).toHaveBeenCalled());

    // FAIL pre-fix: the dialog was awaited before runPanelAction, so the
    // controls stayed enabled while it was open.
    expect(closeBtn.disabled).toBe(true);

    gate.resolve(true);
    await vi.waitFor(() => expect(svc.archiveClose).toHaveBeenCalledWith('session_open.db'));
    expect(closeBtn.disabled).toBe(false);
    expect(sessionSection.hidden).toBe(true);
  });

  it('does not close the session when the discard dialog is cancelled', async () => {
    const svc = await import('../../../dashboardSqliteService.js');
    vi.mocked(archiveStatus).mockResolvedValue({
      data: { open: true, stagingName: 'session_open.db', dirty: true },
    } as never);
    vi.mocked(svc.archiveQuery).mockResolvedValue({ data: { rows: [], total: 0 } } as never);
    const gate = Promise.withResolvers<boolean>();
    vi.mocked(showConfirmDialog).mockImplementation(() => gate.promise);

    const container = document.createElement('section');
    container.innerHTML = `
      <input type="date" id="archive-date">
      <input type="checkbox" id="archive-include-deleted">
      <button id="archive-preview-btn"></button>
      <button id="archive-create-btn"></button>
      <div id="archive-preview-summary" hidden></div>
      <div id="archive-status" aria-live="polite"></div>
      <section id="archive-session-section" hidden>
        <input id="archive-session-query">
        <button id="archive-session-query-btn"></button>
        <div id="archive-session-list"></div>
        <button id="archive-session-save-btn"></button>
        <button id="archive-session-close-btn"></button>
      </section>
      <input type="file" id="archive-restore-file">
      <div id="archive-restore-preview-summary" hidden></div>
      <button id="archive-restore-btn" hidden></button>
    `;
    document.body.appendChild(container);
    const panel = createArchivePanel();
    await panel.mount(container);

    const closeBtn = container.querySelector('#archive-session-close-btn') as HTMLButtonElement;
    const sessionSection = container.querySelector('#archive-session-section') as HTMLElement;
    closeBtn.click();
    await vi.waitFor(() => expect(showConfirmDialog).toHaveBeenCalled());

    gate.resolve(false);
    await vi.waitFor(() => expect(closeBtn.disabled).toBe(false));
    expect(svc.archiveClose).not.toHaveBeenCalled();
    expect(sessionSection.hidden).toBe(false);
  });

  // ==========================================================================
  // Parity tests (PBI 2026-10-03-28 lifecycle factory split): every factory
  // flow pinned through the composed mount so the split stays observable-
  // behavior identical.
  // ==========================================================================

  it('parity: download streams the staging db in export chunks and hands the blob to the downloader', async () => {
    const svc = await import('../../../dashboardSqliteService.js');
    vi.mocked(archiveCreate).mockResolvedValue({
      data: { stagingName: 'archive_outgoing_dl.db', recordCount: 5 },
    } as never);
    vi.mocked(svc.archiveExportChunk).mockResolvedValueOnce({ data: { chunk: [1, 2, 3], nextOffset: 3, done: false } } as never);
    vi.mocked(svc.archiveExportChunk).mockResolvedValueOnce({ data: { chunk: [4], nextOffset: 4, done: true } } as never);

    const { createBtn, downloadBtn, dateInput } = await mountFullPanel();
    createBtn.click();
    await vi.waitFor(() => expect(downloadBtn.hidden).toBe(false));
    downloadBtn.click();

    await vi.waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(svc.archiveExportChunk).toHaveBeenNthCalledWith(1, 'archive_outgoing_dl.db', 0, MAX_ARCHIVE_EXPORT_CHUNK_BYTES);
    expect(svc.archiveExportChunk).toHaveBeenNthCalledWith(2, 'archive_outgoing_dl.db', 3, MAX_ARCHIVE_EXPORT_CHUNK_BYTES);
    const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0] as [Blob, string];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/x-sqlite3');
    expect(blob.size).toBe(4);
    expect(filename).toBe(`yasumaro_archive_${dateInput.value}.db`);
  });

  it('parity: cleanup clears the staging and re-hides download/cleanup', async () => {
    const svc = await import('../../../dashboardSqliteService.js');
    vi.mocked(archiveCreate).mockResolvedValue({
      data: { stagingName: 'archive_outgoing_cl.db', recordCount: 5 },
    } as never);
    vi.mocked(svc.archiveCleanup).mockResolvedValue({ data: { removed: ['archive_outgoing_cl.db'] } } as never);

    const { createBtn, cleanupBtn, downloadBtn, statusEl } = await mountFullPanel();
    createBtn.click();
    await vi.waitFor(() => expect(cleanupBtn.hidden).toBe(false));
    cleanupBtn.click();

    await vi.waitFor(() => expect(statusEl.textContent).toContain('Cleaned up: 1'));
    expect(svc.archiveCleanup).toHaveBeenCalledTimes(1);
    expect(downloadBtn.hidden).toBe(true);
    expect(cleanupBtn.hidden).toBe(true);
  });

  it('parity: session query renders rows and re-queries with the typed text', async () => {
    const svc = await import('../../../dashboardSqliteService.js');
    vi.mocked(archiveStatus).mockResolvedValue({ data: { open: true, stagingName: 'session_query.db', dirty: false } } as never);
    vi.mocked(svc.archiveQuery).mockResolvedValue({
      data: {
        rows: [
          { id: 1, created_at: 1727000000000, title: 'Row A', url: 'https://a.example.com' },
          { id: 2, created_at: 1727000001000, title: null, url: 'https://b.example.com' },
        ],
        total: 2,
      },
    } as never);

    const { container } = await mountFullPanel();
    const list = container.querySelector('#archive-session-list') as HTMLElement;
    await vi.waitFor(() => expect(list.querySelectorAll('.archive-session-row').length).toBe(2));
    expect(list.querySelector('.archive-session-row[data-row-id="1"]')).not.toBeNull();

    const queryInput = container.querySelector('#archive-session-query') as HTMLInputElement;
    const queryBtn = container.querySelector('#archive-session-query-btn') as HTMLButtonElement;
    queryInput.value = 'example';
    queryBtn.click();

    await vi.waitFor(() => expect(svc.archiveQuery).toHaveBeenNthCalledWith(2, 'session_query.db', 'example', 100, 0));
    expect(list.querySelectorAll('.archive-session-row').length).toBe(2);
  });

  it('parity: session save persists the staging and lets close skip the discard dialog', async () => {
    const svc = await import('../../../dashboardSqliteService.js');
    vi.mocked(archiveStatus).mockResolvedValue({ data: { open: true, stagingName: 'session_save.db', dirty: true } } as never);
    vi.mocked(svc.archiveQuery).mockResolvedValue({ data: { rows: [], total: 0 } } as never);
    vi.mocked(svc.archiveSave).mockResolvedValue({ data: {} } as never);
    vi.mocked(svc.archiveClose).mockResolvedValue({ data: {} } as never);

    const { container, statusEl } = await mountFullPanel();
    const saveBtn = container.querySelector('#archive-session-save-btn') as HTMLButtonElement;
    const closeBtn = container.querySelector('#archive-session-close-btn') as HTMLButtonElement;
    const sessionSection = container.querySelector('#archive-session-section') as HTMLElement;

    saveBtn.click();
    await vi.waitFor(() => expect(svc.archiveSave).toHaveBeenCalledWith('session_save.db'));
    await vi.waitFor(() => expect(statusEl.textContent).toContain('Session saved'));

    // markSaved resolved the dirty flag: close runs without the discard dialog.
    closeBtn.click();
    await vi.waitFor(() => expect(sessionSection.hidden).toBe(true));
    expect(svc.archiveClose).toHaveBeenCalledWith('session_save.db');
    expect(showConfirmDialog).not.toHaveBeenCalled();
  });

  it('parity: restore preview stages the picked file and create applies it to the main db', async () => {
    const svc = await import('../../../dashboardSqliteService.js');
    vi.mocked(svc.archivePrepareIncoming).mockResolvedValue({ data: 'archive_incoming_apply.db' } as never);
    vi.mocked(svc.archiveRestorePreview).mockResolvedValue({ data: { recordCount: 3, cutoffDate: '2026-09-01' } } as never);
    vi.mocked(svc.archiveOpen).mockResolvedValue({ data: {} } as never);
    vi.mocked(svc.archiveQuery).mockResolvedValue({ data: { rows: [], total: 0 } } as never);
    vi.mocked(svc.archiveRestore).mockResolvedValue({ data: { restored: 2, restoredDeleted: 1, skipped: 0, skippedInvalid: 0 } } as never);
    await stubOpfs();

    const { container, statusEl } = await mountFullPanel();
    const fileInput = container.querySelector('#archive-restore-file') as HTMLInputElement;
    const restoreBtn = container.querySelector('#archive-restore-btn') as HTMLButtonElement;
    const previewSummary = container.querySelector('#archive-restore-preview-summary') as HTMLElement;

    Object.defineProperty(fileInput, 'files', { value: [new File(['sqlite-bytes'], 'backup.db')], configurable: true });
    fileInput.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(restoreBtn.hidden).toBe(false));
    expect(previewSummary.hidden).toBe(false);
    expect(previewSummary.textContent).toContain('3 records from 2026-09-01');

    restoreBtn.click();
    await vi.waitFor(() => expect(svc.archiveRestore).toHaveBeenCalledWith('archive_incoming_apply.db'));
    await vi.waitFor(() => expect(statusEl.textContent).toContain('Restore complete'));
    expect(restoreBtn.hidden).toBe(true);
    expect(fileInput.value).toBe('');
  });

  it('parity: edit modal saves a new title and keeps focus on the re-rendered row', async () => {
    const svc = await import('../../../dashboardSqliteService.js');
    vi.mocked(archiveStatus).mockResolvedValue({ data: { open: true, stagingName: 'session_edit.db', dirty: false } } as never);
    vi.mocked(svc.archiveQuery).mockResolvedValue({
      data: { rows: [{ id: 7, created_at: 1727000000000, title: 'Old Title', url: 'https://a.example.com' }], total: 1 },
    } as never);
    vi.mocked(svc.archiveUpdate).mockResolvedValue({ data: {} } as never);

    const { container } = await mountFullPanel();
    const list = container.querySelector('#archive-session-list') as HTMLElement;
    await vi.waitFor(() => expect(list.querySelectorAll('.archive-session-row').length).toBe(1));
    const rowBtn = container.querySelector<HTMLElement>('.archive-session-row[data-row-id="7"] button') as HTMLElement;
    rowBtn.click();
    // Modal open focuses its input — the open sequence's exclusive effect.
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('archive-edit-input'));
    expect(document.querySelector('.archive-modal[role="dialog"]')).not.toBeNull();
    const input = document.querySelector('#archive-edit-input') as HTMLInputElement;
    expect(input.value).toBe('Old Title');

    input.value = 'New Title';
    (document.querySelector('.archive-modal-save') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(svc.archiveUpdate).toHaveBeenCalledWith('session_edit.db', 7, { title: 'New Title' }));
    await vi.waitFor(() => expect(document.querySelector('.archive-modal-overlay')).toBeNull());
    await vi.waitFor(() => {
      const focusedRow = (document.activeElement as HTMLElement | null)?.closest('.archive-session-row');
      expect(focusedRow?.getAttribute('data-row-id')).toBe('7');
    });
  });

  it('parity: edit modal rejects an empty title without calling the service', async () => {
    const svc = await import('../../../dashboardSqliteService.js');
    vi.mocked(archiveStatus).mockResolvedValue({ data: { open: true, stagingName: 'session_edit2.db', dirty: false } } as never);
    vi.mocked(svc.archiveQuery).mockResolvedValue({
      data: { rows: [{ id: 3, created_at: 1727000000000, title: 'Keep', url: 'https://a.example.com' }], total: 1 },
    } as never);

    const { container } = await mountFullPanel();
    const list = container.querySelector('#archive-session-list') as HTMLElement;
    await vi.waitFor(() => expect(list.querySelectorAll('.archive-session-row').length).toBe(1));
    const rowBtn = container.querySelector<HTMLElement>('.archive-session-row[data-row-id="3"] button') as HTMLElement;
    rowBtn.click();
    // Modal open focuses its input — the open sequence's exclusive effect.
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('archive-edit-input'));
    expect(document.querySelector('.archive-modal[role="dialog"]')).not.toBeNull();

    const input = document.querySelector('#archive-edit-input') as HTMLInputElement;
    input.value = '   ';
    (document.querySelector('.archive-modal-save') as HTMLButtonElement).click();

    const errorEl = document.querySelector('.archive-modal-error') as HTMLElement;
    await vi.waitFor(() => expect(errorEl.hidden).toBe(false));
    expect(errorEl.textContent).toContain('Title is required');
    expect(svc.archiveUpdate).not.toHaveBeenCalled();
    expect(document.querySelector('.archive-modal-overlay')).not.toBeNull();
  });

  it('unit: each lifecycle factory mounts independently with only its own deps', async () => {
    const { mountArchiveLifecycle } = await import('../archiveLifecyclePanel.js');
    const { mountArchiveSessionViewer } = await import('../archiveSessionPanel.js');
    const { mountArchiveRestore } = await import('../archiveRestorePanel.js');

    const section = document.createElement('section');
    section.innerHTML = `<input type="date" id="seam-date"><button id="seam-preview"></button>`;
    document.body.appendChild(section);
    const busy = { controls: [] as HTMLButtonElement[], setAriaBusy: (): void => {}, statusEl: null as HTMLElement | null };
    const staging = { lastStagingName: null as string | null, lastFileName: '' };

    expect(() => mountArchiveLifecycle({
      dateInput: section.querySelector('#seam-date'),
      includeDeletedInput: null,
      previewBtn: section.querySelector('#seam-preview'),
      createBtn: null,
      downloadBtn: null,
      cleanupBtn: null,
      purgeBtn: null,
      summaryEl: null,
      busy,
      staging,
    })).not.toThrow();

    const session = mountArchiveSessionViewer({
      container: section,
      sessionSection: null,
      sessionQueryInput: null,
      sessionListEl: null,
      sessionSaveBtn: null,
      sessionCloseBtn: null,
      busy,
    });
    expect(typeof session.renderList).toBe('function');
    expect(session.store.getState()).toBe('idle');

    expect(() => mountArchiveRestore({
      restoreFileInput: null,
      restorePreviewEl: null,
      restoreBtn: null,
      sessionSection: null,
      session,
      busy,
      staging,
    })).not.toThrow();
  });
});
