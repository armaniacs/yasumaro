import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isMobileUserAgent, getPlatformOs, resetPlatformOsCache } from '../deviceUtils.js';

describe('isMobileUserAgent', () => {
  it('returns true for Android Chrome', () => {
    expect(isMobileUserAgent('Mozilla/5.0 (Linux; Android 10; SM-G960U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36')).toBe(true);
  });

  it('returns true for iPhone Safari', () => {
    expect(isMobileUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1')).toBe(true);
  });

  it('returns true for iPad', () => {
    expect(isMobileUserAgent('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1')).toBe(true);
  });

  it('returns false for desktop Chrome', () => {
    expect(isMobileUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isMobileUserAgent('')).toBe(false);
  });
});

describe('getPlatformOs', () => {
  const originalNavigator = globalThis.navigator;
  const originalChrome = (globalThis as any).chrome;

  beforeEach(() => {
    resetPlatformOsCache();
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: '' },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    resetPlatformOsCache();
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
    (globalThis as any).chrome = originalChrome;
  });

  it('returns cached value on subsequent calls', () => {
    (globalThis as any).chrome = undefined;
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Macintosh' },
      configurable: true,
      writable: true,
    });
    expect(getPlatformOs()).toBe('mac');
    expect(getPlatformOs()).toBe('mac');
  });

  it('detects android from user agent', () => {
    (globalThis as any).chrome = undefined;
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Android' },
      configurable: true,
      writable: true,
    });
    expect(getPlatformOs()).toBe('android');
  });

  it('detects ios from user agent', () => {
    (globalThis as any).chrome = undefined;
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'iPhone' },
      configurable: true,
      writable: true,
    });
    expect(getPlatformOs()).toBe('ios');
  });

  it('detects windows from user agent', () => {
    (globalThis as any).chrome = undefined;
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Windows' },
      configurable: true,
      writable: true,
    });
    expect(getPlatformOs()).toBe('win');
  });

  it('detects chromebook from user agent', () => {
    (globalThis as any).chrome = undefined;
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'CrOS' },
      configurable: true,
      writable: true,
    });
    expect(getPlatformOs()).toBe('cros');
  });

  it('detects linux from user agent', () => {
    (globalThis as any).chrome = undefined;
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Linux' },
      configurable: true,
      writable: true,
    });
    expect(getPlatformOs()).toBe('linux');
  });

  it('returns unknown for unrecognized user agent', () => {
    (globalThis as any).chrome = undefined;
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'SomeUnknownDevice' },
      configurable: true,
      writable: true,
    });
    expect(getPlatformOs()).toBe('unknown');
  });

  it('calls chrome.runtime.getPlatformInfo when available', () => {
    const getPlatformInfo = vi.fn(() => Promise.resolve({ os: 'win' }));
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: '' },
      configurable: true,
      writable: true,
    });
    (globalThis as any).chrome = {
      runtime: { getPlatformInfo },
    };

    getPlatformOs();
    expect(getPlatformInfo).toHaveBeenCalledTimes(1);
  });

  it('does not create multiple promises on repeated calls', () => {
    const getPlatformInfo = vi.fn(() => Promise.resolve({ os: 'mac' }));
    (globalThis as any).chrome = {
      runtime: { getPlatformInfo },
    };

    getPlatformOs();
    getPlatformOs();
    expect(getPlatformInfo).toHaveBeenCalledTimes(1);
  });

  it('falls back to user agent when chrome runtime is unavailable', () => {
    (globalThis as any).chrome = undefined;
    Object.defineProperty(globalThis, 'navigator', {
      value: { userAgent: 'Windows' },
      configurable: true,
      writable: true,
    });

    expect(getPlatformOs()).toBe('win');
  });
});
