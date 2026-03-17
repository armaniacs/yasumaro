/**
 * bloomFilter.ts
 * Bloom Filter wrapper for Trust Database (Phase 1)
 * Uses the bloomfilter npm package
 */

// @ts-ignore — vendor JS file bundled from bloomfilter npm package
import { BloomFilter } from './bloomfilter.mjs';
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
   * パラメータを取得（hash はデータ生成時に計算されるため含まれない）
   */
  getParams(): Pick<BloomFilterData, 'hashCount' | 'bitCount' | 'expectedDomainCount'> {
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

    // 簡易的なハッシュ計算で整合性チェック用の値を生成
    const hash = simpleHash(base64Data);

    return {
      data: base64Data,
      ...this.getParams(),
      hash
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

  // Handle empty bloom filter case (initial state)
  if (expectedDomainCount === 0) {
    return new TrustBloomFilter({
      bloomFilter: new BloomFilter(1, 1), // Minimal valid bloom filter
      hashCount: 1,
      bitCount: 1,
      expectedDomainCount: 0
    });
  }

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
  // ハッシュ検証（データ整合性チェック）
  if (data.hash) {
    const computedHash = simpleHash(data.data);
    if (computedHash !== data.hash) {
      throw new Error('Bloom Filter data integrity check failed: hash mismatch');
    }
  }

  return bloomFilterFromBase64(data.data, {
    hashCount: data.hashCount,
    bitCount: data.bitCount,
    expectedDomainCount: data.expectedDomainCount
  });
}

/**
 * 簡易的なハッシュ関数（整合性チェック用）
 * 注: セキュリティ用途ではなく、データ破損検出のみに使用
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // シフト演算後に文字列に変換
  return Math.abs(hash).toString(16);
}

// ===== ユーティリティ関数 =====

/**
 * Uint32Array を Base64 に変換
 * Uses chunk-based encoding to avoid O(n²) string concatenation and stack overflow
 */
function uint32ArrayToBase64(uint32Array: Uint32Array): string {
  // Convert to Uint8Array for base64 encoding
  const uint8Array = new Uint8Array(uint32Array.buffer);
  // Use chunk-based approach to avoid O(n²) complexity
  const chunkSize = 0x8000; // 32KB chunks (safe for apply/call stack)
  const chunks: string[] = [];
  for (let i = 0; i < uint8Array.byteLength; i += chunkSize) {
    const chunk = uint8Array.subarray(i, i + chunkSize);
    chunks.push(String.fromCharCode.apply(null, Array.from(chunk)));
  }
  return btoa(chunks.join(''));
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