import { describe, it, expect, vi } from 'vitest';

describe('TabCache remove durability (PBI 2026-09-12-24)', () => {
  it('flushes immediately on remove so the delete survives a suspend', async () => {
    vi.resetModules();
    const setMock = vi.fn().mockResolvedValue(undefined);
    (globalThis as { chrome?: unknown }).chrome = {
      storage: { session: { get: vi.fn().mockResolvedValue({}), set: setMock } },
    };

    const { TabCache } = await import('../tabCache.js');
    const cache = new TabCache();
    vi.useFakeTimers();
    try {
      cache.add({ id: 1, url: 'https://a.com', title: 'A' } as chrome.tabs.Tab);
      // Debounced write has NOT flushed yet
      expect(setMock).not.toHaveBeenCalled();
      const removeDone = cache.removeAndFlush ? cache.removeAndFlush(1) : Promise.resolve(cache.remove(1));
      await removeDone;
      // remove bypasses the debounce — flushImmediately
      expect(setMock).toHaveBeenCalled();
      const payload = setMock.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      // SESSION_KEYS.TAB_CACHE = 'sw:tabCache'; mapToEntries shape — an
      // entries array, empty after the remove.
      expect(payload['sw:tabCache']).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AutoSavedBadgeTabs prune (PBI 2026-09-12-24)', () => {
  it('drops tab IDs that no longer exist on restore', async () => {
    vi.resetModules();
    const storedTabs = [1, 2, 3];
    const setMock = vi.fn().mockResolvedValue(undefined);
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        session: {
          get: vi.fn().mockResolvedValue({ serviceWorkerAutoSavedBadgeTabs: storedTabs }),
          set: setMock,
        },
      },
      tabs: {
        get: vi.fn(async (tabId: number) =>
          tabId === 2 ? { id: 2 } : Promise.reject(new Error('No tab with id')),
        ),
      },
    };

    const { createAutoSavedBadgeTabs } = await import('../swStatePersistence.js');
    const badgeTabs = createAutoSavedBadgeTabs({
      exists: async (tabId) => {
        try {
          const tab = await chrome.tabs.get(tabId);
          return tab?.id !== undefined;
        } catch {
          return false;
        }
      },
    });
    await badgeTabs.restore();

    expect(badgeTabs.has(2)).toBe(true);
    expect(badgeTabs.has(1)).toBe(false);
    expect(badgeTabs.has(3)).toBe(false);
    // Pruned set persisted
    const payload = setMock.mock.calls.at(-1)?.[0] as { serviceWorkerAutoSavedBadgeTabs?: number[] };
    expect(payload.serviceWorkerAutoSavedBadgeTabs).toEqual([2]);
  });

  it('without the port, restore stays add-only (back-compat)', async () => {
    vi.resetModules();
    const setMock = vi.fn().mockResolvedValue(undefined);
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        session: {
          get: vi.fn().mockResolvedValue({ serviceWorkerAutoSavedBadgeTabs: [1, 2] }),
          set: setMock,
        },
      },
    };

    const { createAutoSavedBadgeTabs } = await import('../swStatePersistence.js');
    const badgeTabs = createAutoSavedBadgeTabs();
    await badgeTabs.restore();
    expect(badgeTabs.has(1)).toBe(true);
    expect(badgeTabs.has(2)).toBe(true);
  });
});
