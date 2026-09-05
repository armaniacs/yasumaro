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
  resyncLegacyStorage: vi.fn(),
  cleanupLegacyStorage: vi.fn(),
  getSqliteStatus: vi.fn(),
}));

vi.mock('../../../utils/confirmDialog.js', () => ({
  showConfirmDialog: vi.fn(),
}));

vi.mock('../../../builtInAiDiagnosticsService.js', () => ({
  startBuiltInAiDownload: vi.fn(),
}));

import { runOpfsSpike, migrateLogs, backfillMetadata, resyncLegacyStorage, cleanupLegacyStorage, getSqliteStatus } from '../../../dashboardSqliteService.js';
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
    resyncBtn: el<HTMLButtonElement>('f2', 'button'),
    cleanupBtn: el<HTMLButtonElement>('g', 'button'),
    builtInAiDownloadBtn: el<HTMLButtonElement>('h', 'button'),
    connectionResult: el('r1'),
    sqliteResult: el('r2'),
    opfsSpikeResult: el('r3'),
    migrateResult: el('r4'),
    backfillResult: el('r5'),
    resyncResult: el('r5b'),
    cleanupResult: el('r6'),
    builtInAiStats: el('r7'),
    builtInAiDownloadResult: el('r8'),
  };
}

describe('diagnosticsActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global as unknown as Record<string, unknown>).chrome = {
      runtime: {
        sendMessage: vi.fn(),
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        id: 'test-extension-id',
      },
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

  it('TEST_AI single provider shows success message and class', async () => {
    vi.mocked(globalThis.chrome.runtime.sendMessage).mockResolvedValue({
      ai: { success: true, message: 'ok' },
    });
    const els = makeElements();
    createDiagnosticActions(els, { onBuiltInAiDownloaded: vi.fn() });

    els.testAiBtn!.click();
    await vi.waitFor(() => {
      expect(els.connectionResult!.textContent).toContain('AI: ✓ ok');
      expect(els.connectionResult!.className).toContain('diag-success');
    });
    expect(els.testAiBtn!.disabled).toBe(false);
  });

  it('TEST_AI multi-provider renders header and provider rows using real formatters', async () => {
    vi.mocked(globalThis.chrome.runtime.sendMessage).mockResolvedValue({
      ai: {
        success: false,
        message: 'failed',
        providers: [
          { provider: 'gemini', model: 'm', success: true, message: 'a', elapsedMs: 5 },
          { provider: 'openai', model: null, success: false, message: 'b', elapsedMs: 7 },
        ],
      },
    });
    const els = makeElements();
    createDiagnosticActions(els, { onBuiltInAiDownloaded: vi.fn() });

    els.testAiBtn!.click();
    await vi.waitFor(() => {
      const result = els.connectionResult!;
      expect(result.textContent).toContain('AI:');
      const children = Array.from(result.children) as HTMLElement[];
      expect(children.length).toBeGreaterThanOrEqual(3);
      expect(children[0].textContent).toContain('AI:');
      expect(children[0].className).toContain('diag-bold');
      expect(children[1].textContent).toContain('Google Gemini (m): a (5ms)');
      expect(children[2].textContent).toContain('OpenAI Compatible: b (7ms)');
    });
    expect(els.testAiBtn!.disabled).toBe(false);
  });

  it('TEST_SQLITE success with initialized and fts5', async () => {
    // PBI 11: status goes through getSqliteStatus(), not an inline sendMessage.
    vi.mocked(getSqliteStatus).mockResolvedValue({
      initialized: true,
      path: '/db.sqlite3',
      fallback: false,
      fts5: true,
    });
    const els = makeElements();
    createDiagnosticActions(els, { onBuiltInAiDownloaded: vi.fn() });

    els.testSqliteBtn!.click();
    await vi.waitFor(() => {
      expect(els.sqliteResult!.textContent).toContain('FTS5 ✓');
      expect(els.sqliteResult!.style.color).toBeTruthy();
    });
    expect(els.testSqliteBtn!.disabled).toBe(false);
  });

  it('TEST_SQLITE init failure shows error message', async () => {
    // PBI 11: status goes through getSqliteStatus(), not an inline sendMessage.
    vi.mocked(getSqliteStatus).mockResolvedValue({
      initialized: false,
      path: '',
      fallback: false,
      fts5: false,
      initError: 'boom',
    });
    const els = makeElements();
    createDiagnosticActions(els, { onBuiltInAiDownloaded: vi.fn() });

    els.testSqliteBtn!.click();
    await vi.waitFor(() => {
      expect(els.sqliteResult!.textContent).toContain('boom');
    });
    expect(els.testSqliteBtn!.disabled).toBe(false);
  });

  it('OPFS spike displays strategy and duration', async () => {
    vi.mocked(runOpfsSpike).mockResolvedValue({
      data: {
        passed: true,
        strategy: 'opfs-sync-worker',
        durationMs: 12,
        steps: [{ ok: true, name: 's1', detail: 'd' }],
      },
    } as any);
    const els = makeElements();
    createDiagnosticActions(els, { onBuiltInAiDownloaded: vi.fn() });

    els.opfsSpikeBtn!.click();
    await vi.waitFor(() => {
      expect(els.opfsSpikeResult!.textContent).toContain('strategy=opfs-sync-worker');
      expect(els.opfsSpikeResult!.textContent).toContain('(12ms)');
    });
    expect(els.opfsSpikeBtn!.disabled).toBe(false);
  });

  it('backfill reports updated and total counts', async () => {
    vi.mocked(backfillMetadata).mockResolvedValue({
      data: { updated: 3, total: 9 },
    } as any);
    const els = makeElements();
    createDiagnosticActions(els, { onBuiltInAiDownloaded: vi.fn() });

    els.backfillBtn!.click();
    await vi.waitFor(() => {
      expect(els.backfillResult!.textContent).toContain('updated=3/9');
    });
    expect(els.backfillBtn!.disabled).toBe(false);
  });

  it('resync reports written/examined/skipped/total counts', async () => {
    vi.mocked(resyncLegacyStorage).mockResolvedValue({
      data: { examined: 8, written: 7, skipped: 1, total: 8 },
    } as any);
    const els = makeElements();
    createDiagnosticActions(els, { onBuiltInAiDownloaded: vi.fn() });

    els.resyncBtn!.click();
    await vi.waitFor(() => {
      expect(els.resyncResult!.textContent).toContain('written=7/8');
      expect(els.resyncResult!.textContent).toContain('skipped=1');
    });
    expect(els.resyncBtn!.disabled).toBe(false);
  });

  it('resync surfaces the failure reason', async () => {
    vi.mocked(resyncLegacyStorage).mockResolvedValue({ error: 'Resync not available' } as any);
    const els = makeElements();
    createDiagnosticActions(els, { onBuiltInAiDownloaded: vi.fn() });

    els.resyncBtn!.click();
    await vi.waitFor(() => {
      expect(els.resyncResult!.textContent).toContain('Resync not available');
    });
    expect(els.resyncBtn!.disabled).toBe(false);
  });
});
