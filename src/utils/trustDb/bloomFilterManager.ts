/**
 * bloomFilterManager.ts
 * trustDb-specific orchestration around bloom filters: building the initial
 * filter from sensitive-domain presets, and rebuilding it when the Tranco
 * list is updated. Delegates the actual bloom filter math to bloomFilter.ts.
 */

import type { BloomFilterData } from './trustDbSchema.js';
import { type TrustBloomFilter, bloomFilterFromDomains } from './bloomFilter.js';
import { SENSITIVE_DOMAINS_PRESETS as PRESETS } from './presets.js';

// Sensitive ドメインプリセット（presets.ts から取得。正本は presets.ts に一元化）
const SENSITIVE_DOMAINS_PRESETS = PRESETS;

export class BloomFilterManager {
  /**
   * プリセットから Bloom Filter データを作成
   */
  createBloomFilterFromPresets(): Promise<BloomFilterData> {
    const allSensitiveDomains: string[] = Object.values(SENSITIVE_DOMAINS_PRESETS).flat();

    const bloom = bloomFilterFromDomains(allSensitiveDomains, 0.01);
    return Promise.resolve(bloom.toData());
  }

  /**
   * Tranco ドメイン更新時の Bloom Filter 再構築。
   * Tranco ドメインと sensitive プリセットの両方を含むフィルターを作る。
   */
  rebuildForTrancoUpdate(
    domains: string[],
    sensitivePresets: { finance: string[]; gaming: string[]; sns: string[] }
  ): TrustBloomFilter {
    return bloomFilterFromDomains([
      ...domains,
      ...sensitivePresets.finance,
      ...sensitivePresets.gaming,
      ...sensitivePresets.sns
    ]);
  }
}
