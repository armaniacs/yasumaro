/**
 * manualContentFetcher.branches.test.ts
 * Branch-coverage focused tests for ManualContentFetcher
 * (sanitization fallbacks, TTL expiry, and injected func execution).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSanitizeRegex = vi.fn();
vi.mock('../../utils/piiSanitizer.js', () => ({
  sanitizeRegex: (...args: unknown[]) => mockSanitizeRegex(...args),
}));

import { ManualContentFetcher } from '../manualContentFetcher.js';

const mockScriptResult = 'Extracted page content';

type ExecuteScriptOptions = {
  target: { tabId: number };
  func: (...args: unknown[]) => unknown;
  args: unknown[];
};

function setupChromeMock(executeScriptImpl?: (opts: ExecuteScriptOptions) => Promise<unknown>): void {
  (globalThis as Record<string, unknown>).chrome = {
    tabs: {
      query: vi.fn(() => Promise.resolve([])),
      create: vi.fn(() => Promise.resolve({ id: 999, url: 'https://example.com' })),
      remove: vi.fn(() => Promise.resolve()),
      onUpdated: {
        addListener: vi.fn((cb: (tabId: number, info: { status?: string }) => void) => {
          setTimeout(() => cb(999, { status: 'complete' }), 0);
        }),
        removeListener: vi.fn(),
      },
    },
    scripting: {
      executeScript: executeScriptImpl ?? vi.fn(() => Promise.resolve([{ result: mockScriptResult }])),
    },
  };
}

function setDocumentStub(body: unknown): void {
  (globalThis as Record<string, unknown>).document = { body };
}

function deleteDocumentStub(): void {
  delete (globalThis as Record<string, unknown>).document;
}

describe('ManualContentFetcher - branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSanitizeRegex.mockReset();
    mockSanitizeRegex.mockResolvedValue({ text: mockScriptResult });
  });

  it('returns raw content when sanitization yields empty text', async () => {
    setupChromeMock();
    mockSanitizeRegex.mockResolvedValue({ text: '' });

    const fetcher = new ManualContentFetcher();
    const content = await fetcher.fetchContent('https://example.com');
    expect(content).toBe(mockScriptResult);
  });

  it('returns raw content when sanitization fails', async () => {
    setupChromeMock();
    mockSanitizeRegex.mockRejectedValue(new Error('sanitizer crash'));

    const fetcher = new ManualContentFetcher();
    const content = await fetcher.fetchContent('https://example.com');
    expect(content).toBe(mockScriptResult);
  });

  it('re-fetches from a new tab when the cache entry has expired', async () => {
    setupChromeMock();
    const fetcher = new ManualContentFetcher(1000, 10);
    await fetcher.fetchContent('https://example.com');
    expect(fetcher.getCacheSize()).toBe(1);

    const createFn = (chrome.tabs.create as ReturnType<typeof vi.fn>);
    createFn.mockClear();

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5000);
    try {
      const content = await fetcher.fetchContent('https://example.com');
      expect(content).toBe(mockScriptResult);
      expect(fetcher.getCacheSize()).toBe(1);
      expect(createFn).toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('returns empty string when the page has no body', async () => {
    setupChromeMock(
      vi.fn(async (opts: ExecuteScriptOptions) => [{ result: await opts.func(...opts.args) }])
    );
    setDocumentStub(null);
    try {
      const fetcher = new ManualContentFetcher();
      const content = await fetcher.fetchContent('https://example.com');
      expect(content).toBe('');
      expect(fetcher.getCacheSize()).toBe(0);
    } finally {
      deleteDocumentStub();
    }
  });

  it('extracts text from the cloned page body', async () => {
    setupChromeMock(
      vi.fn(async (opts: ExecuteScriptOptions) => [{ result: await opts.func(...opts.args) }])
    );
    setDocumentStub({
      cloneNode: () => ({
        querySelectorAll: () => ({ forEach: () => {} }),
        innerText: '  page text  ',
      }),
    });
    try {
      mockSanitizeRegex.mockImplementation(async (text: string) => ({ text }));
      const fetcher = new ManualContentFetcher();
      const content = await fetcher.fetchContent('https://example.com');
      expect(content).toBe('page text');
      expect(fetcher.getCacheSize()).toBe(1);
    } finally {
      deleteDocumentStub();
    }
  });

  it('returns empty string when the extracted text is empty', async () => {
    setupChromeMock(
      vi.fn(async (opts: ExecuteScriptOptions) => [{ result: await opts.func(...opts.args) }])
    );
    setDocumentStub({
      cloneNode: () => ({
        querySelectorAll: () => ({ forEach: () => {} }),
        innerText: '',
      }),
    });
    try {
      const fetcher = new ManualContentFetcher();
      const content = await fetcher.fetchContent('https://example.com');
      expect(content).toBe('');
    } finally {
      deleteDocumentStub();
    }
  });

  it('returns empty string when executeScript returns no results', async () => {
    setupChromeMock(vi.fn(() => Promise.resolve([])));

    const fetcher = new ManualContentFetcher();
    const content = await fetcher.fetchContent('https://example.com');
    expect(content).toBe('');
  });

  it('returns empty string when executeScript resolves undefined', async () => {
    setupChromeMock(vi.fn(() => Promise.resolve(undefined)));

    const fetcher = new ManualContentFetcher();
    const content = await fetcher.fetchContent('https://example.com');
    expect(content).toBe('');
  });
});
