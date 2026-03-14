/**
 * bloomFilter.ts
 * Bloom Filter wrapper for Trust Database (Phase 1)
 * Uses the bloomfilter npm package
 */

import { BloomFilter } from 'bloomfilter';
import type { BloomFilterData } from './trustDbSchema.js';

/**
 * Trust Bloom Filter クラス
 */
export class TrustBloomFilter {
  private readonly bloomFilter: BloomFilter;
  private readonly hashCount: number;
  private readonly bitCount: number;
  private readonly expectedDomainCount: number;

  constructor({
    bloomFilter: bf,
    hashCount,
    bitCount,
    expectedDomainCount
  }: {
    bloomFilter: BloomFilter;
    hashCount: number;
    bitCount: number;
    expectedDomainCount: number;
  }) {
    this.bloomFilter = bf;
    this.hashCount = hashCount;
    this.bitCount = bitCount;
    this.expectedDomainCount = expectedDomainCount;
  }

  /**
   * ドメインを Bloom Filter に追加
   */
  add(domain: string): void {
    this.bloomFilter.add(domain);
  }

  /**
   * ドメインが含まれているかを確認
   * 注意: 偽陽性の可能性がある
   */
  mightContain(domain: string): boolean {
    return this.bloomFilter.test(domain);
  }

  /**
   * パラメータを取得
   */
  getParams(): Omit<BloomFilterData, 'data'> {
    return {
      hashCount: this.hashCount,
      bitCount: this.bitCount,
      expectedDomainCount: this.expectedDomainCount
    };
  }

  /**
   * Bloom Filter データを Base64 形式でエクスポート
   */
  toData(): BloomFilterData {
    // bloomfilter.js uses bucket array internally
    const buckets = this.bloomFilter.buckets;
    const base64Data = uint32ArrayToBase64(buckets);

    return {
      data: base64Data,
      ...this.getParams()
    };
  }
}

/**
 * 新しい Bloom Filter を作成
 */
export function createBloomFilter(options: {
  expectedDomainCount: number;
  falsePositiveRate?: number;
}): TrustBloomFilter {
  const { expectedDomainCount, falsePositiveRate = 0.01 } = options;

  const size = -Math.floor((expectedDomainCount * Math.log(falsePositiveRate)) / Math.pow(Math.LN2, 2));
  const hashCount = Math.floor(size / expectedDomainCount * Math.LN2);

  const bf = new BloomFilter(size, hashCount);

  return new TrustBloomFilter({
    bloomFilter: bf,
    hashCount,
    bitCount: size,
    expectedDomainCount
  });
}

/**
 * Base64 データから Bloom Filter を復元
 */
export function bloomFilterFromBase64(data: string, params: {
  hashCount: number;
  bitCount: number;
  expectedDomainCount: number;
}): TrustBloomFilter {
  const { hashCount, bitCount, expectedDomainCount } = params;

  try {
    const buckets = base64ToUint32Array(data);
    const bf = new BloomFilter(buckets, hashCount);

    return new TrustBloomFilter({
      bloomFilter: bf,
      hashCount,
      bitCount,
      expectedDomainCount
    });
  } catch (error) {
    throw new Error(`Failed to restore Bloom Filter from base64: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * BloomFilterData から復元
 */
export function bloomFilterFromData(data: BloomFilterData): TrustBloomFilter {
  return bloomFilterFromBase64(data.data, {
    hashCount: data.hashCount,
    bitCount: data.bitCount,
    expectedDomainCount: data.expectedDomainCount
  });
}

// ===== ユーティリティ関数 =====

/**
 * Uint32Array を Base64 に変換
 */
function uint32ArrayToBase64(uint32Array: Uint32Array): string {
  // Convert to Uint8Array for base64 encoding
  const uint8Array = new Uint8Array(uint32Array.buffer);
  let binaryString = '';
  for (let i = 0; i < uint8Array.byteLength; i++) {
    binaryString += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binaryString);
}

/**
 * Base64 を Uint32Array に変換
 */
function base64ToUint32Array(base64: string): Uint32Array {
  const binaryString = atob(base64);
  const uint8Array = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    uint8Array[i] = binaryString.charCodeAt(i);
  }
  return new Uint32Array(uint8Array.buffer);
}

/**
 * ドメインリストから Bloom Filter を作成
 */
export function bloomFilterFromDomains(domains: string[], falsePositiveRate = 0.01): TrustBloomFilter {
  const bloom = createBloomFilter({
    expectedDomainCount: domains.length,
    falsePositiveRate
  });

  for (const domain of domains) {
    bloom.add(domain);
  }

  return bloom;
}