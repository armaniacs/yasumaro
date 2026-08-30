import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { CURRENT_PROTOCOL_VERSION } from '../../background/messageTypes.js';

const LOADER_PATH = '../loader.js';

/**
 * Trust boundary tests for VULN-002.
 * e2e path (data-ow-e2e-test) must also await SW CHECK_DOMAIN when cache is cold (useCache:false).
 */
describe('loader.ts - trust boundary (VULN-002/06a)', () => {
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
    globalThis.window = { location: { href: url }, document: dom.window.document } as any;
    globalThis.document = dom.window.document as any;
    if (options.e2eTest) dom.window.document.documentElement.setAttribute('data-ow-e2e-test', 'true');
    await import(LOADER_PATH);
    await new Promise((r) => setTimeout(r, 50));
  }

  function setStorageData(data: Record<string, unknown>) {
    storageGetSpy.mockImplementation(async (keys: string | string[] | null | undefined) => {
      const result: Record<string, unknown> = {};
      if (Array.isArray(keys)) keys.forEach((key: string) => { if (key in data) result[key] = data[key]; });
      else if (typeof keys === 'string' && keys in data) result[keys] = data[keys];
      return result;
    });
  }

  describe('e2e cold cache → SW round-trip', () => {
    it('e2e with cold cache (useCache:false) awaits SW CHECK_DOMAIN and imports when allowed', async () => {
      // empty cache → useCache false
      setStorageData({});
      sendMessageSpy.mockResolvedValue({ allowed: true, success: true });
      await importLoader('https://example.com/page', { e2eTest: true });
      expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'CHECK_DOMAIN', protocolVersion: CURRENT_PROTOCOL_VERSION });
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(getURLSpy).toHaveBeenCalledWith('content-extractor.js');
    });

    it('e2e with cold cache blocks when SW returns allowed:false', async () => {
      setStorageData({});
      sendMessageSpy.mockResolvedValue({ allowed: false });
      await importLoader('https://blocked.example/page', { e2eTest: true });
      expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'CHECK_DOMAIN', protocolVersion: CURRENT_PROTOCOL_VERSION });
      expect(getURLSpy).not.toHaveBeenCalled();
    });

    it('e2e with cold cache retries on reject and blocks after 3 attempts', async () => {
      setStorageData({});
      sendMessageSpy.mockRejectedValue(new Error('SW not ready'));
      await importLoader('https://example.com/page', { e2eTest: true });
      // allow retry backoff (200+400+600) within the helper's 50ms? loader does retries sequentially,
      // the helper waits 50ms after import, then we need extra time
      await new Promise((r) => setTimeout(r, 1500));
      expect(sendMessageSpy).toHaveBeenCalledTimes(3);
      expect(getURLSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[OWeave] Domain check failed: no response from service worker',
        'https://example.com/page',
        'SW not ready',
      );
    });

    it('e2e with hot cache (useCache:true allowed) does NOT call SW', async () => {
      setStorageData({
        domain_filter_cache: [],
        domain_filter_cache_timestamp: 999999,
        domain_filter_mode: 'disabled',
      });
      await importLoader('https://example.com/page', { e2eTest: true });
      expect(storageGetSpy).toHaveBeenCalled();
      expect(sendMessageSpy).not.toHaveBeenCalled();
      expect(getURLSpy).toHaveBeenCalledWith('content-extractor.js');
    });

    it('e2e with hot cache (useCache:true blocked) blocks without SW call', async () => {
      setStorageData({
        domain_filter_cache: ['other.com'],
        domain_filter_cache_timestamp: 999999,
        domain_filter_mode: 'whitelist',
      });
      await importLoader('https://example.com/page', { e2eTest: true });
      expect(sendMessageSpy).not.toHaveBeenCalled();
      expect(getURLSpy).not.toHaveBeenCalled();
    });

    it('e2e with expired cache falls back to SW (uid consistency with normal branch)', async () => {
      setStorageData({
        domain_filter_cache: [],
        domain_filter_cache_timestamp: 1, // expired
        domain_filter_mode: 'disabled',
      });
      sendMessageSpy.mockResolvedValue({ allowed: true });
      await importLoader('https://example.com/page', { e2eTest: true });
      expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'CHECK_DOMAIN', protocolVersion: CURRENT_PROTOCOL_VERSION });
      expect(getURLSpy).toHaveBeenCalledWith('content-extractor.js');
    });

    it('e2e with uBlock enabled (blacklist uBlock) falls back to SW', async () => {
      setStorageData({
        domain_filter_cache: [],
        domain_filter_cache_timestamp: 999999,
        domain_filter_mode: 'blacklist',
        ublock_format_enabled: true,
      });
      sendMessageSpy.mockResolvedValue({ allowed: true });
      await importLoader('https://example.com/page', { e2eTest: true });
      expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'CHECK_DOMAIN', protocolVersion: CURRENT_PROTOCOL_VERSION });
      expect(getURLSpy).toHaveBeenCalledWith('content-extractor.js');
    });
  });

  describe('protocolVersion invariant', () => {
    it('both branches send CURRENT_PROTOCOL_VERSION', async () => {
      setStorageData({});
      sendMessageSpy.mockResolvedValue({ allowed: true });
      await importLoader('https://example.com/page', { e2eTest: true });
      expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'CHECK_DOMAIN', protocolVersion: CURRENT_PROTOCOL_VERSION });

      // reset for normal branch
      vi.resetModules();
      vi.clearAllMocks();
      vi.spyOn(Date, 'now').mockReturnValue(1000000);
      getURLSpy = vi.spyOn((globalThis as any).chrome.runtime, 'getURL');
      storageGetSpy = vi.spyOn((globalThis as any).chrome.storage.local, 'get');
      const cleanSendMessage = vi.fn().mockResolvedValue({ allowed: true });
      (globalThis as any).chrome.runtime.sendMessage = cleanSendMessage;
      sendMessageSpy = cleanSendMessage;
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      storageGetSpy.mockImplementation(async () => ({}));
      const dom = new JSDOM('<!DOCTYPE html><html></html>');
      globalThis.window = { location: { href: 'https://example.com/normal' }, document: dom.window.document } as any;
      globalThis.document = dom.window.document as any;
      await import(LOADER_PATH);
      await new Promise((r) => setTimeout(r, 50));
      expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'CHECK_DOMAIN', protocolVersion: CURRENT_PROTOCOL_VERSION });
    });
  });
});
