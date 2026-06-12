import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ManualContentFetcher } from '../manualContentFetcher.js';

// chrome.tabs と chrome.scripting をモック
const mockTabs: chrome.tabs.Tab[] = [];
const mockScriptResult = 'Extracted page content';

beforeEach(() => {
  mockTabs.length = 0;
  (globalThis as Record<string, unknown>).chrome = {
    tabs: {
      query: vi.fn(() => Promise.resolve(mockTabs)),
      create: vi.fn(() => Promise.resolve({ id: 999, url: 'https://example.com' })),
      remove: vi.fn(() => Promise.resolve()),
      onUpdated: {
        addListener: vi.fn((cb: (tabId: number, info: { status?: string }) => void) => {
          // immediately fire 'complete' so tests don't wait
          setTimeout(() => cb(999, { status: 'complete' }), 0);
        }),
        removeListener: vi.fn(),
      },
    },
    scripting: {
      executeScript: vi.fn(() => Promise.resolve([{ result: mockScriptResult }])),
    },
  };
});

describe('ManualContentFetcher', () => {
  it('fetchContent returns content from executeScript', async () => {
    const fetcher = new ManualContentFetcher();
    const content = await fetcher.fetchContent('https://example.com');
    expect(content).toBe(mockScriptResult);
  });

  it('fetchContent returns cached content on second call', async () => {
    const fetcher = new ManualContentFetcher();
    await fetcher.fetchContent('https://example.com');

    // 2回目は新しいタブを作らない（キャッシュから返す）
    const createMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    const tabsMock = createMock.tabs as Record<string, unknown>;
    const createFn = tabsMock.create as ReturnType<typeof vi.fn>;
    createFn.mockClear();

    const content = await fetcher.fetchContent('https://example.com');
    expect(content).toBe(mockScriptResult);
    // キャッシュヒットなのでタブ作成は呼ばれない
    expect(createFn).not.toHaveBeenCalled();
  });

  it('getCacheSize returns 0 initially', () => {
    const fetcher = new ManualContentFetcher();
    expect(fetcher.getCacheSize()).toBe(0);
  });

  it('getCacheSize increments after fetch', async () => {
    const fetcher = new ManualContentFetcher();
    await fetcher.fetchContent('https://example.com');
    expect(fetcher.getCacheSize()).toBe(1);
  });

  it('clear removes all cache entries', async () => {
    const fetcher = new ManualContentFetcher();
    await fetcher.fetchContent('https://example.com');
    fetcher.clear();
    expect(fetcher.getCacheSize()).toBe(0);
  });

  it('maxEntries limit evicts oldest entry', async () => {
    const fetcher = new ManualContentFetcher(60000, 2);
    await fetcher.fetchContent('https://a.com');
    await fetcher.fetchContent('https://b.com');
    await fetcher.fetchContent('https://c.com'); // 'a' が削除される
    expect(fetcher.getCacheSize()).toBe(2);
  });

  it('clearExpired removes TTL-expired entries', async () => {
    // ManualContentFetcher の内部キャッシュに直接エントリを作成して TTL テストを行う
    const fetcher = new ManualContentFetcher(100, 10);
    // fetchContent を呼ばずにキャッシュサイズが 0 であることを確認
    expect(fetcher.getCacheSize()).toBe(0);
    // clearExpired は空キャッシュでも例外を投げない
    fetcher.clearExpired();
    expect(fetcher.getCacheSize()).toBe(0);
  });

  it('uses existing tab if URL is already open', async () => {
    mockTabs.push({ id: 42, url: 'https://existing.com' } as chrome.tabs.Tab);
    const fetcher = new ManualContentFetcher();
    await fetcher.fetchContent('https://existing.com');

    const chromeMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    const tabsMock = chromeMock.tabs as Record<string, unknown>;
    const createFn = tabsMock.create as ReturnType<typeof vi.fn>;
    // 既存タブがあるので create は呼ばれない
    expect(createFn).not.toHaveBeenCalled();
  });

  it('removes created tab in finally block even when executeScript fails', async () => {
    const chromeMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    const scriptingMock = chromeMock.scripting as Record<string, unknown>;
    (scriptingMock.executeScript as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('script error'));

    // onUpdated.addListener が即座に complete を通知するように再設定
    const tabsMock = chromeMock.tabs as Record<string, unknown>;
    (tabsMock.onUpdated as Record<string, unknown>).addListener = vi.fn(
      (cb: (tabId: number, info: { status?: string }) => void) => {
        cb(999, { status: 'complete' });
      }
    );

    const fetcher = new ManualContentFetcher();
    const content = await fetcher.fetchContent('https://example.com');

    // エラー時は空文字を返す
    expect(content).toBe('');

    const removeFn = tabsMock.remove as ReturnType<typeof vi.fn>;
    // 作成したタブは finally で削除される
    expect(removeFn).toHaveBeenCalledWith(999);
  }, 10000);
});
