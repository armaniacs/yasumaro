import { describe, it, expect } from 'vitest';
import { isMobileUserAgent } from '../deviceUtils.js';

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
