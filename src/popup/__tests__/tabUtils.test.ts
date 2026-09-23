import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getCurrentTab,
  getActiveTabUrl,
  getActiveTabDomain,
  getDomainForUrl,
  requireActiveTabUrl,
} from '../tabUtils.js';

const mockQuery = vi.fn();
vi.stubGlobal('chrome', {
  tabs: {
    query: mockQuery,
  },
});

beforeEach(() => {
  mockQuery.mockReset();
  vi.stubGlobal('chrome', { tabs: { query: mockQuery } });
});

describe('getCurrentTab', () => {
  it('returns tab when query succeeds', async () => {
    const tab = { id: 1, url: 'https://example.com' } as chrome.tabs.Tab;
    mockQuery.mockResolvedValue([tab]);
    const result = await getCurrentTab();
    expect(result).toEqual(tab);
  });

  it('returns null when no tabs found', async () => {
    mockQuery.mockResolvedValue([]);
    const result = await getCurrentTab();
    expect(result).toBeNull();
  });

  it('returns null when chrome.tabs is unavailable', async () => {
    vi.stubGlobal('chrome', {});
    const result = await getCurrentTab();
    expect(result).toBeNull();
    vi.stubGlobal('chrome', { tabs: { query: mockQuery } });
  });

  it('queries with the single canonical flag set', async () => {
    mockQuery.mockResolvedValue([]);
    await getCurrentTab();
    expect(mockQuery).toHaveBeenCalledWith({ active: true, currentWindow: true });
  });
});

describe('getActiveTabUrl', () => {
  it('returns the tab url', async () => {
    mockQuery.mockResolvedValue([{ id: 1, url: 'https://example.com/page' }]);
    await expect(getActiveTabUrl()).resolves.toBe('https://example.com/page');
  });

  it('returns null when there is no tab', async () => {
    mockQuery.mockResolvedValue([]);
    await expect(getActiveTabUrl()).resolves.toBeNull();
  });

  it('returns null when the tab has no url', async () => {
    mockQuery.mockResolvedValue([{ id: 2 }]);
    await expect(getActiveTabUrl()).resolves.toBeNull();
  });
});

describe('getDomainForUrl', () => {
  it('normalizes via the shared extractor (strips www)', () => {
    expect(getDomainForUrl('https://www.example.com/page')).toBe('example.com');
  });

  it('returns null for missing input', () => {
    expect(getDomainForUrl(null)).toBeNull();
    expect(getDomainForUrl(undefined)).toBeNull();
    expect(getDomainForUrl('')).toBeNull();
  });

  it('returns null for unparseable input instead of throwing', () => {
    expect(getDomainForUrl('not a url')).toBeNull();
  });
});

describe('getActiveTabDomain', () => {
  it('returns the normalized domain', async () => {
    mockQuery.mockResolvedValue([{ id: 1, url: 'https://www.example.com/page' }]);
    await expect(getActiveTabDomain()).resolves.toBe('example.com');
  });

  it('returns null when there is no tab url', async () => {
    mockQuery.mockResolvedValue([]);
    await expect(getActiveTabDomain()).resolves.toBeNull();
  });

  it('returns null for an unparseable tab url instead of throwing', async () => {
    mockQuery.mockResolvedValue([{ id: 1, url: 'not a url' }]);
    await expect(getActiveTabDomain()).resolves.toBeNull();
  });
});

describe('requireActiveTabUrl', () => {
  it('resolves the url when present', async () => {
    mockQuery.mockResolvedValue([{ id: 1, url: 'https://example.com/' }]);
    await expect(requireActiveTabUrl()).resolves.toBe('https://example.com/');
  });

  it('throws when there is no tab url', async () => {
    mockQuery.mockResolvedValue([]);
    await expect(requireActiveTabUrl()).rejects.toThrow('No active tab URL');
  });
});
