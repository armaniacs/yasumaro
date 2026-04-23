import { describe, it, expect, vi } from 'vitest';
import { getCurrentTab, isRecordable } from '../tabUtils.js';

const mockQuery = vi.fn();
vi.stubGlobal('chrome', {
  tabs: {
    query: mockQuery,
  },
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
});

describe('isRecordable', () => {
  it('returns true for http URL', () => {
    expect(isRecordable({ url: 'http://example.com' } as chrome.tabs.Tab)).toBe(true);
  });

  it('returns true for https URL', () => {
    expect(isRecordable({ url: 'https://example.com' } as chrome.tabs.Tab)).toBe(true);
  });

  it('returns false for chrome URL', () => {
    expect(isRecordable({ url: 'chrome://extensions' } as chrome.tabs.Tab)).toBe(false);
  });

  it('returns false for null tab', () => {
    expect(isRecordable(null)).toBe(false);
  });

  it('returns false for undefined tab', () => {
    expect(isRecordable(undefined)).toBe(false);
  });
});
