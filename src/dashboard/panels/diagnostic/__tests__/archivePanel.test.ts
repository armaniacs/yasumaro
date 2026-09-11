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
}));

import { createArchivePanel } from '../archivePanel.js';
import { archivePreview, archiveCreate, archiveStatus } from '../../../dashboardSqliteService.js';

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
            archivePreviewSummary: 'To archive: {total} (starred: {starred}). Deleted: {deleted}',
            archiveCreatedSummary: 'Archive created: {count} exported.',
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
});
