import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createConfirmToken, __resetConfirmTokensForTesting } from '../../../confirmTokenManager.js';

describe('confirmTokenManager — fail-closed without secure RNG', () => {
  beforeEach(async () => {
    await __resetConfirmTokensForTesting();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await __resetConfirmTokensForTesting();
  });

  it('rejects issuance when crypto is unavailable instead of falling back to Math.random', async () => {
    vi.stubGlobal('crypto', undefined);
    await expect(createConfirmToken('delete', 1)).rejects.toThrow(
      /Secure random number generator is unavailable/,
    );
  });

  it('rejects issuance when crypto has neither randomUUID nor getRandomValues', async () => {
    vi.stubGlobal('crypto', {});
    await expect(createConfirmToken('clear_all')).rejects.toThrow(
      /Secure random number generator is unavailable/,
    );
  });

  it('issues a token via getRandomValues when randomUUID is missing', async () => {
    const realCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) });
    const token = await createConfirmToken('delete', 1);
    expect(typeof token).toBe('string');
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });
});
