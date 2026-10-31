// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- hoisted mocks (mirrors recordOrchestrator.test.ts harness) ---
const mockGetAll = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockCheckPageStatus = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockStartAutoCloseTimer = vi.hoisted(() => vi.fn());
const mockGetCurrentTab = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: 1, url: 'https://example.com', title: 'Example' }),
);
const mockIsRecordable = vi.hoisted(() => vi.fn().mockReturnValue(true));
const mockFormatSuccessMessage = vi.hoisted(() => vi.fn().mockReturnValue('Success message'));
const mockGetMessage = vi.hoisted(() => vi.fn((key: string) => key));
const mockGetSavedUrlEntries = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockUpdateCleansingStatus = vi.hoisted(() => vi.fn());
const mockUpdateTrustStatus = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockShowSpinner = vi.hoisted(() => vi.fn());
const mockHideSpinner = vi.hoisted(() => vi.fn());
const mockShowError = vi.hoisted(() => vi.fn());

vi.mock('../statusChecker.js', () => ({
  checkPageStatus: mockCheckPageStatus,
}));

vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    SettingsRepository: class { getAll = mockGetAll; setAll = vi.fn(); getMany = vi.fn(); },
  };
});
vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, StorageKeys: { ...(actual.StorageKeys as Record<string, unknown>), PII_CONFIRMATION_UI: 'pii_confirmation_ui' } };
});
vi.mock('../autoClose.js', () => ({
  startAutoCloseTimer: mockStartAutoCloseTimer,
}));
vi.mock('../tabUtils.js', () => ({
  getCurrentTab: mockGetCurrentTab,
  isRecordable: mockIsRecordable,
}));
vi.mock('../../utils/recordingGateTable.js', () => ({
  isRecordableTab: mockIsRecordable,
}));
vi.mock('../errorUtils.js', () => ({
  formatSuccessMessage: mockFormatSuccessMessage,
  showError: mockShowError,
}));
vi.mock('../spinner.js', () => ({
  showSpinner: mockShowSpinner,
  hideSpinner: mockHideSpinner,
}));
vi.mock('../../utils/i18n.js', async () => {
  const { mockGetMessage: i18nMock } = await import('../../../testDir/i18nMock.js');
  return i18nMock(mockGetMessage);
});
vi.mock('../../utils/storageUrls.js', () => ({
  getSavedUrlEntries: mockGetSavedUrlEntries,
}));
vi.mock('../../utils/clipboard.js', () => ({
  copyTextToClipboard: vi.fn().mockResolvedValue(undefined),
}));
// markdownFormatter stays REAL: utils/selectionText.normalizeSelectionText
// reuses its normalizeSingleLine, so a mock here would blank the selection
// normalization this spec pins.
vi.mock('../statusPanel.js', () => ({
  updateCleansingStatus: mockUpdateCleansingStatus,
  updateTrustStatus: mockUpdateTrustStatus,
}));

import { RecordSession } from '../recordCurrentPage/recordSession.js';
import { SELECTION_MAX_CHARS } from '../../utils/selectionText.js';

function setupBaseDOM(): void {
  document.body.innerHTML = `
    <img id="favicon" src="">
    <div id="pageTitle"></div>
    <div id="pageUrl"></div>
    <button id="recordBtn"></button>
    <div id="mainStatus"></div>
    <div id="tagResultPanel" class="hidden"></div>
    <div id="statusCleansingContent"></div>
    <div id="statusTrustContent"></div>
  `;
}

interface Harness {
  session: RecordSession;
  tabContentFetcher: { fetch: ReturnType<typeof vi.fn> };
  previewFlow: { run: ReturnType<typeof vi.fn> };
  selectionReader: ReturnType<typeof vi.fn>;
}

function createSession(options?: {
  selection?: string | null | Error;
}): Harness {
  const tabContentFetcher = {
    fetch: vi.fn().mockResolvedValue({ content: 'page content' }),
  };
  const previewFlow = {
    run: vi.fn().mockResolvedValue({
      success: true,
      result: { success: true, summary: 'sum', tags: ['a'], aiDuration: 1, obsidianDuration: 1, aiProvider: 'openai' },
    }),
  };
  const selectionReader = vi.fn(async () => {
    const sel = options?.selection;
    if (sel instanceof Error) throw sel;
    if (sel === undefined) return null;
    return { selection: sel ?? '' };
  });
  const session = new RecordSession(
    tabContentFetcher as never,
    previewFlow as never,
    selectionReader as never,
  );
  return { session, tabContentFetcher, previewFlow, selectionReader };
}

beforeEach(() => {
  setupBaseDOM();
  vi.clearAllMocks();
  mockGetAll.mockResolvedValue({});
  mockCheckPageStatus.mockResolvedValue(null);
  mockGetCurrentTab.mockResolvedValue({ id: 1, url: 'https://example.com', title: 'Example' } as never);
  mockIsRecordable.mockReturnValue(true);
  mockFormatSuccessMessage.mockReturnValue('Success message');
  mockGetMessage.mockImplementation((key: string) => key);
  mockGetSavedUrlEntries.mockResolvedValue([]);
  mockUpdateCleansingStatus.mockClear();
  mockUpdateTrustStatus.mockResolvedValue(undefined);
  (chrome.runtime.getURL as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (path: string) => `chrome-extension://test-id${path}`,
  );
  (chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('RecordSession selection capture (PBI 2026-10-31-03)', () => {
  it('records only the selection when one exists (page fetch skipped)', async () => {
    const h = createSession({ selection: 'selected paragraph' });
    await h.session.recordCurrentPage();

    expect(h.previewFlow.run).toHaveBeenCalledTimes(1);
    const options = h.previewFlow.run.mock.calls[0]![0] as Record<string, unknown>;
    expect(options.content).toBe('selected paragraph');
    expect(options.contentOrigin).toBe('selection');
    expect(h.tabContentFetcher.fetch).not.toHaveBeenCalled();
    // Extraction stats come from the page fetch — skipped on the selection path.
    expect(mockUpdateCleansingStatus).not.toHaveBeenCalled();
  });

  it('normalizes the selection before recording (line separators + runs of spaces)', async () => {
    const h = createSession({ selection: 'a\u2028b\u2029c\u0085d    e' });
    await h.session.recordCurrentPage();

    const options = h.previewFlow.run.mock.calls[0]![0] as Record<string, unknown>;
    expect(options.content).toBe('a b c d e');
  });

  it(`truncates a selection beyond the ${SELECTION_MAX_CHARS}-char cap and still records`, async () => {
    const h = createSession({ selection: 'x'.repeat(SELECTION_MAX_CHARS + 500) });
    await h.session.recordCurrentPage();

    const options = h.previewFlow.run.mock.calls[0]![0] as Record<string, unknown>;
    expect(options.content).toHaveLength(SELECTION_MAX_CHARS);
  });

  it('falls back to the page record when nothing is selected (backward compatible)', async () => {
    const h = createSession({ selection: '' });
    await h.session.recordCurrentPage();

    expect(h.tabContentFetcher.fetch).toHaveBeenCalledTimes(1);
    expect(h.previewFlow.run).toHaveBeenCalledTimes(1);
    const options = h.previewFlow.run.mock.calls[0]![0] as Record<string, unknown>;
    expect(options.content).toBe('page content');
    // The page path carries no marker; the wire payload drops the unset key
    // (buildRecordPayload pickDefined — pinned in selectionOriginWire.test.ts).
    expect(options.contentOrigin).toBeUndefined();
  });

  it('falls back to the page record when the content script does not answer', async () => {
    const h = createSession({});
    await h.session.recordCurrentPage();

    expect(h.tabContentFetcher.fetch).toHaveBeenCalledTimes(1);
    const options = h.previewFlow.run.mock.calls[0]![0] as Record<string, unknown>;
    expect(options.content).toBe('page content');
    // The page path carries no marker; the wire payload drops the unset key
    // (buildRecordPayload pickDefined — pinned in selectionOriginWire.test.ts).
    expect(options.contentOrigin).toBeUndefined();
  });

  it('falls back to the page record when the selection ask throws', async () => {
    const h = createSession({ selection: new Error('context invalidated') });
    await h.session.recordCurrentPage();

    expect(h.tabContentFetcher.fetch).toHaveBeenCalledTimes(1);
    const options = h.previewFlow.run.mock.calls[0]![0] as Record<string, unknown>;
    expect(options.content).toBe('page content');
    // The page path carries no marker; the wire payload drops the unset key
    // (buildRecordPayload pickDefined — pinned in selectionOriginWire.test.ts).
    expect(options.contentOrigin).toBeUndefined();
  });

  it('keeps the selection on the force-retry path after PRIVATE_PAGE_DETECTED', async () => {
    const h = createSession({ selection: 'selected paragraph' });
    h.previewFlow.run
      .mockResolvedValueOnce({ success: false, error: 'PRIVATE_PAGE_DETECTED', reason: 'cache-control' })
      .mockResolvedValueOnce({
        success: true,
        result: { success: true, summary: 's', tags: [], aiDuration: 1, obsidianDuration: 1, aiProvider: 'openai' },
      });

    await h.session.recordCurrentPage();
    // The private-page branch re-arms the button; a force retry carries the
    // same selection content, not the page body.
    const btn = document.getElementById('recordBtn') as HTMLButtonElement;
    expect(btn.textContent).toBe('forceRecordAnyway');
    await (btn.onclick as unknown as (e: Event) => Promise<void>)(new Event('click'));

    const retryOptions = h.previewFlow.run.mock.calls[1]![0] as Record<string, unknown>;
    expect(retryOptions.content).toBe('selected paragraph');
    expect(retryOptions.contentOrigin).toBe('selection');
    expect(h.tabContentFetcher.fetch).not.toHaveBeenCalled();
  });
});
