import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { CURRENT_PROTOCOL_VERSION } from '../../messaging/protocol.js';
import { logWarn } from '../../utils/logger/api.js';

vi.mock('../../utils/logger/api.js', () => ({ logWarn: vi.fn(() => Promise.resolve()) }));

const LOADER_PATH = '../loader.js';

/**
 * Trust boundary tests for VULN-002.
 * NN08: page markup (data-ow-e2e-test) no longer selects a separate path —
 * every load awaits SW CHECK_DOMAIN when cache is cold (useCache:false).
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
    warnSpy = vi.mocked(logWarn);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (globalThis as any).window = undefined;
    (globalThis as any).document = undefined;
  });

  async function importLoader(url: string, options: { pageMarkup?: boolean } = {}) {
    const dom = new JSDOM('<!DOCTYPE html><html></html>');
    globalThis.window = { location: { href: url }, document: dom.window.document } as any;
    globalThis.document = dom.window.document as any;
    if (options.pageMarkup) dom.window.document.documentElement.setAttribute('data-ow-e2e-test', 'true');
    await import(LOADER_PATH);
    // The loader resolves its admission flow through a dynamic import whose
    // completion has no observable signal, and one macrotask turn is not enough
    // for the whole chain. Known exception; see the ADR's exemption list.
    // eslint-disable-next-line local/no-test-sleep -- dynamic import has no completion signal
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

  describe('page-marked cold cache → SW round-trip', () => {
    it('page-marked load with cold cache (useCache:false) awaits SW CHECK_DOMAIN and imports when allowed', async () => {
      // empty cache → useCache false
      setStorageData({});
      sendMessageSpy.mockResolvedValue({ allowed: true, success: true });
      await importLoader('https://example.com/page', { pageMarkup: true });
      expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'CHECK_DOMAIN', protocolVersion: CURRENT_PROTOCOL_VERSION });
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
      expect(getURLSpy).toHaveBeenCalledWith('content-extractor.js');
    });

    it('page-marked load with cold cache blocks when SW returns allowed:false', async () => {
      setStorageData({});
      sendMessageSpy.mockResolvedValue({ allowed: false });
      await importLoader('https://blocked.example/page', { pageMarkup: true });
      expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'CHECK_DOMAIN', protocolVersion: CURRENT_PROTOCOL_VERSION });
      expect(getURLSpy).not.toHaveBeenCalled();
    });

    it('page-marked load with cold cache retries on reject and blocks after 3 attempts', async () => {
      setStorageData({});
      sendMessageSpy.mockRejectedValue(new Error('SW not ready'));
      await importLoader('https://example.com/page', { pageMarkup: true });
      // The admission ladder sleeps 200/400/600ms between its three attempts.
      // This file mocks Date.now to a fixed epoch, so pairing that with a fake
      // clock leaves the loader's deadlines an epoch apart and advancing the
      // clock stops terminating once the machine is loaded. Known exception;
      // see the ADR's exemption list.
      // eslint-disable-next-line local/no-test-sleep -- real retry ladder, fake clock deadlocks under load
      await new Promise((r) => setTimeout(r, 1500));
      expect(sendMessageSpy).toHaveBeenCalledTimes(3);
      expect(getURLSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[OWeave] Domain check failed: no response from service worker',
        { url: 'https://example.com/page', detail: 'SW not ready' },
        undefined,
        'loader',
      );
    });

    it('page-marked load with hot cache (useCache:true allowed) does NOT call SW', async () => {
      setStorageData({
        domain_filter_cache: [],
        domain_filter_cache_timestamp: 999999,
        domain_filter_mode: 'disabled',
      });
      await importLoader('https://example.com/page', { pageMarkup: true });
      expect(storageGetSpy).toHaveBeenCalled();
      expect(sendMessageSpy).not.toHaveBeenCalled();
      expect(getURLSpy).toHaveBeenCalledWith('content-extractor.js');
    });

    it('page-marked load with hot cache (useCache:true blocked) blocks without SW call', async () => {
      setStorageData({
        domain_filter_cache: ['other.com'],
        domain_filter_cache_timestamp: 999999,
        domain_filter_mode: 'whitelist',
      });
      await importLoader('https://example.com/page', { pageMarkup: true });
      expect(sendMessageSpy).not.toHaveBeenCalled();
      expect(getURLSpy).not.toHaveBeenCalled();
    });

    it('page-marked load with expired cache falls back to SW (uid consistency with normal branch)', async () => {
      setStorageData({
        domain_filter_cache: [],
        domain_filter_cache_timestamp: 1, // expired
        domain_filter_mode: 'disabled',
      });
      sendMessageSpy.mockResolvedValue({ allowed: true });
      await importLoader('https://example.com/page', { pageMarkup: true });
      expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'CHECK_DOMAIN', protocolVersion: CURRENT_PROTOCOL_VERSION });
      expect(getURLSpy).toHaveBeenCalledWith('content-extractor.js');
    });

    it('page-marked load with uBlock enabled (blacklist uBlock) falls back to SW', async () => {
      setStorageData({
        domain_filter_cache: [],
        domain_filter_cache_timestamp: 999999,
        domain_filter_mode: 'blacklist',
        ublock_format_enabled: true,
      });
      sendMessageSpy.mockResolvedValue({ allowed: true });
      await importLoader('https://example.com/page', { pageMarkup: true });
      expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'CHECK_DOMAIN', protocolVersion: CURRENT_PROTOCOL_VERSION });
      expect(getURLSpy).toHaveBeenCalledWith('content-extractor.js');
    });
  });

  describe('protocolVersion invariant', () => {
    it('marked and unmarked loads both send CURRENT_PROTOCOL_VERSION', async () => {
      setStorageData({});
      sendMessageSpy.mockResolvedValue({ allowed: true });
      await importLoader('https://example.com/page', { pageMarkup: true });
      expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'CHECK_DOMAIN', protocolVersion: CURRENT_PROTOCOL_VERSION });

      // reset for unmarked load
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
      // Same exemption as importLoader: the normal-branch import has no
      // observable completion signal.
      // eslint-disable-next-line local/no-test-sleep -- dynamic import has no completion signal
      await new Promise((r) => setTimeout(r, 50));
      expect(sendMessageSpy).toHaveBeenCalledWith({ type: 'CHECK_DOMAIN', protocolVersion: CURRENT_PROTOCOL_VERSION });
    });
  });
});
