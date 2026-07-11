/**
 * check-bundle-size.test.ts
 * M26: unit tests for the pure size-checking logic used by
 * scripts/check-bundle-size.mjs (post-build verification in release.yml).
 */
import { describe, it, expect } from 'vitest';
import { checkBundleSize } from '../check-bundle-size.mjs';

describe('checkBundleSize', () => {
  it('passes when total size is under the limit', () => {
    const result = checkBundleSize({ totalBytes: 5 * 1024 * 1024, maxBytes: 10 * 1024 * 1024 });
    expect(result.ok).toBe(true);
  });

  it('fails when total size exceeds the limit', () => {
    const result = checkBundleSize({ totalBytes: 15 * 1024 * 1024, maxBytes: 10 * 1024 * 1024 });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('exceeds');
  });

  it('passes when total size exactly equals the limit', () => {
    const result = checkBundleSize({ totalBytes: 10 * 1024 * 1024, maxBytes: 10 * 1024 * 1024 });
    expect(result.ok).toBe(true);
  });
});
