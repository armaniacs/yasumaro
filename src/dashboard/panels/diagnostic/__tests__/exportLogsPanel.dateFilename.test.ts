// @vitest-environment jsdom
/**
 * exportLogsPanel.dateFilename.test.ts
 * PBI 2026-10-21-09: the diagnostic export filenames carry the LOCAL calendar
 * date (formatLocalDateString SSOT), not the UTC date the old
 * toISOString().split('T')[0] emitted. A JST-morning export (00:00-08:59) used
 * to be named with the previous day.
 *
 * The clock is faked at local 00:30 with a fixture built from local date
 * components, so the pin holds in any timezone (localDate.test.ts pattern).
 * waitForMock drives the async panel flow; no real-time waits.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTimerClock, waitForMock } from '../../../../../testDir/waitPolicy.js';

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
  isServiceError: (result: object): boolean => 'error' in result,
}));

vi.mock('../../../../utils/ui/settingsUiHelper.js', () => ({
  showStatus: vi.fn(),
}));

import { downloadBlob, downloadText, exportJson } from '../../../exportLogsService.js';
import { queryAuditLogs } from '../../../dashboardSqliteService.js';
import { createExportLogsPanel } from '../exportLogsPanel.js';

function mountExportPanel(): { jsonBtn: HTMLButtonElement; auditBtn: HTMLButtonElement } {
  const container = document.createElement('section');
  container.innerHTML = `
    <button id="export-json-btn">JSON</button>
    <button id="export-markdown-btn">Markdown</button>
    <button id="export-csv-btn">CSV</button>
    <button id="export-db-btn">DB</button>
    <div id="export-status"></div>
    <button id="auditLogDownloadTsv">TSV</button>
    <div id="auditLogStatus"></div>
  `;
  document.body.appendChild(container);
  const q = (sel: string): HTMLButtonElement => container.querySelector(sel) as HTMLButtonElement;
  return { jsonBtn: q('#export-json-btn'), auditBtn: q('#auditLogDownloadTsv') };
}

describe('exportLogsPanel date filenames (PBI 2026-10-21-09)', () => {
  beforeEach(() => {
    useTimerClock();
    // Local 00:30 on Oct 21: in any positive-offset zone (JST) the UTC date is
    // still Oct 20, so the old UTC filename pinned "yesterday" here. The
    // fixture is built from local components, so the pin is TZ-independent.
    vi.setSystemTime(new Date(2026, 9, 21, 0, 30, 0).getTime());
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('names the JSON export with the local date at a JST-morning clock', async () => {
    vi.mocked(exportJson).mockResolvedValue(new Blob(['{}'], { type: 'application/json' }));
    const { jsonBtn } = mountExportPanel();
    await createExportLogsPanel().mount(document.body.querySelector('section') as HTMLElement);

    jsonBtn.click();
    await waitForMock(() => expect(downloadBlob).toHaveBeenCalled());

    expect(vi.mocked(downloadBlob).mock.calls[0]?.[1]).toBe('yasumaro_export_2026-10-21.json');
  });

  it('names the audit TSV export with the local date at a JST-morning clock', async () => {
    vi.mocked(queryAuditLogs).mockResolvedValue({
      data: {
        rows: [{ id: 1, provider: 'gemini', url: 'https://example.com', created_at: new Date(2026, 9, 20, 22, 0, 0).getTime() }],
        total: 1,
      },
    } as never);
    const { auditBtn } = mountExportPanel();
    await createExportLogsPanel().mount(document.body.querySelector('section') as HTMLElement);

    auditBtn.click();
    await waitForMock(() => expect(downloadText).toHaveBeenCalled());

    expect(vi.mocked(downloadText).mock.calls[0]?.[1]).toBe('yasumaro-audit-log-2026-10-21.tsv');
    // The created_at column itself is the record's own local date (see
    // auditLogTsv.test.ts); only the filename is pinned here.
    expect(vi.mocked(downloadText).mock.calls[0]?.[2]).toBe('text/tab-separated-values');
  });
});
