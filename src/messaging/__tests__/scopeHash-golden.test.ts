/**
 * scopeHash-golden.test.ts (NN16)
 *
 * Golden / parity pin for computeScopeHash (PBI 2026-10-09-16).
 *
 * The digests below are the SHA-256 hex of the `parts.join('|')` string with
 * undefined/null folded to the empty segment — computed independently with
 * node:crypto, not copied from the implementation. They are pinned so the
 * move of computeScopeHash from background/confirmTokenManager.ts to
 * src/utils/scopeHash.ts is proven value-identical, and deriveScopeHash keeps
 * producing the same bytes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeScopeHash } from '../../utils/scopeHash.js';
import { deriveScopeHash } from '../sqliteOperationSecurity.js';

const GOLDEN: Array<{ parts: (string | number | undefined | null)[]; hex: string }> = [
  // "1774969199999|0" (the shape confirmTokenManager.test.ts uses)
  { parts: [1774969199999, 0], hex: '7a99168f1b445310510b7c821653f69df8387362f30c3e5b99042a22ec0c34b5' },
  { parts: [1774969199999, 1], hex: '3bae8ba4ab0a7285479ce7399f47dede71e60435c8890522d666ec3141d66345' },
  { parts: [1774969199999, false], hex: '00d63617a617c6167346aeb5736dbb3151730ff26385f3c6f1f005d6008914f5' },
  // undefined/null fold to the empty segment, so ["|"] and arity are part of the scope
  { parts: [null, null], hex: 'cbe5cfdf7c2118a9c3d78ef1d684f3afa089201352886449a06a6511cfef74a7' },
  { parts: [undefined, 1], hex: 'b75c34545e8cb4d20f42b5ef4e2d12cecb6348ef2811351efde8e51ca6b31b80' },
  // empty join (single empty segment and empty array hash identically)
  { parts: [''], hex: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  { parts: [], hex: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' },
  // staging scope (the shape deriveScopeHash produces for 'staging' subtypes)
  { parts: ['staging-a.db'], hex: '34690f80db16298842f4578316f37c6d19112ae27371d3529d05bfaf2ed57e08' },
  { parts: ['staging-b.db'], hex: 'e9a201621db4c95f7ed1f37d1faac27d4e744d45b42b2e9e88f573db6675fa6f' },
];

describe('computeScopeHash golden/parity (NN16)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pins SHA-256 hex for representative inputs', async () => {
    for (const { parts, hex } of GOLDEN) {
      expect(await computeScopeHash(parts)).toBe(hex);
    }
  });

  it('deriveScopeHash reproduces the golden staging digest', async () => {
    expect(await deriveScopeHash('archive_open', { stagingName: 'staging-a.db' })).toBe(
      GOLDEN.find((g) => g.parts[0] === 'staging-a.db')!.hex,
    );
    expect(await deriveScopeHash('archive_open', { stagingName: 'staging-b.db' })).not.toBe(
      GOLDEN.find((g) => g.parts[0] === 'staging-a.db')!.hex,
    );
  });

  it('fails closed when crypto.subtle is unavailable', async () => {
    vi.stubGlobal('crypto', {});
    await expect(computeScopeHash(['x'])).rejects.toThrow(/crypto\.subtle unavailable/);
  });
});
