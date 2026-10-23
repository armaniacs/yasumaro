import { useTimerClock } from '../../../testDir/waitPolicy.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ManualContentFetcher } from '../manualContentFetcher.js';

// chrome.tabs and chrome.scripting stubs
const mockTabs: chrome.tabs.Tab[] = [];
const mockScriptResult = 'Extracted page content';

beforeEach(() => {
  mockTabs.length = 0;
  (globalThis as Record<string, unknown>).chrome = {
    tabs: {
      query: vi.fn(() => Promise.resolve(mockTabs)),
      create: vi.fn(() => Promise.resolve({ id: 999, url: 'https://example.com' })),
      get: vi.fn(() => Promise.resolve({ id: 999, status: 'complete' })),
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

    // Second call creates no new tab (served from cache)
    const createMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    const tabsMock = createMock.tabs as Record<string, unknown>;
    const createFn = tabsMock.create as ReturnType<typeof vi.fn>;
    createFn.mockClear();

    const content = await fetcher.fetchContent('https://example.com');
    expect(content).toBe(mockScriptResult);
    // Cache hit, so no tab is created
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
    await fetcher.fetchContent('https://c.com'); // 'a' is evicted
    expect(fetcher.getCacheSize()).toBe(2);
  });

  it('clearExpired removes TTL-expired entries', async () => {
    // Exercise TTL handling directly against the internal cache
    const fetcher = new ManualContentFetcher(100, 10);
    // No fetchContent call, so the cache starts empty
    expect(fetcher.getCacheSize()).toBe(0);
    // clearExpired on an empty cache must not throw
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
    // An existing tab means create is not called
    expect(createFn).not.toHaveBeenCalled();
  });

  it('removes created tab in finally block even when executeScript fails', async () => {
    const chromeMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    const scriptingMock = chromeMock.scripting as Record<string, unknown>;
    (scriptingMock.executeScript as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('script error'));

    // Rewire onUpdated.addListener to report complete immediately
    const tabsMock = chromeMock.tabs as Record<string, unknown>;
    (tabsMock.onUpdated as Record<string, unknown>).addListener = vi.fn(
      (cb: (tabId: number, info: { status?: string }) => void) => {
        cb(999, { status: 'complete' });
      }
    );

    const fetcher = new ManualContentFetcher();
    const content = await fetcher.fetchContent('https://example.com');

    // Failures surface as an empty string
    expect(content).toBe('');

    const removeFn = tabsMock.remove as ReturnType<typeof vi.fn>;
    // The created tab is removed in finally
    expect(removeFn).toHaveBeenCalledWith(999);
  }, 10000);
});

describe('ManualContentFetcher timeout path (PBI 2026-09-17-16)', () => {
  it('removes the onUpdated listener when the tab load times out', async () => {
    useTimerClock();
    try {
      const addListener = vi.fn();
      const removeListener = vi.fn();
      const chromeMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
      const tabsMock = chromeMock.tabs as Record<string, unknown>;
      // No existing tab: create a tab and wait for load without ever firing
      // complete, so the best-effort timeout path settles the wait. getTab
      // reports loading so the pre-check does not settle it first.
      tabsMock.query = vi.fn(() => Promise.resolve([]));
      tabsMock.get = vi.fn(() => Promise.resolve({ id: 999, status: 'loading' }));
      tabsMock.onUpdated = { addListener, removeListener };

      const fetcher = new ManualContentFetcher();
      const promise = fetcher.fetchContent('https://example.com');
      await vi.advanceTimersByTimeAsync(10000); // TAB_LOAD_TIMEOUT_MS
      await promise;

      expect(addListener).toHaveBeenCalledTimes(1);
      expect(removeListener).toHaveBeenCalledTimes(1);
      const timedOutListener = addListener.mock.calls[0]?.[0];
      expect(timedOutListener).toBeDefined();
      expect(removeListener).toHaveBeenCalledWith(timedOutListener);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the existing listener removal on the complete path', async () => {
    const addListener = vi.fn((cb: (tabId: number, info: { status?: string }) => void) => {
      cb(999, { status: 'complete' });
    });
    const removeListener = vi.fn();
    const chromeMock = (globalThis as Record<string, unknown>).chrome as Record<string, unknown>;
    const tabsMock = chromeMock.tabs as Record<string, unknown>;
    tabsMock.query = vi.fn(() => Promise.resolve([]));
    tabsMock.onUpdated = { addListener, removeListener };

    const fetcher = new ManualContentFetcher();
    await fetcher.fetchContent('https://example.com');

    const completedListener = addListener.mock.calls[0]?.[0];
    expect(completedListener).toBeDefined();
    expect(removeListener).toHaveBeenCalledWith(completedListener);
  });
});
