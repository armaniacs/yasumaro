/**
 * manualContentFetcherPorts.test.ts
 * PBI 2026-10-14-03: ManualContentFetcher must be usable without any chrome
 * global once tab ports are injected (parity with RegenerateContentFetcher).
 */
import { describe, it, expect } from 'vitest';
import { ManualContentFetcher, type ManualTabPorts } from '../manualContentFetcher.js';

function memoryPorts(content: string): ManualTabPorts & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    queryTabs: async () => {
      calls.push('queryTabs');
      return [];
    },
    createTab: async () => {
      calls.push('createTab');
      return { id: 7, url: 'https://example.com' } as chrome.tabs.Tab;
    },
    getTab: async () => {
      calls.push('getTab');
      return { status: 'complete' };
    },
    onUpdated: {
      addListener: (cb) => {
        calls.push('addListener');
        // Complete on the microtask queue: no timers, no real-time waits.
        queueMicrotask(() => cb(7, { status: 'complete' }));
      },
      removeListener: () => {
        calls.push('removeListener');
      },
    },
    executeScript: async () => {
      calls.push('executeScript');
      return content;
    },
    removeTab: async () => {
      calls.push('removeTab');
    },
  };
}

function existingTabPorts(): ManualTabPorts & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    queryTabs: async () => {
      calls.push('queryTabs');
      return [{ id: 3, url: 'https://example.com' } as chrome.tabs.Tab];
    },
    createTab: async () => {
      calls.push('createTab');
      throw new Error('must not create when a tab already exists');
    },
    getTab: async () => {
      calls.push('getTab');
      return { status: 'complete' };
    },
    onUpdated: {
      addListener: () => {},
      removeListener: () => {},
    },
    executeScript: async () => {
      calls.push('executeScript');
      return 'existing-tab-content';
    },
    removeTab: async () => {
      calls.push('removeTab');
    },
  };
}

describe('ManualContentFetcher tab ports', () => {
  it('fetches through injected ports with no chrome global', async () => {
    delete (globalThis as Record<string, unknown>).chrome;
    const ports = memoryPorts('hello');
    const fetcher = new ManualContentFetcher(60_000, 20, ports);
    await expect(fetcher.fetchContent('https://example.com')).resolves.toBe('hello');
    expect(ports.calls).toContain('executeScript');
    // The helper tab it created is cleaned up through the port.
    expect(ports.calls).toContain('removeTab');
  });

  it('reuses an existing tab without creating one', async () => {
    delete (globalThis as Record<string, unknown>).chrome;
    const ports = existingTabPorts();
    const fetcher = new ManualContentFetcher(60_000, 20, ports);
    await expect(fetcher.fetchContent('https://example.com')).resolves.toBe('existing-tab-content');
    expect(ports.calls).not.toContain('createTab');
    // No helper tab was created, so nothing is removed.
    expect(ports.calls).not.toContain('removeTab');
  });
});
