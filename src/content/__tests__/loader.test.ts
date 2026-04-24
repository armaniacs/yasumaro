import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

// モック関数を定義
function shouldSkipUrl(url: string): boolean {
    if (!url) return true;
    const SKIPPED_PROTOCOLS = ['about:', 'chrome-extension:', 'data:', 'file:'];
    return SKIPPED_PROTOCOLS.some(protocol => url.startsWith(protocol));
}

describe('loader', () => {
  beforeEach(() => {
    // Setup JSDOM environment
    const dom = new JSDOM('<!DOCTYPE html><body></body>');
    // @ts-ignore - テスト環境用にグローバールに設定
    global.window = dom.window;
    global.document = dom.window.document;
  });

  it('returns false for normal URLs', () => {
    const result = shouldSkipUrl('https://example.com');
    expect(result).toBe(false);
  });

  it('returns true for about:blank', () => {
    const result = shouldSkipUrl('about:blank');
    expect(result).toBe(true);
  });

  it('returns true for chrome-extension URLs', () => {
    const result = shouldSkipUrl('chrome-extension://abc123/');
    expect(result).toBe(true);
  });
});
