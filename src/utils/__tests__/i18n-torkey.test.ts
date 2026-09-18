// @vitest-environment jsdom
/**
 * i18n-torkey.test.ts
 * PBI 2026-09-18-15: pins tOrKey's contract — key-fallback on missing keys,
 * positional substitutions, and named substitutions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { tOrKey } from '../i18n.js';

describe('tOrKey (PBI 15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.chrome = {
      i18n: {
        getMessage: vi.fn((key: string, substitutions?: string | string[]) => {
          const messages: Record<string, string> = {
            'key.plain': 'Plain text',
            'key.subst': 'Hello {0}',
          };
          return messages[key] || '';
        }),
        getUILanguage: vi.fn(() => 'en'),
      },
    } as unknown as typeof chrome;
  });

  it('returns the translation when present and the key itself when missing', () => {
    expect(tOrKey('key.plain')).toBe('Plain text');
    expect(tOrKey('key.missing')).toBe('key.missing');
  });

  it('passes positional substitutions through to chrome.i18n', () => {
    expect(tOrKey('key.subst', 'World')).toBe('Hello {0}');
    expect(tOrKey('key.subst', ['World'])).toBe('Hello {0}');
  });

  it('falls back to the key when a substituted key is missing', () => {
    expect(tOrKey('key.missing', ['x'])).toBe('key.missing');
  });
});
