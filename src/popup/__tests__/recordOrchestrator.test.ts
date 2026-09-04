// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- hoisted mocks ---
const mockGetAll = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockCheckPageStatus = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockStartAutoCloseTimer = vi.hoisted(() => vi.fn());
const mockGetCurrentTab = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 1, url: 'https://example.com', title: 'Example' }));
const mockIsRecordable = vi.hoisted(() => vi.fn().mockReturnValue(true));
const mockFormatSuccessMessage = vi.hoisted(() => vi.fn().mockReturnValue('Success message'));
const mockGetMessage = vi.hoisted(() => vi.fn((key: string) => key));
const mockGetSavedUrlEntries = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockCopyTextToClipboard = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockFormatEntryToMarkdown = vi.hoisted(() => vi.fn().mockReturnValue('# Markdown'));
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
vi.mock('../errorUtils.js', () => ({
  formatSuccessMessage: mockFormatSuccessMessage,
  showError: mockShowError,
}));
vi.mock('../spinner.js', () => ({
  showSpinner: mockShowSpinner,
  hideSpinner: mockHideSpinner,
}));
vi.mock('../../utils/i18n.js', () => ({
  getMessage: mockGetMessage,
}));
vi.mock('../../utils/storageUrls.js', () => ({
  getSavedUrlEntries: mockGetSavedUrlEntries,
}));
vi.mock('../../utils/clipboard.js', () => ({
  copyTextToClipboard: mockCopyTextToClipboard,
}));
vi.mock('../../utils/markdownFormatter.js', () => ({
  formatEntryToMarkdown: mockFormatEntryToMarkdown,
}));
vi.mock('../statusPanel.js', () => ({
  updateCleansingStatus: mockUpdateCleansingStatus,
  updateTrustStatus: mockUpdateTrustStatus,
}));

import { RecordSession } from '../recordCurrentPage/recordSession.js';

// Helper to create mock collaborators
function createMocks() {
  const tabContentFetcher = { fetch: vi.fn().mockResolvedValue({ content: 'page content' }) } as any;
  const previewFlow = { run: vi.fn().mockResolvedValue({ success: true, result: { success: true, summary: 'sum', tags: ['a','b'], aiDuration: 100, obsidianDuration: 50, aiProvider: 'openai' } }) } as any;
  return { tabContentFetcher, previewFlow };
}

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

beforeEach(() => {
  setupBaseDOM();
  vi.clearAllMocks();
  // reset hoisted mocks defaults
  mockGetAll.mockResolvedValue({});
  mockCheckPageStatus.mockResolvedValue(null);
  mockStartAutoCloseTimer.mockClear();
  mockGetCurrentTab.mockResolvedValue({ id: 1, url: 'https://example.com', title: 'Example' } as any);
  mockIsRecordable.mockReturnValue(true);
  mockFormatSuccessMessage.mockReturnValue('Success message');
  mockGetMessage.mockImplementation((key: string) => key);
  mockGetSavedUrlEntries.mockResolvedValue([]);
  mockCopyTextToClipboard.mockResolvedValue(undefined);
  mockFormatEntryToMarkdown.mockReturnValue('# Markdown');
  mockUpdateCleansingStatus.mockClear();
  mockUpdateTrustStatus.mockResolvedValue(undefined);
  // chrome mocks
  (chrome.runtime.getURL as unknown as ReturnType<typeof vi.fn>).mockImplementation((path: string) => `chrome-extension://test-id${path}`);
  (chrome.tabs.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ url: 'https://example.com', id: 1 }]);
  (chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  // ensure navigator.clipboard exists for fallback
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockResolvedValue(undefined) }, writable: true, configurable: true });
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

// ---------------------------------------------------------------------------
// loadCurrentTab
// ---------------------------------------------------------------------------
describe('RecordSession.loadCurrentTab', () => {
  it('returns early when no tab', async () => {
    mockGetCurrentTab.mockResolvedValueOnce(null);
    const { tabContentFetcher, previewFlow } = createMocks();
    const o = new RecordSession(tabContentFetcher, previewFlow);
    await expect(o.loadCurrentTab()).resolves.not.toThrow();
  });

  it('sets favicon with pageUrl param when tab.url present', async () => {
    mockGetCurrentTab.mockResolvedValueOnce({ id: 1, url: 'https://example.com/page', title: 'T' } as any);
    const { tabContentFetcher, previewFlow } = createMocks();
    const o = new RecordSession(tabContentFetcher, previewFlow);
    await o.loadCurrentTab();
    const fav = document.getElementById('favicon') as HTMLImageElement;
    expect(fav.src).toContain('pageUrl=');
    expect(fav.src).toContain('size=32');
  });

  it('sets favicon without pageUrl when tab.url missing', async () => {
    mockGetCurrentTab.mockResolvedValueOnce({ id: 1, title: 'NoUrl' } as any);
    const o = new RecordSession(createMocks().tabContentFetcher, createMocks().previewFlow);
    await o.loadCurrentTab();
    const fav = document.getElementById('favicon') as HTMLImageElement;
    expect(fav.src).toContain('size=32');
    expect(fav.src).not.toContain('pageUrl=');
  });

  it('handles missing favicon element gracefully', async () => {
    document.getElementById('favicon')!.remove();
    mockGetCurrentTab.mockResolvedValueOnce({ id: 1, url: 'https://example.com', title: 'T' } as any);
    const o = new RecordSession(createMocks().tabContentFetcher, createMocks().previewFlow);
    await expect(o.loadCurrentTab()).resolves.not.toThrow();
  });

  it('sets pageTitle with fallback when title missing', async () => {
    mockGetCurrentTab.mockResolvedValueOnce({ id: 1, url: 'https://example.com', title: undefined } as any);
    const o = new RecordSession(createMocks().tabContentFetcher, createMocks().previewFlow);
    await o.loadCurrentTab();
    expect(document.getElementById('pageTitle')!.textContent).toBe('noTitle');
  });

  it('handles missing pageTitle element', async () => {
    document.getElementById('pageTitle')!.remove();
    mockGetCurrentTab.mockResolvedValueOnce({ id: 1, url: 'https://example.com', title: 'T' } as any);
    const o = new RecordSession(createMocks().tabContentFetcher, createMocks().previewFlow);
    await expect(o.loadCurrentTab()).resolves.not.toThrow();
  });

  it('handles missing pageUrl element', async () => {
    document.getElementById('pageUrl')!.remove();
    mockGetCurrentTab.mockResolvedValueOnce({ id: 1, url: 'https://example.com', title: 'T' } as any);
    const o = new RecordSession(createMocks().tabContentFetcher, createMocks().previewFlow);
    await expect(o.loadCurrentTab()).resolves.not.toThrow();
  });

  it('truncates long url and shows full short url', async () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(60);
    mockGetCurrentTab.mockResolvedValueOnce({ id: 1, url: longUrl, title: 'T' } as any);
    const o = new RecordSession(createMocks().tabContentFetcher, createMocks().previewFlow);
    await o.loadCurrentTab();
    const urlEl = document.getElementById('pageUrl')!;
    expect(urlEl.textContent).toContain('...');
    expect(urlEl.textContent!.length).toBeLessThanOrEqual(53);
    // short url not truncated
    mockGetCurrentTab.mockResolvedValueOnce({ id: 1, url: 'https://short.com', title: 'T' } as any);
    await o.loadCurrentTab();
    expect(document.getElementById('pageUrl')!.textContent).toBe('https://short.com');
  });

  it('handles tab without url (empty string fallback)', async () => {
    mockGetCurrentTab.mockResolvedValueOnce({ id: 1, title: 'T' } as any);
    const o = new RecordSession(createMocks().tabContentFetcher, createMocks().previewFlow);
    await o.loadCurrentTab();
    expect(document.getElementById('pageUrl')!.textContent).toBe('');
  });

  it('disables record button when not recordable and enables when recordable', async () => {
    mockIsRecordable.mockReturnValueOnce(false);
    mockGetCurrentTab.mockResolvedValueOnce({ id: 1, url: 'chrome://extensions', title: 'Ext' } as any);
    const o = new RecordSession(createMocks().tabContentFetcher, createMocks().previewFlow);
    await o.loadCurrentTab();
    const btn = document.getElementById('recordBtn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('cannotRecordPage');

    mockIsRecordable.mockReturnValueOnce(true);
    mockGetCurrentTab.mockResolvedValueOnce({ id: 1, url: 'https://example.com', title: 'Ok' } as any);
    await o.loadCurrentTab();
    expect(btn.disabled).toBe(false);
    // recordNow fallback when getMessage returns empty
    mockGetMessage.mockImplementation((k: string) => k === 'recordNow' ? '' : k);
    mockGetCurrentTab.mockResolvedValueOnce({ id: 1, url: 'https://example.com', title: 'Ok' } as any);
    mockIsRecordable.mockReturnValueOnce(true);
    await o.loadCurrentTab();
    expect(btn.textContent).toBe('📝 Record Now');
  });

  it('handles missing recordBtn gracefully', async () => {
    document.getElementById('recordBtn')!.remove();
    mockGetCurrentTab.mockResolvedValueOnce({ id: 1, url: 'https://example.com', title: 'T' } as any);
    const o = new RecordSession(createMocks().tabContentFetcher, createMocks().previewFlow);
    await expect(o.loadCurrentTab()).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// resetRecordButton
// ---------------------------------------------------------------------------
describe('RecordSession.resetRecordButton', () => {
  it('sets forceRecordAnyway when domain not allowed', async () => {
    const btn = document.getElementById('recordBtn') as HTMLButtonElement;
    mockCheckPageStatus.mockResolvedValueOnce({ domainFilter: { allowed: false } } as any);
    (chrome.tabs.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ url: 'https://blocked.com' }]);
    const o = new RecordSession(createMocks().tabContentFetcher, createMocks().previewFlow);
    await o.resetRecordButton(btn);
    expect(btn.textContent).toBe('forceRecordAnyway');
    expect(typeof btn.onclick).toBe('function');
    // fallback when getMessage returns falsy
    mockGetMessage.mockImplementation(() => '');
    mockCheckPageStatus.mockResolvedValueOnce({ domainFilter: { allowed: false } } as any);
    (chrome.tabs.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ url: 'https://blocked.com' }]);
    await o.resetRecordButton(btn);
    expect(btn.textContent).toBe('Record Anyway');
  });

  it('sets recordNow when allowed or status null', async () => {
    const btn = document.getElementById('recordBtn') as HTMLButtonElement;
    mockCheckPageStatus.mockResolvedValueOnce({ domainFilter: { allowed: true } } as any);
    (chrome.tabs.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ url: 'https://example.com' }]);
    const o = new RecordSession(createMocks().tabContentFetcher, createMocks().previewFlow);
    await o.resetRecordButton(btn);
    expect(btn.textContent).toBe('recordNow');
    // null status
    mockCheckPageStatus.mockResolvedValueOnce(null);
    (chrome.tabs.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ url: 'https://example.com' }]);
    await o.resetRecordButton(btn);
    expect(btn.textContent).toBe('recordNow');
  });

  it('handles tabs query with no url and empty array', async () => {
    const btn = document.getElementById('recordBtn') as HTMLButtonElement;
    (chrome.tabs.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{}]);
    const o = new RecordSession(createMocks().tabContentFetcher, createMocks().previewFlow);
    await o.resetRecordButton(btn);
    expect(btn.textContent).toBe('recordNow');
    (chrome.tabs.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    await o.resetRecordButton(btn);
    expect(btn.textContent).toBe('recordNow');
  });

  it('onclick triggers handleRecordNowClick with correct force value', async () => {
    const btn = document.getElementById('recordBtn') as HTMLButtonElement;
    mockCheckPageStatus.mockResolvedValueOnce({ domainFilter: { allowed: false } } as any);
    (chrome.tabs.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ url: 'https://blocked.com' }]);
    const mocks = createMocks();
    mocks.previewFlow.run.mockResolvedValue({ success: true, result: { success: true, tags: [] } });
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    // stub recordCurrentPage path via handleRecordNowClick -> recordCurrentPage
    // For this test, ensure handleRecordNowClick will call recordCurrentPage which needs DOM
    // Make fetch succeed
    await o.resetRecordButton(btn);
    // btn.onclick should be set to handleRecordNowClick(true)
    // Instead of executing full flow, spy on recordCurrentPage
    const spy = vi.spyOn(o as any, 'recordCurrentPage').mockResolvedValue(undefined);
    await (btn.onclick as any)();
    expect(spy).toHaveBeenCalled;
    spy.mockRestore();
    // allowed case
    mockCheckPageStatus.mockResolvedValueOnce({ domainFilter: { allowed: true } } as any);
    (chrome.tabs.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ url: 'https://example.com' }]);
    await o.resetRecordButton(btn);
    const spy2 = vi.spyOn(o as any, 'recordCurrentPage').mockResolvedValue(undefined);
    await (btn.onclick as any)();
    spy2.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// handleRecordNowClick
// ---------------------------------------------------------------------------
describe('RecordSession.handleRecordNowClick', () => {
  it('returns early when button missing', async () => {
    document.getElementById('recordBtn')!.remove();
    const o = new RecordSession(createMocks().tabContentFetcher, createMocks().previewFlow);
    await expect(o.handleRecordNowClick()).resolves.not.toThrow();
  });

  it('runs the force branch with tab and content (no fetch)', async () => {
    const mocks = createMocks();
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    const tab = { id: 1, url: 'https://example.com', title: 'T' } as any;
    await o.handleRecordNowClick(true, tab, 'content');
    expect(mocks.previewFlow.run).toHaveBeenCalledWith(
      expect.objectContaining({ tab, content: 'content', force: true })
    );
    expect(mocks.tabContentFetcher.fetch).not.toHaveBeenCalled();
    expect(o.state).toBe('showing-result');
  });

  it('runs the force branch with empty string content', async () => {
    const mocks = createMocks();
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    const tab = { id: 1, url: 'https://example.com' } as any;
    await o.handleRecordNowClick(true, tab, '');
    expect(mocks.previewFlow.run).toHaveBeenCalledWith(
      expect.objectContaining({ content: '', force: true })
    );
  });

  it('runs the normal branch when force false or missing tab/content', async () => {
    const mocks = createMocks();
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    await o.handleRecordNowClick(false);
    await o.handleRecordNowClick(true); // missing tab/content
    await o.handleRecordNowClick(true, { id: 1 } as any); // missing content
    // Normal branch fetches content in all three cases.
    expect(mocks.tabContentFetcher.fetch).toHaveBeenCalledTimes(3);
  });

  it('uses fallback text when getMessage returns empty for progress', async () => {
    mockGetMessage.mockImplementation(() => '');
    const mocks = createMocks();
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    const tab = { id: 1, url: 'https://example.com' } as any;
    mocks.previewFlow.run.mockResolvedValue({ success: true, result: { success: true } });
    await o.handleRecordNowClick(true, tab, 'c');
    const btn = document.getElementById('recordBtn') as HTMLButtonElement;
    // showButtonResultState done fallback (getMessage empty -> 'Saved!')
    expect(btn.textContent).toBe('Saved!');
  });

  it('force confirm path drives the session state machine', async () => {
    const mocks = createMocks();
    mocks.previewFlow.run.mockResolvedValue({ error: 'PRIVATE_PAGE_DETECTED', reason: 'cache-control' });
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    const tab = { id: 1, url: 'https://example.com' } as any;
    await o.start(true, tab, 'content');
    const btn = document.getElementById('recordBtn') as HTMLButtonElement;
    // private-page settlement offers force-retry and parks in awaiting-force
    expect(btn.textContent).toBe('forceRecordAnyway');
    expect(o.state).toBe('awaiting-force');
    // trigger onclick to verify it re-arms a force attempt
    const spy = vi.spyOn(o, 'start').mockResolvedValue(undefined);
    await (btn.onclick as any)();
    expect(spy).toHaveBeenCalledWith(true, tab, 'content');
    spy.mockRestore();
    // reset + result states transition explicitly
    await o.resetRecordButton(btn);
    (o as any).showButtonResultState(btn, 'done');
    expect(o.state).toBe('showing-result');
    // cancel releases back to idle
    await o.cancel();
    expect(o.state).toBe('idle');
  });

  it('concurrent start while running is ignored', async () => {
    const mocks = createMocks();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    mocks.previewFlow.run.mockImplementationOnce(() => gate.then(() => ({ success: true, result: { success: true } })));
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    const first = o.start(false);
    // Wait until the first attempt reaches the preview step, then race it.
    await vi.waitFor(() => expect(mocks.previewFlow.run).toHaveBeenCalledTimes(1));
    expect(o.state).toBe('running');
    await o.start(false); // concurrent: ignored
    expect(mocks.previewFlow.run).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(o.state).toBe('showing-result');
    await o.cancel();
  });
});

// ---------------------------------------------------------------------------
// private helpers via (o as any)
// ---------------------------------------------------------------------------
describe('RecordSession private helpers', () => {
  it('showButtonResultState sets done/error and resets after timeout', async () => {
    vi.useFakeTimers();
    const mocks = createMocks();
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    const btn = document.getElementById('recordBtn') as HTMLButtonElement;
    // done
    (o as any).showButtonResultState(btn, 'done');
    expect(btn.textContent).toBe('recordNowDone');
    expect(btn.disabled).toBe(true);
    expect(o.state).toBe('showing-result');
    // advance timers and check resetRecordButton called indirectly
    // mock checkPageStatus and tabs.query for reset
    mockCheckPageStatus.mockResolvedValue({ domainFilter: { allowed: true } } as any);
    (chrome.tabs.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ url: 'https://example.com' }]);
    await vi.advanceTimersByTimeAsync(2100);
    expect(o.state).toBe('idle');
    // error with fallback message
    mockGetMessage.mockImplementation((k: string) => k === 'recordNowError' ? '' : k);
    (o as any).showButtonResultState(btn, 'error');
    expect(btn.textContent).toBe('Failed');
    // timeout where recordBtn missing
    vi.useFakeTimers();
    document.getElementById('recordBtn')!.remove();
    mockCheckPageStatus.mockResolvedValue(null);
    (o as any).showButtonResultState(btn, 'done');
    await vi.advanceTimersByTimeAsync(2100);
    expect(o.state).toBe('idle');
    vi.useRealTimers();
  });

  it('showTagResult handles url empty, panel missing, no tags, tags present, skipAutoClose, and catch', async () => {
    const o = new RecordSession(createMocks().tabContentFetcher, createMocks().previewFlow);
    // empty url
    await (o as any).showTagResult('');
    expect(mockStartAutoCloseTimer).not.toHaveBeenCalled();
    // panel missing
    document.getElementById('tagResultPanel')!.remove();
    await (o as any).showTagResult('https://example.com');
    expect(mockStartAutoCloseTimer).not.toHaveBeenCalled();
    // restore panel
    const panel = document.createElement('div');
    panel.id = 'tagResultPanel';
    panel.className = 'hidden';
    document.body.appendChild(panel);
    // no entry / no tags
    mockGetSavedUrlEntries.mockResolvedValueOnce([]);
    await (o as any).showTagResult('https://example.com');
    expect(panel.classList.contains('hidden')).toBe(true);
    mockGetSavedUrlEntries.mockResolvedValueOnce([{ url: 'https://example.com' } as any]);
    await (o as any).showTagResult('https://example.com');
    expect(panel.classList.contains('hidden')).toBe(true);
    mockGetSavedUrlEntries.mockResolvedValueOnce([{ url: 'https://example.com', tags: [] } as any]);
    await (o as any).showTagResult('https://example.com');
    expect(panel.classList.contains('hidden')).toBe(true);
    // tags present, skipAutoClose false -> timer started
    mockGetSavedUrlEntries.mockResolvedValueOnce([{ url: 'https://example.com', tags: ['a', 'b'] } as any]);
    await (o as any).showTagResult('https://example.com', false);
    expect(panel.textContent).toContain('#a');
    expect(panel.classList.contains('hidden')).toBe(false);
    expect(mockStartAutoCloseTimer).toHaveBeenCalledWith(4000);
    mockStartAutoCloseTimer.mockClear();
    // skipAutoClose true -> no timer
    mockGetSavedUrlEntries.mockResolvedValueOnce([{ url: 'https://example.com', tags: ['x'] } as any]);
    await (o as any).showTagResult('https://example.com', true);
    expect(mockStartAutoCloseTimer).not.toHaveBeenCalled();
    // exception path
    mockGetSavedUrlEntries.mockRejectedValueOnce(new Error('fail'));
    await (o as any).showTagResult('https://example.com');
    expect(mockStartAutoCloseTimer).not.toHaveBeenCalled();
  });

  it('getOrCreateResultActionsContainer handles existing, missing tagPanel, and creates new', async () => {
    const o = new RecordSession(createMocks().tabContentFetcher, createMocks().previewFlow);
    // existing container
    const existing = document.createElement('div');
    existing.id = 'recordResultActions';
    existing.innerHTML = 'old';
    document.body.appendChild(existing);
    const c1 = (o as any).getOrCreateResultActionsContainer();
    expect(c1).toBe(existing);
    expect(c1.innerHTML).toBe('');
    existing.remove();
    // missing tagPanel
    document.getElementById('tagResultPanel')!.remove();
    const c2 = (o as any).getOrCreateResultActionsContainer();
    expect(c2).toBeNull();
    // recreate tagPanel and create new container
    const panel = document.createElement('div');
    panel.id = 'tagResultPanel';
    document.body.appendChild(panel);
    const c3 = (o as any).getOrCreateResultActionsContainer();
    expect(c3).not.toBeNull();
    expect(c3.id).toBe('recordResultActions');
    expect(c3.className).toBe('record-result-actions');
    // second call returns same cleared container
    const c4 = (o as any).getOrCreateResultActionsContainer();
    expect(c4).toBe(c3);
    expect(c4.innerHTML).toBe('');
  });

  it('buildEntryFromSaveResult handles tags array, non-array, empty summary, title fallbacks', async () => {
    const o = new RecordSession(createMocks().tabContentFetcher, createMocks().previewFlow);
    const tab1 = { url: 'https://example.com', title: 'Title' } as any;
    const r1: any = { summary: 'sum', tags: ['t1', 't2'] };
    const e1 = (o as any).buildEntryFromSaveResult(tab1, r1);
    expect(e1.url).toBe('https://example.com');
    expect(e1.title).toBe('Title');
    expect(e1.tags).toBe('t1,t2');
    expect(e1.summary).toBe('sum');
    // tags not array
    const e2 = (o as any).buildEntryFromSaveResult(tab1, { tags: 'not-array' } as any);
    expect(e2.tags).toBe('');
    // summary missing
    const e3 = (o as any).buildEntryFromSaveResult(tab1, {} as any);
    expect(e3.summary).toBe('');
    // tab url missing, title fallback to url, then both missing
    const e4 = (o as any).buildEntryFromSaveResult({ url: undefined, title: undefined } as any, {} as any);
    expect(e4.url).toBe('');
    expect(e4.title).toBe('');
    const e5 = (o as any).buildEntryFromSaveResult({ url: 'https://example.com', title: undefined } as any, {} as any);
    expect(e5.title).toBe('https://example.com');
    const e6 = (o as any).buildEntryFromSaveResult({ url: undefined, title: 'MyTitle' } as any, {} as any);
    expect(e6.title).toBe('MyTitle');
  });

  it('showCopyMarkdownButton returns false when container missing and true on success, handles copy success/failure', async () => {
    vi.useFakeTimers();
    const mocks = createMocks();
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    // container missing (tagPanel missing)
    document.getElementById('tagResultPanel')!.remove();
    const tab = { url: 'https://example.com', title: 'T' } as any;
    const res = await (o as any).showCopyMarkdownButton(tab, { summary: 's', tags: ['a'] });
    expect(res).toBe(false);
    // restore
    const panel = document.createElement('div');
    panel.id = 'tagResultPanel';
    document.body.appendChild(panel);
    // exception in build (simulate)
    const origBuild = (o as any).buildEntryFromSaveResult;
    (o as any).buildEntryFromSaveResult = () => { throw new Error('build fail'); };
    const res2 = await (o as any).showCopyMarkdownButton(tab, { summary: 's' });
    expect(res2).toBe(false);
    (o as any).buildEntryFromSaveResult = origBuild;

    // success path
    const ok = await (o as any).showCopyMarkdownButton(tab, { summary: 'hello', tags: ['x'] });
    expect(ok).toBe(true);
    const container = document.getElementById('recordResultActions')!;
    const btn = container.querySelector('button') as HTMLButtonElement;
    expect(btn.textContent).toBe('copyMarkdown');
    // click success
    mockCopyTextToClipboard.mockResolvedValueOnce(undefined);
    await btn.click();
    // need to flush microtasks
    await Promise.resolve();
    await Promise.resolve();
    expect(mockFormatEntryToMarkdown).toHaveBeenCalled();
    expect(mockCopyTextToClipboard).toHaveBeenCalled();
    // after success, button text changes to Copied! then back after timeout
    expect(btn.textContent).toBe('copyMarkdownSuccess');
    expect(btn.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(2100);
    expect(btn.textContent).toBe('copyMarkdown');
    expect(btn.disabled).toBe(false);

    // click failure path
    mockCopyTextToClipboard.mockRejectedValueOnce(new Error('clipboard fail'));
    mockGetMessage.mockImplementation((k: string) => {
      if (k === 'copyMarkdown') return 'copyMarkdown';
      if (k === 'copyMarkdownError') return 'copyMarkdownError';
      if (k === 'copyMarkdownSuccess') return 'copyMarkdownSuccess';
      return k;
    });
    await btn.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(btn.textContent).toBe('copyMarkdownError');
    await vi.advanceTimersByTimeAsync(2100);
    expect(btn.textContent).toBe('copyMarkdown');

    // fallback when getMessage returns empty for copyMarkdown and success/error
    document.getElementById('recordResultActions')!.remove();
    mockGetMessage.mockImplementation(() => '');
    const ok2 = await (o as any).showCopyMarkdownButton(tab, { summary: 's' });
    expect(ok2).toBe(true);
    const btn2 = document.getElementById('recordResultActions')!.querySelector('button') as HTMLButtonElement;
    expect(btn2.textContent).toBe('Copy Markdown');
    mockCopyTextToClipboard.mockResolvedValueOnce(undefined);
    await btn2.click();
    await Promise.resolve(); await Promise.resolve();
    expect(btn2.textContent).toBe('Copied!');
    await vi.advanceTimersByTimeAsync(2100);
    expect(btn2.textContent).toBe('Copy Markdown');
    // failure fallback
    mockCopyTextToClipboard.mockRejectedValueOnce(new Error('fail2'));
    await btn2.click();
    await Promise.resolve(); await Promise.resolve();
    expect(btn2.textContent).toBe('Copy failed');
    await vi.advanceTimersByTimeAsync(2100);
    expect(btn2.textContent).toBe('Copy Markdown');

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// recordCurrentPage — comprehensive branches
// ---------------------------------------------------------------------------
describe('RecordSession.recordCurrentPage', () => {
  it('returns early when statusDiv missing', async () => {
    document.getElementById('mainStatus')!.remove();
    const o = new RecordSession(createMocks().tabContentFetcher, createMocks().previewFlow);
    await expect(o.recordCurrentPage()).resolves.not.toThrow();
    expect(mockHideSpinner).not.toHaveBeenCalled();
  });

  it('handles recordBtn missing and still succeeds', async () => {
    document.getElementById('recordBtn')!.remove();
    const mocks = createMocks();
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    await o.recordCurrentPage();
    expect(mockHideSpinner).toHaveBeenCalled();
    expect(document.getElementById('mainStatus')!.textContent).toBe('Success message');
  });

  it('throws when no active tab or tab without id', async () => {
    const mocks = createMocks();
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    mockGetCurrentTab.mockResolvedValueOnce(null);
    await o.recordCurrentPage();
    expect(mockShowError).toHaveBeenCalled();
    expect(mockHideSpinner).toHaveBeenCalled();
    const btn = document.getElementById('recordBtn') as HTMLButtonElement;
    expect(btn.textContent).toBe('recordNowError');

    mockGetCurrentTab.mockResolvedValueOnce({ url: 'https://example.com' } as any);
    const mocks2 = createMocks();
    const o2 = new RecordSession(mocks2.tabContentFetcher, mocks2.previewFlow);
    await o2.recordCurrentPage();
    expect(mockShowError).toHaveBeenCalled();
  });

  it('throws when tab is not recordable', async () => {
    mockIsRecordable.mockReturnValueOnce(false);
    mockGetCurrentTab.mockResolvedValueOnce({ id: 1, url: 'chrome://settings', title: 'S' } as any);
    const mocks = createMocks();
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    await o.recordCurrentPage();
    expect(mockShowError).toHaveBeenCalled();
  });

  it('handles tabContentFetcher throwing with force false vs true and non-Error throw', async () => {
    const mocks = createMocks();
    mocks.tabContentFetcher.fetch.mockRejectedValueOnce(new Error('fetch fail'));
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    mockGetCurrentTab.mockResolvedValue({ id: 1, url: 'https://example.com', title: 'T' } as any);
    await o.recordCurrentPage(false);
    expect(mockShowError).toHaveBeenCalled();

    const mocks2 = createMocks();
    mocks2.tabContentFetcher.fetch.mockRejectedValueOnce('string error');
    const o2 = new RecordSession(mocks2.tabContentFetcher, mocks2.previewFlow);
    await o2.recordCurrentPage(false);
    expect(mockShowError).toHaveBeenCalled();

    const mocks3 = createMocks();
    mocks3.tabContentFetcher.fetch.mockRejectedValueOnce(new Error('fetch fail'));
    mocks3.previewFlow.run.mockResolvedValue({ success: true, result: { success: true } });
    const o3 = new RecordSession(mocks3.tabContentFetcher, mocks3.previewFlow);
    await o3.recordCurrentPage(true);
    // force true should swallow fetch error and proceed with empty content
    expect(mocks3.previewFlow.run).toHaveBeenCalledWith(expect.objectContaining({ content: '' }));
  });

  it('handles contentResponse null/undefined with force false vs true', async () => {
    const mocks = createMocks();
    mocks.tabContentFetcher.fetch.mockResolvedValueOnce(null as any);
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    await o.recordCurrentPage(false);
    expect(mockShowError).toHaveBeenCalled();

    const mocks2 = createMocks();
    mocks2.tabContentFetcher.fetch.mockResolvedValueOnce(null as any);
    mocks2.previewFlow.run.mockResolvedValue({ success: true, result: { success: true } });
    const o2 = new RecordSession(mocks2.tabContentFetcher, mocks2.previewFlow);
    await o2.recordCurrentPage(true);
    expect(mocks2.previewFlow.run).toHaveBeenCalledWith(expect.objectContaining({ content: '' }));

    const mocks3 = createMocks();
    mocks3.tabContentFetcher.fetch.mockResolvedValueOnce(undefined as any);
    const o3 = new RecordSession(mocks3.tabContentFetcher, mocks3.previewFlow);
    await o3.recordCurrentPage(false);
    expect(mockShowError).toHaveBeenCalled();
  });

  it('calls updateCleansingStatus and updateTrustStatus when tab.url present vs missing', async () => {
    const mocks = createMocks();
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    mocks.tabContentFetcher.fetch.mockResolvedValueOnce({ content: 'c', cleanseStats: { totalRemoved: 1 }, cleansedReason: 'hard' } as any);
    mockGetCurrentTab.mockResolvedValueOnce({ id: 1, url: 'https://example.com', title: 'T' } as any);
    await o.recordCurrentPage();
    expect(mockUpdateCleansingStatus).toHaveBeenCalledWith({ totalRemoved: 1 }, 'hard');
    expect(mockUpdateTrustStatus).toHaveBeenCalledWith('https://example.com');

    mockUpdateCleansingStatus.mockClear();
    mockUpdateTrustStatus.mockClear();
    mocks.tabContentFetcher.fetch.mockResolvedValueOnce({ content: 'c' } as any);
    mockGetCurrentTab.mockResolvedValueOnce({ id: 1, title: 'NoUrl' } as any);
    const o2 = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    await o2.recordCurrentPage();
    expect(mockUpdateTrustStatus).not.toHaveBeenCalled();
  });

  it('handles PRIVATE_PAGE_DETECTED and sets record anyway button', async () => {
    const mocks = createMocks();
    mocks.tabContentFetcher.fetch.mockResolvedValueOnce({ content: 'c' } as any);
    mocks.previewFlow.run.mockResolvedValueOnce({ success: false, error: 'PRIVATE_PAGE_DETECTED', reason: 'cache-control' } as any);
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    mockGetCurrentTab.mockResolvedValueOnce({ id: 1, url: 'https://example.com', title: 'T' } as any);
    await o.recordCurrentPage();
    expect(document.getElementById('mainStatus')!.textContent).toBe('errorPrefix PRIVATE_PAGE_DETECTED (privatePageReason_cachecontrol)');
    expect(document.getElementById('mainStatus')!.className).toBe('error');
    const btn = document.getElementById('recordBtn') as HTMLButtonElement;
    expect(btn.textContent).toBe('forceRecordAnyway');
    expect(o.state).toBe('awaiting-force');
    // ensure finish does not reset button while awaiting force confirm
    expect(mockHideSpinner).toHaveBeenCalled();
  });

  it('handles CANCELLED from previewFlow', async () => {
    const mocks = createMocks();
    mocks.tabContentFetcher.fetch.mockResolvedValueOnce({ content: 'c' } as any);
    mocks.previewFlow.run.mockResolvedValueOnce({ success: false, error: 'CANCELLED' } as any);
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    await o.recordCurrentPage();
    expect(document.getElementById('mainStatus')!.textContent).toBe('cancelled');
    // resetRecordButton should have been called (via void) — check button eventually resets
    // use fake timers to let reset logic run
  });

  it('throws when previewSave not success', async () => {
    const mocks = createMocks();
    mocks.tabContentFetcher.fetch.mockResolvedValueOnce({ content: 'c' } as any);
    mocks.previewFlow.run.mockResolvedValueOnce({ success: false, error: 'Some error' } as any);
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    await o.recordCurrentPage();
    expect(mockShowError).toHaveBeenCalled();
    const btn = document.getElementById('recordBtn') as HTMLButtonElement;
    expect(btn.textContent).toBe('recordNowError');
  });

  it('throws when previewSave success false with no error', async () => {
    const mocks = createMocks();
    mocks.tabContentFetcher.fetch.mockResolvedValueOnce({ content: 'c' } as any);
    mocks.previewFlow.run.mockResolvedValueOnce({ success: false } as any);
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    await o.recordCurrentPage();
    expect(mockShowError).toHaveBeenCalled();
  });

  it('success path with copy button shown and tag result skipped auto-close', async () => {
    const mocks = createMocks();
    mocks.tabContentFetcher.fetch.mockResolvedValueOnce({ content: 'c', byteStats: { pageBytes: 1 }, aiSummaryCleansedStats: { aiSummaryOriginalBytes: 1 }, cleansedReason: 'both', cleanseStats: { totalRemoved: 2 } } as any);
    mocks.previewFlow.run.mockResolvedValueOnce({ success: true, result: { success: true, summary: 's', tags: ['t'], aiDuration: 123, obsidianDuration: 45, aiProvider: 'openai' } } as any);
    // NOTE: showTagResult is spied below, so no entries are queued here — a
    // mockResolvedValueOnce would leak into later tests (clearAllMocks keeps
    // Once queues) and unhide their tag panels.
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    // spy showCopyMarkdownButton to return true
    const spyCopy = vi.spyOn(o as any, 'showCopyMarkdownButton').mockResolvedValue(true);
    const spyTag = vi.spyOn(o as any, 'showTagResult').mockResolvedValue(undefined);
    await o.recordCurrentPage();
    expect(mockHideSpinner).toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ACTIVITY_UPDATE' }));
    expect(mockFormatSuccessMessage).toHaveBeenCalledWith(expect.any(Number), 123, true, 'openai');
    expect(document.getElementById('mainStatus')!.textContent).toBe('Success message');
    expect(spyCopy).toHaveBeenCalled();
    expect(spyTag).toHaveBeenCalledWith('https://example.com', true);
    expect(mockStartAutoCloseTimer).not.toHaveBeenCalled();
    spyCopy.mockRestore(); spyTag.mockRestore();
  });

  it('success path with copy button not shown triggers auto-close', async () => {
    const mocks = createMocks();
    mocks.tabContentFetcher.fetch.mockResolvedValueOnce({ content: 'c' } as any);
    mocks.previewFlow.run.mockResolvedValueOnce({ success: true, result: { success: true } } as any);
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    vi.spyOn(o as any, 'showCopyMarkdownButton').mockResolvedValue(false);
    const spyTag = vi.spyOn(o as any, 'showTagResult').mockResolvedValue(undefined);
    await o.recordCurrentPage();
    expect(spyTag).toHaveBeenCalledWith('https://example.com');
    // startAutoCloseTimer called inside recordCurrentPage when copy not shown
    expect(mockStartAutoCloseTimer).toHaveBeenCalled();
  });

  it('success path handles chrome.runtime.sendMessage rejection and undefined tab.url', async () => {
    (chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('fail'));
    const mocks = createMocks();
    mocks.tabContentFetcher.fetch.mockResolvedValueOnce({ content: 'c' } as any);
    mocks.previewFlow.run.mockResolvedValueOnce({ success: true, result: { success: true, tags: [] } } as any);
    mockGetCurrentTab.mockResolvedValueOnce({ id: 1, title: 'NoUrl' } as any);
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    vi.spyOn(o as any, 'showCopyMarkdownButton').mockResolvedValue(false);
    await o.recordCurrentPage();
    expect(document.getElementById('mainStatus')!.textContent).toBe('Success message');
  });

  it('handles showCopyMarkdownButton and obsidianDuration undefined vs defined, and aiDuration undefined', async () => {
    const mocks = createMocks();
    mocks.tabContentFetcher.fetch.mockResolvedValueOnce({ content: 'c' } as any);
    mocks.previewFlow.run.mockResolvedValueOnce({ success: true, result: { success: true, aiDuration: undefined, obsidianDuration: undefined } } as any);
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    vi.spyOn(o as any, 'showCopyMarkdownButton').mockResolvedValue(true);
    vi.spyOn(o as any, 'showTagResult').mockResolvedValue(undefined);
    await o.recordCurrentPage();
    expect(mockFormatSuccessMessage).toHaveBeenCalledWith(expect.any(Number), undefined, false, undefined);
  });

  it('finish settles to idle and resets button when a branch leaves running state', async () => {
    mockGetCurrentTab.mockResolvedValue({ id: 1, url: 'https://example.com', title: 'T' } as any);
    mockIsRecordable.mockReturnValue(true);
    mockCheckPageStatus.mockResolvedValue({ domainFilter: { allowed: true } } as any);
    (chrome.tabs.query as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([{ url: 'https://example.com' }]);
    // Stub showButtonResultState to not transition, so the finish net catches
    // the still-running state and resets.
    const mocks3 = createMocks();
    mocks3.tabContentFetcher.fetch.mockResolvedValue({ content: 'c' } as any);
    mocks3.previewFlow.run.mockResolvedValue({ success: true, result: { success: true } } as any);
    const o4 = new RecordSession(mocks3.tabContentFetcher, mocks3.previewFlow);
    vi.spyOn(o4 as any, 'showButtonResultState').mockImplementation(() => {});
    vi.spyOn(o4 as any, 'showCopyMarkdownButton').mockResolvedValue(false);
    vi.spyOn(o4 as any, 'showTagResult').mockResolvedValue(undefined);
    await o4.recordCurrentPage();
    expect(o4.state).toBe('idle');
    // resetRecordButton ran (observable via checkPageStatus call)
    expect(mockCheckPageStatus).toHaveBeenCalled();
  });

  it('finish does not reset while awaiting force confirm', async () => {
    const mocks = createMocks();
    mocks.tabContentFetcher.fetch.mockResolvedValueOnce({ content: 'c' } as any);
    mocks.previewFlow.run.mockResolvedValueOnce({ success: false, error: 'PRIVATE_PAGE_DETECTED', reason: 'x' } as any);
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    mockCheckPageStatus.mockClear();
    await o.recordCurrentPage();
    expect(o.state).toBe('awaiting-force');
    // resetRecordButton should not have been auto-called in finish
    expect(mockCheckPageStatus).not.toHaveBeenCalled();
  });

  it('finish does not reset when awaitingForceConfirm true', async () => {
    const mocks = createMocks();
    mocks.tabContentFetcher.fetch.mockResolvedValueOnce({ content: 'c' } as any);
    mocks.previewFlow.run.mockResolvedValueOnce({ success: false, error: 'PRIVATE_PAGE_DETECTED', reason: 'x' } as any);
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    await o.recordCurrentPage();
    expect(o.state).toBe('awaiting-force');
    // resetRecordButton should not have been auto-called in finish
  });

  it('finally handles getCurrentTab null, btn null, isRecordable false branches', async () => {
    const mocks = createMocks();
    mocks.tabContentFetcher.fetch.mockResolvedValue({ content: 'c' } as any);
    mocks.previewFlow.run.mockResolvedValue({ success: true, result: { success: true } } as any);
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    vi.spyOn(o as any, 'showButtonResultState').mockImplementation(() => {});
    vi.spyOn(o as any, 'showCopyMarkdownButton').mockResolvedValue(false);
    vi.spyOn(o as any, 'showTagResult').mockResolvedValue(undefined);
    mockCheckPageStatus.mockClear();
    // case: getCurrentTab returns null in finally
    mockGetCurrentTab.mockResolvedValueOnce({ id: 1, url: 'https://example.com', title: 'T' } as any).mockResolvedValueOnce(null);
    await o.recordCurrentPage();
    expect(mockCheckPageStatus).not.toHaveBeenCalled();

    // case: btn missing -> finally should not call reset (no checkPageStatus via finally)
    document.getElementById('recordBtn')!.remove();
    mockCheckPageStatus.mockClear();
    const mocks2 = createMocks();
    mocks2.tabContentFetcher.fetch.mockResolvedValue({ content: 'c' } as any);
    mocks2.previewFlow.run.mockResolvedValue({ success: true, result: { success: true } } as any);
    mockGetCurrentTab.mockResolvedValueOnce({ id: 1, url: 'https://example.com', title: 'T' } as any).mockResolvedValueOnce({ id: 1, url: 'https://example.com' } as any);
    const o2 = new RecordSession(mocks2.tabContentFetcher, mocks2.previewFlow);
    vi.spyOn(o2 as any, 'showButtonResultState').mockImplementation(() => {});
    vi.spyOn(o2 as any, 'showCopyMarkdownButton').mockResolvedValue(false);
    vi.spyOn(o2 as any, 'showTagResult').mockResolvedValue(undefined);
    if (!document.getElementById('mainStatus')) {
      const s = document.createElement('div'); s.id = 'mainStatus'; document.body.appendChild(s);
    }
    await o2.recordCurrentPage();
    expect(mockCheckPageStatus).not.toHaveBeenCalled();

    // restore btn for next
    const btn = document.createElement('button'); btn.id = 'recordBtn'; document.body.appendChild(btn);
    mockCheckPageStatus.mockClear();
    // case: isRecordable false in finally -> no reset
    const m3 = createMocks();
    m3.tabContentFetcher.fetch.mockResolvedValue({ content: 'c' } as any);
    m3.previewFlow.run.mockResolvedValue({ success: true, result: { success: true } } as any);
    mockGetCurrentTab.mockResolvedValueOnce({ id: 1, url: 'https://blocked.com', title: 'T' } as any).mockResolvedValueOnce({ id: 1, url: 'https://blocked.com', title: 'T' } as any);
    // first call inside try isRecordable true, second in finally is false
    mockIsRecordable.mockReturnValueOnce(true).mockReturnValueOnce(false);
    const o3b = new RecordSession(m3.tabContentFetcher, m3.previewFlow);
    vi.spyOn(o3b as any, 'showButtonResultState').mockImplementation(() => {});
    vi.spyOn(o3b as any, 'showCopyMarkdownButton').mockResolvedValue(false);
    vi.spyOn(o3b as any, 'showTagResult').mockResolvedValue(undefined);
    await o3b.recordCurrentPage();
    expect(mockCheckPageStatus).not.toHaveBeenCalled();
  });

  it('covers spinner hide and statusDiv class clearing, tagPanel hidden branch, and statusDiv text fallback', async () => {
    const mocks = createMocks();
    mocks.tabContentFetcher.fetch.mockResolvedValueOnce({ content: 'c' } as any);
    mocks.previewFlow.run.mockResolvedValueOnce({ success: true, result: { success: true } } as any);
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    // ensure tagPanel exists and is hidden after clear
    const tagPanel = document.getElementById('tagResultPanel')!;
    tagPanel.textContent = 'old';
    tagPanel.classList.remove('hidden');
    await o.recordCurrentPage();
    expect(tagPanel.classList.contains('hidden')).toBe(true);
    expect(tagPanel.textContent).toBe('');
    // when tagPanel missing
    tagPanel.remove();
    const o2 = new RecordSession(createMocks().tabContentFetcher, createMocks().previewFlow);
    mocks.tabContentFetcher.fetch.mockResolvedValueOnce({ content: 'c' } as any);
    await expect(o2.recordCurrentPage()).resolves.not.toThrow();
  });

  it('covers performance.now and formatSuccessMessage branches with undefined durations', async () => {
    const mocks = createMocks();
    mocks.tabContentFetcher.fetch.mockResolvedValueOnce({ content: 'c' } as any);
    mocks.previewFlow.run.mockResolvedValueOnce({ success: true, result: { summary: '', tags: ['a'], aiDuration: 0, obsidianDuration: 0 } } as any);
    const o = new RecordSession(mocks.tabContentFetcher, mocks.previewFlow);
    vi.spyOn(o as any, 'showCopyMarkdownButton').mockResolvedValue(false);
    vi.spyOn(o as any, 'showTagResult').mockResolvedValue(undefined);
    await o.recordCurrentPage();
    expect(mockFormatSuccessMessage).toHaveBeenCalledWith(expect.any(Number), 0, true, undefined);
  });
});
