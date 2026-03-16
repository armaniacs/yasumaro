/**
 * bloomFilter-performance.test.ts
 * Performance Tests for bloomFilter.ts
 *
 * 対象問題: TUN-001 (O(n²) string concatenation in Bloom Filter encoding)
 * - 文字列連結のO(n²)複雑度によるパフォーマンス問題
 * - chunk-basedエンコーディングによる修正の検証
 */

import { describe, test, expect } from '@jest/globals';

import {
  bloomFilterFromDomains,
  bloomFilterFromData
} from '../trustDb/bloomFilter.js';

describe('BloomFilter Performance Tests', () => {
  test('base64 encoding should handle large arrays without stack overflow', () => {
    // Create a reasonably large bloom filter data
    const domainCount = 10000;
    const domains = Array.from({ length: domainCount }, (_, i) => `example${i}.com`);

    // Should not throw stack overflow error
    expect(() => {
      const bloom = bloomFilterFromDomains(domains, 0.01);
      const data = bloom.toData();
      expect(data.data).toBeDefined();
      expect(typeof data.data).toBe('string');
      expect(data.data.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  test('base64 encoding/decoding roundtrip preserves data integrity', () => {
    // Test with a known domain set
    const domains = ['example.com', 'test.org', 'foo.bar'];
    const bloom = bloomFilterFromDomains(domains, 0.01);

    // Encode to base64 via toData
    const encoded = bloom.toData();

    // Decode from base64
    const decoded = bloomFilterFromData(encoded);

    // Verify all domains are still in the filter
    domains.forEach(domain => {
      expect(decoded.mightContain(domain)).toBe(true);
    });

    // Verify non-domains are still filtered (bloom filter has false positive rate)
    expect(decoded.mightContain('not-in-list.com')).toBe(false);
  });

  test('base64 encoding result length is reasonable for large datasets', () => {
    const domainCount = 5000;
    const domains = Array.from({ length: domainCount }, (_, i) => `site${i}.net`);
    const bloom = bloomFilterFromDomains(domains, 0.01);

    const data = bloom.toData();

    // Base64 encoding should produce roughly 4/3 the size of the binary data
    // A reasonable upper bound for 5000 domains is under 1MB in base64
    expect(data.data.length).toBeLessThan(1024 * 1024);
  });

  test('bloomFilterFromData preserves hash integrity', () => {
    const domainCount = 100;
    const domains = Array.from({ length: domainCount }, (_, i) => `domain${i}.org`);
    const bloom = bloomFilterFromDomains(domains, 0.01);

    const data = bloom.toData();

    // Should parse without throwing
    expect(() => {
      bloomFilterFromData(data);
    }).not.toThrow();
  });

  test('bloomFilterFromData rejects corrupted data', () => {
    const domainCount = 100;
    const domains = Array.from({ length: domainCount }, (_, i) => `domain${i}.org`);
    const bloom = bloomFilterFromDomains(domains, 0.01);

    const data = bloom.toData();

    // Should throw when hash is corrupted
    expect(() => {
      bloomFilterFromData({
        ...data,
        hash: 'invalid-hash'
      });
    }).toThrow('hash mismatch');
  });

  test('encoding handles empty bloom filter', () => {
    const domains: string[] = [];
    const bloom = bloomFilterFromDomains(domains, 0.01);

    const data = bloom.toData();
    expect(data.data).toBeDefined();
    expect(typeof data.data).toBe('string');

    // Decode should work
    const decoded = bloomFilterFromData(data);
    expect(decoded).toBeDefined();
  });

  test('encoding handles single domain filter', () => {
    const domains = ['example.com'];
    const bloom = bloomFilterFromDomains(domains, 0.01);

    const data = bloom.toData();
    expect(data.data).toBeDefined();
    expect(typeof data.data).toBe('string');

    const decoded = bloomFilterFromData(data);
    expect(decoded.mightContain('example.com')).toBe(true);
  });
});