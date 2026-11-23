// @vitest-environment wasm-quickjs-dom
/**
 * recordSession-lock.test.ts
 * PBI 2026-11-23-03: ロック中の記録追加抑止と dashboard 誘導。
 *
 * Outside-In の失敗試験: ロック中に Record Now ボタンが無効化され、
 * dashboard への導線が出て、記録処理 (fetch/preview/save) が実行されない。
 */
import { useTimerClock } from '../../../testDir/waitPolicy.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockIsLocked = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const mockGetMessage = vi.hoisted(() => vi.fn((key: string) => key));
const mockGetCurrentTab = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 1, url: 'https://example.com', title: 'Example' }));
const mockIsRecordable = vi.hoisted(() => vi.fn().mockReturnValue(true));
const mockCheckPageStatus = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock('../../utils/storage/authGuard.js', () => ({
  isLocked: mockIsLocked,
}));

vi.mock('../../utils/i18n.js', async () => {
  const { mockGetMessage: i18nMock } = await import('../../../testDir/i18nMock.js');
  return i18nMock(mockGetMessage);
});

vi.mock('../tabUtils.js', () => ({
  getCurrentTab: mockGetCurrentTab,
}));

vi.mock('../../utils/recordingGateTable.js', () => ({
  isRecordableTab: mockIsRecordable,
}));

vi.mock('../statusChecker.js', () => ({
  checkPageStatus: mockCheckPageStatus,
}));

vi.mock('../statusPanel.js', () => ({
  updateCleansingStatus: vi.fn(),
  updateTrustStatus: vi.fn().mockResolvedValue(undefined),
}));

import { RecordSession } from '../recordCurrentPage/recordSession.js';

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

function createMocks() {
  const tabContentFetcher = { fetch: vi.fn().mockResolvedValue({ content: 'page content' }) } as any;
  const previewFlow = { run: vi.fn().mockResolvedValue({ success: true, result: { success: true, summary: 'sum', tags: [], aiDuration: 1, obsidianDuration: 1, aiProvider: 'openai' } }) } as any;
  return { tabContentFetcher, previewFlow };
}

beforeEach(() => {
  useTimerClock();
  setupBaseDOM();
  vi.clearAllMocks();
  mockIsLocked.mockResolvedValue(false);
  mockGetMessage.mockImplementation((key: string) => key);
  mockGetCurrentTab.mockResolvedValue({ id: 1, url: 'https://example.com', title: 'Example' } as any);
  mockIsRecordable.mockReturnValue(true);
  mockCheckPageStatus.mockResolvedValue(null);
  (chrome.tabs as any).create = vi.fn().mockResolvedValue({ id: 2 });
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('RecordSession (locked)', () => {
  it('loadCurrentTab で記録ボタンを無効化し dashboard 導線を出す', async () => {
    mockIsLocked.mockResolvedValue(true);
    const session = new RecordSession(createMocks().tabContentFetcher, createMocks().previewFlow);

    await session.loadCurrentTab();

    const btn = document.getElementById('recordBtn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(document.getElementById('mainStatus')!.textContent).not.toBe('');
    // dashboard 誘導ボタンが存在する
    expect(document.querySelector('#mainStatus button')).not.toBeNull();
  });

  it('start では記録処理を実行しない', async () => {
    mockIsLocked.mockResolvedValue(true);
    const { tabContentFetcher, previewFlow } = createMocks();
    const session = new RecordSession(tabContentFetcher, previewFlow);

    // popup の実フロー通り loadCurrentTab が先にロック状態を読む。
    await session.loadCurrentTab();
    await session.start(false);

    expect(tabContentFetcher.fetch).not.toHaveBeenCalled();
    expect(previewFlow.run).not.toHaveBeenCalled();
  });

  it('開封後に施錠された場合は start で読直して抑止する (TOCTOU)', async () => {
    mockIsLocked.mockResolvedValue(false);
    const { tabContentFetcher, previewFlow } = createMocks();
    const session = new RecordSession(tabContentFetcher, previewFlow);

    // 開封時は未ロックでボタンを戻す。
    await session.loadCurrentTab();
    expect(mockIsLocked).toHaveBeenCalledTimes(1);

    // 開封後に施錠されてから押下する (pendingPages は押下時に読直す)。
    mockIsLocked.mockResolvedValue(true);
    await session.start(false);

    expect(tabContentFetcher.fetch).not.toHaveBeenCalled();
    expect(previewFlow.run).not.toHaveBeenCalled();
    expect(session.state).toBe('idle');
    // start が施錠を読直したこと自体を pin する。
    expect(mockIsLocked.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('開封後に解錠された場合は start で読直して記録する', async () => {
    mockIsLocked.mockResolvedValue(true);
    const { tabContentFetcher, previewFlow } = createMocks();
    const session = new RecordSession(tabContentFetcher, previewFlow);

    await session.loadCurrentTab();

    // 開封後に解錠されてから押下する。古いキャッシュ (true) での抑止は誤り。
    mockIsLocked.mockResolvedValue(false);
    await session.start(false);

    expect(previewFlow.run).toHaveBeenCalled();
  });

  it('導線ボタンのクリックで dashboard を開く', async () => {
    mockIsLocked.mockResolvedValue(true);
    const session = new RecordSession(createMocks().tabContentFetcher, createMocks().previewFlow);

    await session.loadCurrentTab();

    const guideButton = document.querySelector('#mainStatus button') as HTMLButtonElement;
    expect(guideButton).not.toBeNull();
    guideButton.click();
    // タブを開くまで待つ (click ハンドラは非同期の可能性がある)
    await Promise.resolve();

    expect((chrome.tabs as any).create).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('options.html') }),
    );
  });
});

describe('RecordSession (unlocked)', () => {
  it('未ロック時は従来通り記録処理を行う', async () => {
    mockIsLocked.mockResolvedValue(false);
    const { tabContentFetcher, previewFlow } = createMocks();
    const session = new RecordSession(tabContentFetcher, previewFlow);

    await session.start(false);

    expect(previewFlow.run).toHaveBeenCalled();
  });
});
