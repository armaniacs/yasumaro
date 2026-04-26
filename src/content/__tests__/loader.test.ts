import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const LOADER_PATH = '../loader.js';

describe('loader.ts', () => {
  let getURLSpy: ReturnType<typeof vi.spyOn>;
  let storageGetSpy: ReturnType<typeof vi.spyOn>;
  let sendMessageSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(1000000);

    getURLSpy = vi.spyOn((globalThis as any).chrome.runtime, 'getURL');
    storageGetSpy = vi.spyOn((globalThis as any).chrome.storage.local, 'get');
    // Ensure a clean sendMessage mock so previous test mutations don't leak
    const cleanSendMessage = vi.fn();
    (globalThis as any).chrome.runtime.sendMessage = cleanSendMessage;
    sendMessageSpy = cleanSendMessage;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (globalThis as any).window = undefined;
    (globalThis as any).document = undefined;
  });

  async function importLoader(url: string, options: { e2eTest?: boolean } = {}) {
    const dom = new JSDOM('<!DOCTYPE html><html></html>');
    globalThis.window = {
      location: { href: url },
      document: dom.window.document,
    } as any;
    globalThis.document = dom.window.document as any;
    if (options.e2eTest) {
      dom.window.document.documentElement.setAttribute('data-ow-e2e-test', 'true');
    }
    await import(LOADER_PATH);
    // Allow microtasks and the async IIFE to progress
    await new Promise((r) => setTimeout(r, 50));
  }

  function setStorageData(data: Record<string, unknown>) {
    storageGetSpy.mockImplementation(async (keys: string | string[] | null | undefined) => {
      const result: Record<string, unknown> = {};
      if (Array.isArray(keys)) {
        keys.forEach((key: string) => {
          if (key in data) {
            result[key] = data[key];
          }
        });
      } else if (typeof keys === 'string' && keys in data) {
        result[keys] = data[keys];
      }
      return result;
    });
  }

  describe('URL filtering', () => {
    it('skips chrome:// URLs', async () => {
      await importLoader('chrome://extensions/');
      expect(getURLSpy).not.toHaveBeenCalled();
      expect(storageGetSpy).not.toHaveBeenCalled();
    });

    it('skips chrome-extension:// URLs', async () => {
      await importLoader('chrome-extension://abc123/popup.html');
      expect(getURLSpy).not.toHaveBeenCalled();
      expect(storageGetSpy).not.toHaveBeenCalled();
    });

    it('skips about:blank', async () => {
      await importLoader('about:blank');
      expect(getURLSpy).not.toHaveBeenCalled();
      expect(storageGetSpy).not.toHaveBeenCalled();
    });

    it('skips data: URLs', async () => {
      await importLoader('data:text/html,<h1>test</h1>');
      expect(getURLSpy).not.toHaveBeenCalled();
      expect(storageGetSpy).not.toHaveBeenCalled();
    });

    it('skips file:// URLs', async () => {
      await importLoader('file:///Users/test/index.html');
      expect(getURLSpy).not.toHaveBeenCalled();
      expect(storageGetSpy).not.toHaveBeenCalled();
    });

    it('skips empty URLs', async () => {
      await importLoader('');
      expect(getURLSpy).not.toHaveBeenCalled();
      expect(storageGetSpy).not.toHaveBeenCalled();
    });

    it('allows https URLs to proceed', async () => {
      setStorageData({
        domain_filter_cache: [],
        domain_filter_cache_timestamp: 999999,
        domain_filter_mode: 'disabled',
      });
      await importLoader('https://example.com/article');
      expect(storageGetSpy).toHaveBeenCalled();
      expect(getURLSpy).toHaveBeenCalledWith('content-extractor.js');
    });
  });

  describe('E2E bypass', () => {
    it('bypasses domain filter when data-ow-e2e-test is present', async () => {
      await importLoader('https://example.com/page', { e2eTest: true });
      expect(getURLSpy).toHaveBeenCalledWith('content-extractor.js');
      expect(storageGetSpy).not.toHaveBeenCalled();
      expect(sendMessageSpy).not.toHaveBeenCalled();
    });
  });

  describe('domain filter cache - disabled mode', () => {
    it('allows all domains when cache is valid and mode is disabled', async () => {
      setStorageData({
        domain_filter_cache: [],
        domain_filter_cache_timestamp: 999999,
        domain_filter_mode: 'disabled',
      });
      await importLoader('https://example.com/page');
      expect(sendMessageSpy).not.toHaveBeenCalled();
      expect(getURLSpy).toHaveBeenCalledWith('content-extractor.js');
    });
  });

  describe('domain filter cache - whitelist mode', () => {
    it('allows domain when it is in the whitelist', async () => {
      setStorageData({
        domain_filter_cache: ['example.com'],
        domain_filter_cache_timestamp: 999999,
        domain_filter_mode: 'whitelist',
      });
      await importLoader('https://example.com/page');
      expect(getURLSpy).toHaveBeenCalledWith('content-extractor.js');
      expect(sendMessageSpy).not.toHaveBeenCalled();
    });

    it('blocks domain when it is NOT in the whitelist', async () => {
      setStorageData({
        domain_filter_cache: ['other.com'],
        domain_filter_cache_timestamp: 999999,
        domain_filter_mode: 'whitelist',
      });
      await importLoader('https://example.com/page');
      expect(getURLSpy).not.toHaveBeenCalled();
      expect(sendMessageSpy).not.toHaveBeenCalled();
    });

    it('blocks all domains when whitelist is empty', async () => {
      setStorageData({
        domain_filter_cache: [],
        domain_filter_cache_timestamp: 999999,
        domain_filter_mode: 'whitelist',
      });
      await importLoader('https://example.com/page');
      expect(getURLSpy).not.toHaveBeenCalled();
      expect(sendMessageSpy).not.toHaveBeenCalled();
    });

    it('matches wildcard patterns in whitelist', async () => {
      setStorageData({
        domain_filter_cache: ['*.example.com'],
        domain_filter_cache_timestamp: 999999,
        domain_filter_mode: 'whitelist',
      });
      await importLoader('https://sub.example.com/page');
      expect(getURLSpy).toHaveBeenCalledWith('content-extractor.js');
    });

    it('strips www. prefix when matching whitelist', async () => {
      setStorageData({
        domain_filter_cache: ['example.com'],
        domain_filter_cache_timestamp: 999999,
        domain_filter_mode: 'whitelist',
      });
      await importLoader('https://www.example.com/page');
      expect(getURLSpy).toHaveBeenCalledWith('content-extractor.js');
    });
  });

  describe('domain filter cache - blacklist mode', () => {
    it('falls back to background check when uBlock format is enabled', async () => {
      setStorageData({
        domain_filter_cache: [],
        domain_filter_cache_timestamp: 999999,
        domain_filter_mode: 'blacklist',
        ublock_format_enabled: true,
      });
      sendMessageSpy.mockResolvedValue({ allowed: true });
      await importLoader('https://example.com/page');
      expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'CHECK_DOMAIN' });
      expect(getURLSpy).toHaveBeenCalledWith('content-extractor.js');
    });

    it('blocks domain when simple blacklist matches', async () => {
      setStorageData({
        domain_filter_cache: [],
        domain_filter_cache_timestamp: 999999,
        domain_filter_mode: 'blacklist',
        simple_format_enabled: true,
        domain_blacklist: ['example.com'],
      });
      await importLoader('https://example.com/page');
      expect(getURLSpy).not.toHaveBeenCalled();
      expect(sendMessageSpy).not.toHaveBeenCalled();
    });

    it('allows domain when simple blacklist does not match', async () => {
      setStorageData({
        domain_filter_cache: [],
        domain_filter_cache_timestamp: 999999,
        domain_filter_mode: 'blacklist',
        simple_format_enabled: true,
        domain_blacklist: ['other.com'],
      });
      await importLoader('https://example.com/page');
      expect(getURLSpy).toHaveBeenCalledWith('content-extractor.js');
      expect(sendMessageSpy).not.toHaveBeenCalled();
    });

    it('allows all domains when both formats are disabled', async () => {
      setStorageData({
        domain_filter_cache: [],
        domain_filter_cache_timestamp: 999999,
        domain_filter_mode: 'blacklist',
        simple_format_enabled: false,
        ublock_format_enabled: false,
      });
      await importLoader('https://example.com/page');
      expect(getURLSpy).toHaveBeenCalledWith('content-extractor.js');
      expect(sendMessageSpy).not.toHaveBeenCalled();
    });
  });

  describe('unknown filter mode', () => {
    it('defaults to allowed for unrecognized mode', async () => {
      setStorageData({
        domain_filter_cache: [],
        domain_filter_cache_timestamp: 999999,
        domain_filter_mode: 'unknown_mode',
      });
      await importLoader('https://example.com/page');
      expect(getURLSpy).toHaveBeenCalledWith('content-extractor.js');
      expect(sendMessageSpy).not.toHaveBeenCalled();
    });
  });

  describe('cache miss / expired', () => {
    it('falls back to background check when cache is missing', async () => {
      setStorageData({});
      sendMessageSpy.mockResolvedValue({ allowed: true });
      await importLoader('https://example.com/page');
      expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'CHECK_DOMAIN' });
      expect(getURLSpy).toHaveBeenCalledWith('content-extractor.js');
    });

    it('falls back to background check when cache is expired', async () => {
      setStorageData({
        domain_filter_cache: [],
        domain_filter_cache_timestamp: 1,
        domain_filter_mode: 'disabled',
      });
      sendMessageSpy.mockResolvedValue({ allowed: true });
      await importLoader('https://example.com/page');
      expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'CHECK_DOMAIN' });
      expect(getURLSpy).toHaveBeenCalledWith('content-extractor.js');
    });

    it('blocks domain when background check returns allowed=false', async () => {
      setStorageData({});
      sendMessageSpy.mockResolvedValue({ allowed: false });
      await importLoader('https://example.com/page');
      expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'CHECK_DOMAIN' });
      expect(getURLSpy).not.toHaveBeenCalled();
    });

    it('blocks domain when background check returns no response and logs warning', async () => {
      setStorageData({});
      // Default mock returns undefined (no Promise) → 3 immediate retries, no delay
      await importLoader('https://example.com/page');
      expect(sendMessageSpy).toHaveBeenCalledTimes(3);
      expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'CHECK_DOMAIN' });
      expect(getURLSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[OWeave] Domain check failed: no response from service worker',
        'https://example.com/page',
        'unknown',
      );
    });

    it('blocks domain after retries when sendMessage rejects', async () => {
      setStorageData({});
      sendMessageSpy.mockRejectedValue(new Error('Connection failed'));
      await importLoader('https://example.com/page');
      // Need extra time for retry backoff (200 + 400 + 600ms)
      await new Promise((r) => setTimeout(r, 1500));
      expect(sendMessageSpy).toHaveBeenCalledTimes(3);
      expect(getURLSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[OWeave] Domain check failed: no response from service worker',
        'https://example.com/page',
        'Connection failed',
      );
    });
  });

  describe('edge cases', () => {
    it('handles invalid URL gracefully', async () => {
      setStorageData({
        domain_filter_cache: [],
        domain_filter_cache_timestamp: 999999,
        domain_filter_mode: 'disabled',
      });
      await importLoader('not-a-valid-url');
      // extractDomain returns null → allowed: false, useCache: true
      expect(getURLSpy).not.toHaveBeenCalled();
    });

    it('handles URL with port correctly', async () => {
      setStorageData({
        domain_filter_cache: ['localhost'],
        domain_filter_cache_timestamp: 999999,
        domain_filter_mode: 'whitelist',
      });
      await importLoader('http://localhost:3000/page');
      expect(getURLSpy).toHaveBeenCalledWith('content-extractor.js');
    });
  });

  describe('IIFE guard conditions', () => {
    it('does not execute IIFE when chrome.runtime.getURL is missing', async () => {
      const origGetURL = (globalThis as any).chrome.runtime.getURL;
      (globalThis as any).chrome.runtime.getURL = undefined;
      const dom = new JSDOM('<!DOCTYPE html><html></html>');
      globalThis.window = {
        location: { href: 'https://example.com/page' },
        document: dom.window.document,
      } as any;
      globalThis.document = dom.window.document as any;
      await import(LOADER_PATH);
      await new Promise((r) => setTimeout(r, 50));
      (globalThis as any).chrome.runtime.getURL = origGetURL;
      expect(getURLSpy).not.toHaveBeenCalled();
    });

    it('does not execute IIFE when window is undefined', async () => {
      const origWindow = (globalThis as any).window;
      (globalThis as any).window = undefined;
      await import(LOADER_PATH);
      await new Promise((r) => setTimeout(r, 50));
      globalThis.window = origWindow;
      expect(getURLSpy).not.toHaveBeenCalled();
    });
  });

  describe('dynamic import catch with non-Error', () => {
    it('handles non-Error thrown from e2e dynamic import', async () => {
      const dom = new JSDOM('<!DOCTYPE html><html></html>');
      globalThis.window = {
        location: { href: 'https://example.com/page' },
        document: dom.window.document,
      } as any;
      globalThis.document = dom.window.document as any;
      dom.window.document.documentElement.setAttribute('data-ow-e2e-test', 'true');
      getURLSpy.mockReturnValue('data:text/javascript,throw "string error"');
      await import(LOADER_PATH);
      await new Promise((r) => setTimeout(r, 50));
      expect(warnSpy).toHaveBeenCalledWith(
        '[OWeave] Dynamic import blocked (e2e)',
        'https://example.com/page',
        'string error',
      );
    });

    it('handles non-Error thrown from cache-hit dynamic import', async () => {
      setStorageData({
        domain_filter_cache: [],
        domain_filter_cache_timestamp: 999999,
        domain_filter_mode: 'disabled',
      });
      getURLSpy.mockReturnValue('data:text/javascript,throw "string error"');
      await importLoader('https://example.com/page');
      expect(warnSpy).toHaveBeenCalledWith(
        '[OWeave] Dynamic import blocked',
        'https://example.com/page',
        'string error',
      );
    });

    it('handles non-Error thrown from background-check dynamic import', async () => {
      setStorageData({});
      sendMessageSpy.mockResolvedValue({ allowed: true });
      getURLSpy.mockReturnValue('data:text/javascript,throw "string error"');
      await importLoader('https://example.com/page');
      expect(warnSpy).toHaveBeenCalledWith(
        '[OWeave] Dynamic import blocked',
        'https://example.com/page',
        'string error',
      );
    });
  });
});
