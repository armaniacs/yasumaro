/**
 * trancoManager.ts
 * Owns the Tranco domain LIST state and lookup (trancoSet / trancoRankMap
 * caches, and the update-tranco flow). NOT to be confused with
 * TrancoVersionTracker, which only tracks the version STRING of the
 * externally-sourced Tranco list in settings storage — this module owns the
 * actual domain list data instead.
 */

import type { TrancoConfig, TrustDatabase } from './trustDbSchema.js';
import type { TrustBloomFilter } from './bloomFilter.js';
import { logInfo } from '../logger.js';
import { BloomFilterManager } from './bloomFilterManager.js';

export interface TrancoManagerDeps {
  bloomFilterManager: BloomFilterManager;
  /** Persist the owning database after an update. */
  save: () => Promise<void>;
}

export class TrancoManager {
  trancoSet: Set<string> = new Set();
  trancoRankMap: Map<string, number> = new Map();

  constructor(private readonly deps: TrancoManagerDeps) {}

  /**
   * サービスワーカー再起動後などに既存の tranco.domains からキャッシュを再構築する。
   */
  rebuildCachesFromDatabase(db: TrustDatabase): void {
    this.trancoSet = new Set(db.tranco.domains);
    this.trancoRankMap = new Map(db.tranco.domains.map((domain, index) => [domain, index]));
  }

  /**
   * データベース更新（外部から）
   */
  async updateTranco(
    db: TrustDatabase,
    domains: string[],
    tier: string
  ): Promise<{ bloomFilter: TrustBloomFilter }> {
    // Bloom Filter 生成
    const bloom = this.deps.bloomFilterManager.rebuildForTrancoUpdate(domains, db.sensitive.presets);

    // 更新
    db.tranco = {
      tier: tier as TrancoConfig['tier'],
      domains,
      count: domains.length,
      sizeBytes: domains.join('\n').length
    };

    this.trancoSet = new Set(domains); // Setをキャッシュ

    // trancoRankMap を構築 (O(1) ランク検索用)
    this.trancoRankMap = new Map(domains.map((domain, index) => [domain, index]));

    await this.deps.save();

    logInfo('TrustDb', { tier, count: domains.length }, `Updated Tranco list: ${domains.length} domains`);

    return { bloomFilter: bloom };
  }

  /**
   * 訪問ドメインが Tranco ドメインかを判定
   */
  isTrancoDomain(domain: string): boolean {
    let normalized = domain.toLowerCase().trim();
    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
      try {
        normalized = new URL(normalized).hostname;
      } catch {
        // パース失敗はそのまま使用
      }
    }
    return this.trancoSet.has(normalized);
  }
}
