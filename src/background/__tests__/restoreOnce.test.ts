import { describe, it, expect } from 'vitest';

describe('AutoSavedBadgeTabs restore-once (PBI 2026-09-12-25)', () => {
  it('runs the fan-out only on the first restore; later calls are no-ops', async () => {
    vi.resetModules();
    const getMock = vi.fn().mockResolvedValue({ serviceWorkerAutoSavedBadgeTabs: [1, 2] });
    const setMock = vi.fn().mockResolvedValue(undefined);
    const tabsGetMock = vi.fn(async (tabId: number) => ({ id: tabId }));
    (globalThis as { chrome?: unknown }).chrome = {
      storage: { session: { get: getMock, set: setMock } },
      tabs: { get: tabsGetMock },
    };

    const { createAutoSavedBadgeTabs } = await import('../swStatePersistence.js');
    const badgeTabs = createAutoSavedBadgeTabs({
      exists: async (tabId) => {
        try {
          await chrome.tabs.get(tabId);
          return true;
        } catch {
          return false;
        }
      },
    });

    await badgeTabs.restore();
    expect(tabsGetMock).toHaveBeenCalledTimes(2);

    await badgeTabs.restore();
    await badgeTabs.restore();
    // No re-fan-out on later restores
    expect(tabsGetMock).toHaveBeenCalledTimes(2);
    expect(badgeTabs.restoredOnce()).toBe(true);
  });

  it('resetRestoreOnce re-arms the fan-out (prune-triggering events)', async () => {
    vi.resetModules();
    const getMock = vi.fn().mockResolvedValue({ serviceWorkerAutoSavedBadgeTabs: [7] });
    const setMock = vi.fn().mockResolvedValue(undefined);
    (globalThis as { chrome?: unknown }).chrome = {
      storage: { session: { get: getMock, set: setMock } },
      tabs: { get: vi.fn(async (tabId: number) => ({ id: tabId })) },
    };

    const { createAutoSavedBadgeTabs } = await import('../swStatePersistence.js');
    const badgeTabs = createAutoSavedBadgeTabs();
    await badgeTabs.restore();
    expect(badgeTabs.restoredOnce()).toBe(true);

    badgeTabs.resetRestoreOnce();
    expect(badgeTabs.restoredOnce()).toBe(false);
    await badgeTabs.restore();
    expect(badgeTabs.restoredOnce()).toBe(true);
  });

  it('without the port, restore-once still applies (add-only back-compat)', async () => {
    vi.resetModules();
    const getMock = vi.fn().mockResolvedValue({ serviceWorkerAutoSavedBadgeTabs: [1] });
    const setMock = vi.fn().mockResolvedValue(undefined);
    (globalThis as { chrome?: unknown }).chrome = {
      storage: { session: { get: getMock, set: setMock } },
    };

    const { createAutoSavedBadgeTabs } = await import('../swStatePersistence.js');
    const badgeTabs = createAutoSavedBadgeTabs();
    await badgeTabs.restore();
    await badgeTabs.restore();
    expect(badgeTabs.has(1)).toBe(true);
  });
});
