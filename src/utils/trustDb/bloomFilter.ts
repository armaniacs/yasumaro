/**
 * bloomFilter.ts
 * Bloom Filter wrapper for Trust Database (Phase 1)
 * Uses the bloomfilter npm package
 *
 * 5 Whys 分析 (PBI-19):
 * 1. なぜ偽装可能か: simpleHash は ((hash << 5) - hash) + char の32bit FNV風で衝突が容易。攻撃者は data 改ざん + simpleHash 再計算で hash mismatch をバイパス可能
 * 2. なぜ非暗号ハッシュを採用したか: 初期実装で「データ破損検出のみ」目的とコメント (セキュリティ用途ではない) し暗号学的完全性を不要と判断
 * 3. なぜ見過ごされたか: TrustDb の脅威モデルで「ローカルストレージ改ざん」を想定せず Bloomデータは信頼できる前提で設計
 * 4. なぜWebCryptoを使わなかったか: SubtleCrypto が async のため toData()/bloomFilterFromData() の同期API維持を優先し簡易ハッシュを選択
 * 5. 解: 衝突耐性のある SHA-256 (WebCrypto crypto.subtle.digest('SHA-256') と同一出力の同期実装) に置換。旧 simpleHash は移行期間のみ警告付きで許容し、次回保存時に SHA-256 へ自動移行
 *
 * 選定理由 (ADR):
 * - SHA-256 を第一段階とし HMAC は見送り。鍵管理 (chrome.storage へのHMAC鍵保存) が別PBIを要するため
 * - crypto.subtle.digest は async で呼び出し元への async 伝播が必要だが bloomFilter.ts のみ触る制約のため同期 pure-JS 実装を採用
 * - 同期実装の出力は WebCrypto SHA-256 と同一 (hex 64文字) であり将来 async WebCrypto への移行時も互換
 */

import { BloomFilter } from './bloomfilter-vendor.mjs';
import type { BloomFilterData } from './trustDbSchema.js';
import { errorMessage } from '../errorUtils.js';

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
   * hash は SHA-256 (hex 64文字) — WebCrypto crypto.subtle.digest('SHA-256') と同一
   */
  toData(): BloomFilterData {
    // bloomfilter.js uses bucket array internally
    const buckets = this.bloomFilter.buckets;
    const base64Data = uint32ArrayToBase64(buckets);

    const hash = sha256HexSync(base64Data);

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
    throw new Error(`Failed to restore Bloom Filter from base64: ${errorMessage(error)}`);
  }
}

function isSha256Hex(hash: string): boolean {
  return /^[0-9a-f]{64}$/i.test(hash);
}

/**
 * BloomFilterData から復元
 * 新データは SHA-256 で検証。旧 simpleHash データは警告ログの上で許容し次回保存時に SHA-256 へ移行する
 */
export function bloomFilterFromData(data: BloomFilterData): TrustBloomFilter {
  // ハッシュ検証（データ整合性チェック）
  if (data.hash) {
    if (isSha256Hex(data.hash)) {
      const computedHash = sha256HexSync(data.data);
      if (computedHash !== data.hash.toLowerCase()) {
        throw new Error('Bloom Filter data integrity check failed: hash mismatch');
      }
    } else {
      // 旧データ移行パス: simpleHash で検証し警告を出す
      const computedLegacy = simpleHash(data.data);
      if (computedLegacy !== data.hash) {
        throw new Error('Bloom Filter data integrity check failed: hash mismatch');
      }
      console.warn(
        '[TrustBloomFilter] Legacy simpleHash detected. Data integrity is verified with deprecated hash. It will be upgraded to SHA-256 on next save.'
      );
    }
  }

  return bloomFilterFromBase64(data.data, {
    hashCount: data.hashCount,
    bitCount: data.bitCount,
    expectedDomainCount: data.expectedDomainCount
  });
}

/**
 * 簡易的なハッシュ関数（整合性チェック用・非推奨）
 * 旧データ移行のために残存。新規データは sha256HexSync を使用
 * @deprecated Use sha256HexSync instead
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

/**
 * SHA-256 hex (同期) — WebCrypto crypto.subtle.digest('SHA-256') と同一出力
 * 参照: FIPS 180-4. 同期API維持のため pure-JS 実装。Bloomデータは数KBで性能影響は無視可能
 * 将来 async 化する場合は crypto.subtle.digest と置換可能 (出力 hex は同一)
 */
export function sha256HexSync(str: string): string {
  // UTF-8 エンコード
  const bytes = stringToUtf8Bytes(str);
  return sha256BytesToHex(bytes);
}

function stringToUtf8Bytes(str: string): Uint8Array {
  // TextEncoder があれば利用、なければ手動エンコード
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  // フォールバック: 手動 UTF-8 エンコード (ASCII 範囲は base64 なので十分だが念のため)
  const utf8: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let charCode = str.charCodeAt(i);
    if (charCode < 0x80) {
      utf8.push(charCode);
    } else if (charCode < 0x800) {
      utf8.push(0xc0 | (charCode >> 6), 0x80 | (charCode & 0x3f));
    } else if (charCode < 0xd800 || charCode >= 0xe000) {
      utf8.push(0xe0 | (charCode >> 12), 0x80 | ((charCode >> 6) & 0x3f), 0x80 | (charCode & 0x3f));
    } else {
      // サロゲートペア
      i++;
      const low = str.charCodeAt(i);
      const codePoint = 0x10000 + ((charCode & 0x3ff) << 10) + (low & 0x3ff);
      utf8.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    }
  }
  return new Uint8Array(utf8);
}

function sha256BytesToHex(bytes: Uint8Array): string {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const bitLen = bytes.length * 8;
  // パディング: 0x80 + 0x00 + 64bit長さ
  const withOne = bytes.length + 1;
  const paddedLen = Math.ceil((withOne + 8) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // 長さを big-endian 64bit で末尾に書き込み (上位32bitは 0 固定: Bloomデータは <2^32 bit)
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);
  // 上位32bitは 0 のまま (Bloomデータは数MB未満)

  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rightRotate(w[i - 15]!, 7) ^ rightRotate(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rightRotate(w[i - 2]!, 17) ^ rightRotate(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map(v => v.toString(16).padStart(8, '0')).join('');
}

function rightRotate(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
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
