/**
 * generateId.test.ts
 * Unit pins for the shared ID generator (PBI 2026-10-03-24): randomUUID
 * preference, the unified 32-char hex fallback, and the hasSecureRandom()
 * gate the fail-closed confirm-token path pairs with it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateId, hasSecureRandom } from '../generateId.js';

const FIXED = '11111111-2222-4333-8444-555555555555';

describe('generateId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the exact crypto.randomUUID value when available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => FIXED });
    expect(generateId()).toBe(FIXED);
  });

  it('falls back to 32-char hex from getRandomValues when randomUUID is missing', () => {
    const realCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) });
    expect(generateId()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('never uses Math.random', () => {
    const mathRandomSpy = vi.spyOn(Math, 'random');
    generateId();
    expect(mathRandomSpy).not.toHaveBeenCalled();
    mathRandomSpy.mockRestore();
  });

  it('issues unique values across calls', () => {
    expect(generateId()).not.toBe(generateId());
  });
});

describe('hasSecureRandom', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is true when only randomUUID exists', () => {
    vi.stubGlobal('crypto', { randomUUID: () => FIXED });
    expect(hasSecureRandom()).toBe(true);
  });

  it('is true when only getRandomValues exists', () => {
    const realCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) });
    expect(hasSecureRandom()).toBe(true);
  });

  it('is false when crypto is absent', () => {
    vi.stubGlobal('crypto', undefined);
    expect(hasSecureRandom()).toBe(false);
  });

  it('is false when crypto has neither secure source', () => {
    vi.stubGlobal('crypto', {});
    expect(hasSecureRandom()).toBe(false);
  });
});
