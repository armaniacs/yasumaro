// @vitest-environment jsdom
/**
 * exportArchiveIsolation.test.ts
 * PBI 2026-10-02-06: codifies the intended concurrency shape at the panel
 * wiring level. Export buttons each pass a single-button scope
 * (exportLogsPanel.ts:23-71) so concurrent JSON/MD/CSV/DB exports stay
 * isolated; archive buttons all pass the shared group `controls`
 * (archivePanel.ts:56) so archive ops are mutually excluded while one runs.
 * Production modules are used as-is; only services and status rendering are
 * mocked for determinism.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForMock } from '../../../../../testDir/waitPolicy.js';

vi.mock('../../../exportLogsService.js', () => ({
  exportJson: vi.fn(),
  exportCsv: vi.fn(),
  exportMarkdown: vi.fn(),
  exportDb: vi.fn(),
  downloadText: vi.fn(),
  downloadBlob: vi.fn(),
}));

vi.mock('../../../dashboardSqliteService.js', () => ({
  queryAuditLogs: vi.fn(),
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
  isServiceError: (result: object): boolean => 'error' in result,
}));

vi.mock('../../../utils/auditLogTsv.js', () => ({
  toTsvString: vi.fn(() => ''),
}));

vi.mock('../../../../utils/ui/settingsUiHelper.js', () => ({
  showStatus: vi.fn(),
}));

import {
  exportJson,
  exportCsv,
  exportMarkdown,
  exportDb,
  downloadBlob,
  downloadText,
} from '../../../exportLogsService.js';
import { archivePreview, archiveCreate, archiveStatus } from '../../../dashboardSqliteService.js';
import { showStatus } from '../../../../utils/ui/settingsUiHelper.js';
import { createExportLogsPanel } from '../exportLogsPanel.js';
import { createArchivePanel } from '../archivePanel.js';

function mountExportPanel(): {
  container: HTMLElement;
  jsonBtn: HTMLButtonElement;
  mdBtn: HTMLButtonElement;
  csvBtn: HTMLButtonElement;
  dbBtn: HTMLButtonElement;
} {
  const container = document.createElement('section');
  container.innerHTML = `
    <button id="export-json-btn">JSON</button>
    <button id="export-markdown-btn">Markdown</button>
    <button id="export-csv-btn">CSV</button>
    <button id="export-db-btn">DB</button>
    <div id="export-status"></div>
  `;
  document.body.appendChild(container);
  const q = (sel: string): HTMLButtonElement => container.querySelector(sel) as HTMLButtonElement;
  return {
    container,
    jsonBtn: q('#export-json-btn'),
    mdBtn: q('#export-markdown-btn'),
    csvBtn: q('#export-csv-btn'),
    dbBtn: q('#export-db-btn'),
  };
}

function mountArchivePanel(): {
  container: HTMLElement;
  controls: HTMLButtonElement[];
  previewBtn: HTMLButtonElement;
  createBtn: HTMLButtonElement;
} {
  const container = document.createElement('section');
  container.innerHTML = `
    <input type="date" id="archive-date">
    <input type="checkbox" id="archive-include-deleted">
    <button id="archive-preview-btn">Preview</button>
    <button id="archive-create-btn">Create</button>
    <button id="archive-download-btn" hidden>Download</button>
    <button id="archive-cleanup-btn" hidden>Cleanup</button>
    <button id="archive-purge-btn" hidden>Purge</button>
    <button id="archive-restore-btn" hidden>Restore</button>
    <input id="archive-session-query">
    <button id="archive-session-query-btn">Query</button>
    <button id="archive-session-save-btn">Save</button>
    <button id="archive-session-close-btn">Close</button>
    <div id="archive-preview-summary" hidden></div>
    <div id="archive-status"></div>
    <div id="archive-session-list"></div>
    <section id="archive-session-section" hidden></section>
  `;
  document.body.appendChild(container);
  const q = (sel: string): HTMLButtonElement => container.querySelector(sel) as HTMLButtonElement;
  const previewBtn = q('#archive-preview-btn');
  const createBtn = q('#archive-create-btn');
  return {
    container,
    controls: [
      previewBtn,
      createBtn,
      q('#archive-download-btn'),
      q('#archive-cleanup-btn'),
      q('#archive-purge-btn'),
      q('#archive-restore-btn'),
      q('#archive-session-query-btn'),
      q('#archive-session-save-btn'),
      q('#archive-session-close-btn'),
    ],
    previewBtn,
    createBtn,
  };
}

describe('exportArchiveIsolation', () => {
  describe('exportLogsPanel single-button scope', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('disables only the triggering export button while JSON export is pending', async () => {
      const jsonGate = Promise.withResolvers<Blob>();
      vi.mocked(exportJson).mockReturnValueOnce(jsonGate.promise);
      const { jsonBtn, mdBtn, csvBtn, dbBtn } = mountExportPanel();
      await createExportLogsPanel().mount(
        document.body.querySelector('section') as HTMLElement,
      );

      jsonBtn.click();
      await waitForMock(() => expect(jsonBtn.disabled).toBe(true));
      expect(mdBtn.disabled).toBe(false);
      expect(csvBtn.disabled).toBe(false);
      expect(dbBtn.disabled).toBe(false);

      jsonGate.resolve(new Blob(['{}'], { type: 'application/json' }));
      await waitForMock(() => expect(downloadBlob).toHaveBeenCalled());
      await waitForMock(() => expect(jsonBtn.disabled).toBe(false));
      expect(vi.mocked(showStatus).mock.calls.at(-1)?.[1]).toContain('JSON export completed');
    });

    it('keeps concurrent JSON and Markdown exports attributed without crossover', async () => {
      const jsonGate = Promise.withResolvers<Blob>();
      const mdGate = Promise.withResolvers<string>();
      vi.mocked(exportJson).mockReturnValueOnce(jsonGate.promise);
      vi.mocked(exportMarkdown).mockReturnValueOnce(mdGate.promise);
      const { jsonBtn, mdBtn, csvBtn, dbBtn } = mountExportPanel();
      await createExportLogsPanel().mount(
        document.body.querySelector('section') as HTMLElement,
      );

      jsonBtn.click();
      await waitForMock(() => expect(jsonBtn.disabled).toBe(true));
      mdBtn.click();
      await waitForMock(() => {
        expect(jsonBtn.disabled).toBe(true);
        expect(mdBtn.disabled).toBe(true);
      });
      expect(csvBtn.disabled).toBe(false);
      expect(dbBtn.disabled).toBe(false);

      // Reverse-order settle: each download must carry its own payload.
      mdGate.resolve('# md-body');
      await waitForMock(() => expect(downloadText).toHaveBeenCalled());
      expect(vi.mocked(downloadText).mock.calls[0]?.[0]).toBe('# md-body');
      await waitForMock(() => expect(mdBtn.disabled).toBe(false));
      expect(jsonBtn.disabled).toBe(true);

      jsonGate.resolve(new Blob(['{"rows":[]}'], { type: 'application/json' }));
      await waitForMock(() => expect(downloadBlob).toHaveBeenCalled());
      await waitForMock(() => expect(jsonBtn.disabled).toBe(false));
    });

    it('isolates CSV and DB exports to their own buttons', async () => {
      const csvGate = Promise.withResolvers<Blob>();
      const dbGate = Promise.withResolvers<Blob>();
      vi.mocked(exportCsv).mockReturnValueOnce(csvGate.promise);
      vi.mocked(exportDb).mockReturnValueOnce(dbGate.promise);
      const { jsonBtn, mdBtn, csvBtn, dbBtn } = mountExportPanel();
      await createExportLogsPanel().mount(
        document.body.querySelector('section') as HTMLElement,
      );

      csvBtn.click();
      await waitForMock(() => expect(csvBtn.disabled).toBe(true));
      dbBtn.click();
      await waitForMock(() => {
        expect(csvBtn.disabled).toBe(true);
        expect(dbBtn.disabled).toBe(true);
      });
      expect(jsonBtn.disabled).toBe(false);
      expect(mdBtn.disabled).toBe(false);

      dbGate.resolve(new Blob(['db-bytes'], { type: 'application/x-sqlite3' }));
      csvGate.resolve(new Blob(['csv-bytes'], { type: 'text/csv' }));
      await waitForMock(() => expect(downloadBlob).toHaveBeenCalledTimes(2));
      await waitForMock(() => {
        expect(csvBtn.disabled).toBe(false);
        expect(dbBtn.disabled).toBe(false);
      });
    });
  });

  describe('archivePanel group controls', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(archiveStatus).mockResolvedValue({
        data: { open: false, stagingName: null, dirty: false },
      } as never);
      (globalThis as { chrome?: unknown }).chrome = {
        runtime: { getManifest: () => ({ version: '6.7.113' }) },
        i18n: { getMessage: (key: string) => key },
      };
    });

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('disables the whole archive control group while preview runs', async () => {
      const previewGate = Promise.withResolvers<{ data: { total: number } }>();
      vi.mocked(archivePreview).mockReturnValueOnce(previewGate.promise as never);
      const { container, controls, previewBtn } = mountArchivePanel();
      await createArchivePanel().mount(container);

      previewBtn.click();
      await waitForMock(() => {
        for (const button of controls) expect(button.disabled).toBe(true);
      });
      expect(container.querySelector('#archive-status')?.getAttribute('aria-busy')).toBe('true');

      previewGate.resolve({ data: { total: 4 } } as never);
      await waitForMock(() => {
        for (const button of controls) expect(button.disabled).toBe(false);
      });
      expect(container.querySelector('#archive-status')?.getAttribute('aria-busy')).toBe('false');
    });

    it('restores the whole group after create settles', async () => {
      const createGate = Promise.withResolvers<{
        data: { stagingName: string; recordCount: number };
      }>();
      vi.mocked(archiveCreate).mockReturnValueOnce(createGate.promise as never);
      const { container, controls, createBtn } = mountArchivePanel();
      await createArchivePanel().mount(container);

      createBtn.click();
      await waitForMock(() => {
        for (const button of controls) expect(button.disabled).toBe(true);
      });

      createGate.resolve({ data: { stagingName: 'staging.db', recordCount: 5 } } as never);
      await waitForMock(() => {
        for (const button of controls) expect(button.disabled).toBe(false);
      });
      expect(vi.mocked(showStatus)).toHaveBeenCalled();
    });

    it('restores the whole group after a service failure so exclusion cannot deadlock', async () => {
      vi.mocked(archivePreview).mockResolvedValueOnce({ error: 'db locked' } as never);
      const { container, controls, previewBtn } = mountArchivePanel();
      await createArchivePanel().mount(container);

      previewBtn.click();
      await waitForMock(() =>
        expect(vi.mocked(showStatus)).toHaveBeenCalledWith(
          expect.anything(),
          expect.stringContaining('db locked'),
          'error',
        ),
      );
      for (const button of controls) expect(button.disabled).toBe(false);
      expect(container.querySelector('#archive-status')?.getAttribute('aria-busy')).toBe('false');
    });
  });
});
