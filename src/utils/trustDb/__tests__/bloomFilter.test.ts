// Transient RED→GREEN scaffold for VULN-005.
// Final committed name: src/utils/trustDb/__tests__/bloomFilter.test.ts
import { describe, expect, it, vi } from 'vitest';
import { bloomFilterFromData, createBloomFilter } from '../bloomFilter.js';
import type { BloomFilterData } from '../trustDbSchema.js';

// Exact mirror of the deprecated module-private simpleHash (32-bit FNV-style).
function simpleHashMirror(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

function realBlob(): BloomFilterData {
  const real = createBloomFilter({ expectedDomainCount: 10 });
  real.add('trusted.example');
  return real.toData();
}

describe('VULN-005: legacy weak hashes must not pass integrity verification', () => {
  it('quarantines a legacy simpleHash blob to the untrusted default', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const forged: BloomFilterData = { ...realBlob(), hash: simpleHashMirror(realBlob().data) };

    const restored = bloomFilterFromData(forged);

    expect(restored.getParams().expectedDomainCount).toBe(0); // empty/untrusted default
    expect(restored.mightContain('trusted.example')).toBe(false);
    warn.mockRestore();
  });

  it('still rejects a mismatched SHA-256 hash', () => {
    const forged: BloomFilterData = { ...realBlob(), hash: `${'a'.repeat(63)}b` };
    expect(() => bloomFilterFromData(forged)).toThrow('hash mismatch');
  });

  it('still restores a valid SHA-256 blob correctly', () => {
    const restored = bloomFilterFromData(realBlob());
    expect(restored.mightContain('trusted.example')).toBe(true);
  });
});
