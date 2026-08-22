// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDiagnosticActions } from '../diagnosticsActions.js';
import type { DiagnosticActionElements } from '../diagnosticsActions.js';

vi.mock('../../../../utils/i18n.js', () => ({
  getMessage: vi.fn((_key: string, fallback?: string) => fallback ?? ''),
}));

vi.mock('../../../dashboardSqliteService.js', () => ({
  runOpfsSpike: vi.fn(),
  migrateLogs: vi.fn(),
  backfillMetadata: vi.fn(),
  cleanupLegacyStorage: vi.fn(),
}));

vi.mock('../../../utils/confirmDialog.js', () => ({
  showConfirmDialog: vi.fn(),
}));

vi.mock('../../../builtInAiDiagnosticsService.js', () => ({
  startBuiltInAiDownload: vi.fn(),
}));

import { migrateLogs, cleanupLegacyStorage } from '../../../dashboardSqliteService.js';
import { showConfirmDialog } from '../../../utils/confirmDialog.js';

function makeElements(): DiagnosticActionElements {
  const el = <T extends HTMLElement>(_id: string, tag = 'div'): T =>
    document.createElement(tag) as T;
  return {
    testObsidianBtn: el<HTMLButtonElement>('a', 'button'),
    testAiBtn: el<HTMLButtonElement>('b', 'button'),
    testSqliteBtn: el<HTMLButtonElement>('c', 'button'),
    opfsSpikeBtn: el<HTMLButtonElement>('d', 'button'),
    migrateBtn: el<HTMLButtonElement>('e', 'button'),
    backfillBtn: el<HTMLButtonElement>('f', 'button'),
    cleanupBtn: el<HTMLButtonElement>('g', 'button'),
    builtInAiDownloadBtn: el<HTMLButtonElement>('h', 'button'),
    connectionResult: el('r1'),
    sqliteResult: el('r2'),
    opfsSpikeResult: el('r3'),
    migrateResult: el('r4'),
    backfillResult: el('r5'),
    cleanupResult: el('r6'),
    builtInAiStats: el('r7'),
    builtInAiDownloadResult: el('r8'),
  };
}

describe('diagnosticsActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global as unknown as Record<string, unknown>).chrome = {
      runtime: { sendMessage: vi.fn() },
    } as unknown as typeof chrome;
  });

  it('does not run cleanup when confirm dialog is cancelled', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue(false);
    const els = makeElements();
    createDiagnosticActions(els, { onBuiltInAiDownloaded: vi.fn() });

    els.cleanupBtn!.click();
    await vi.waitFor(() => expect(showConfirmDialog).toHaveBeenCalled());

    expect(cleanupLegacyStorage).not.toHaveBeenCalled();
    expect(els.cleanupBtn!.disabled).toBe(false);
  });

  it('runs cleanup after confirmation and reports freed bytes', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue(true);
    vi.mocked(cleanupLegacyStorage).mockResolvedValue({
      data: { removed: ['savedUrlsWithTimestamps'], totalBytes: 12345 },
    } as any);
    const els = makeElements();
    createDiagnosticActions(els, { onBuiltInAiDownloaded: vi.fn() });

    els.cleanupBtn!.click();
    await vi.waitFor(() => expect(els.cleanupResult!.textContent).toContain('12345'));
    expect(cleanupLegacyStorage).toHaveBeenCalledTimes(1);
  });

  it('runs migration after confirmation and reports counts', async () => {
    vi.mocked(showConfirmDialog).mockResolvedValue(true);
    vi.mocked(migrateLogs).mockResolvedValue({
      data: { read: 10, inserted: 8, count: 10 },
    } as any);
    const els = makeElements();
    createDiagnosticActions(els, { onBuiltInAiDownloaded: vi.fn() });

    els.migrateBtn!.click();
    await vi.waitFor(() => expect(els.migrateResult!.textContent).toContain('inserted=8'));
  });

  it('shows obsidian test result from sendMessage response', async () => {
    vi.mocked(globalThis.chrome.runtime.sendMessage).mockResolvedValue({
      obsidian: { success: true, message: 'Connected to Obsidian' },
    });
    const els = makeElements();
    createDiagnosticActions(els, { onBuiltInAiDownloaded: vi.fn() });

    els.testObsidianBtn!.click();
    await vi.waitFor(() => expect(els.connectionResult!.textContent).toContain('Obsidian'));
    expect(els.testObsidianBtn!.disabled).toBe(false);
  });

  it('calls onBuiltInAiDownloaded hook after download completes', async () => {
    const startBuiltInAiDownloadModule = await import('../../../builtInAiDiagnosticsService.js');
    vi.mocked(startBuiltInAiDownloadModule.startBuiltInAiDownload).mockImplementation(
      async (onProgress?: (percent: number) => void) => {
        onProgress?.(50);
        return { status: 'available' } as any;
      },
    );
    const els = makeElements();
    const hook = vi.fn();
    createDiagnosticActions(els, { onBuiltInAiDownloaded: hook });

    els.builtInAiDownloadBtn!.click();
    await vi.waitFor(() => expect(hook).toHaveBeenCalledWith(expect.objectContaining({ status: 'available' })));
  });
});
