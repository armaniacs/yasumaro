/**
 * TrustPolicy.ts
 * Deep module hiding DomainVerifier / BloomFilterManager / TrancoManager.
 * Public seam: isDomainTrusted / isTrancoDomain (+ lifecycle helpers for Kernel).
 */

import type { TrustResult, TrustDatabase } from './trustDbSchema.js';
import { DomainTrustLevel } from './trustDbSchema.js';
import type { TrustBloomFilter } from './bloomFilter.js';
import { DomainVerifier } from './domainVerifier.js';
import { BloomFilterManager } from './bloomFilterManager.js';
import { TrancoManager } from './trancoManager.js';
import { logError, ErrorCode } from '../logger.js';

export interface TrustPolicyDeps {
  save: () => Promise<void>;
}

export class TrustPolicy {
  private readonly domainVerifier = new DomainVerifier();
  private readonly bloomFilterManager = new BloomFilterManager();
  private readonly trancoManager: TrancoManager;

  private database: TrustDatabase | null = null;
  private bloomFilter: TrustBloomFilter | null = null;
  private initialized = false;

  constructor(private readonly deps: TrustPolicyDeps) {
    this.trancoManager = new TrancoManager({
      bloomFilterManager: this.bloomFilterManager,
      save: deps.save,
    });
  }

  /** Sync state from Kernel after load/create/repair */
  setState(database: TrustDatabase | null, bloomFilter: TrustBloomFilter | null, initialized: boolean): void {
    this.database = database;
    this.bloomFilter = bloomFilter;
    this.initialized = initialized;
  }

  /** For Kernel to sync bloomFilter after tranco update */
  setBloomFilter(bloomFilter: TrustBloomFilter): void {
    this.bloomFilter = bloomFilter;
  }

  getBloomFilter(): TrustBloomFilter | null {
    return this.bloomFilter;
  }

  getDatabase(): TrustDatabase | null {
    return this.database;
  }

  // ---- Public seam ----
  isDomainTrusted(domain: string): TrustResult {
    if (!this.initialized || !this.database || !this.bloomFilter) {
      logError('TrustDb', {}, ErrorCode.TRUST_DB_NOT_INITIALIZED);
      return {
        level: DomainTrustLevel.UNVERIFIED,
        source: 'unknown',
        reason: 'Trust database not initialized',
      };
    }
    return this.domainVerifier.isDomainTrusted(domain, {
      database: this.database,
      bloomFilter: this.bloomFilter,
      trancoSet: this.trancoManager.trancoSet,
      trancoRankMap: this.trancoManager.trancoRankMap,
    });
  }

  isTrancoDomain(domain: string): boolean {
    return this.trancoManager.isTrancoDomain(domain);
  }

  // ---- Lifecycle helpers (for Kernel only, not part of public trust seam) ----
  rebuildCachesFromDatabase(db: TrustDatabase): void {
    this.trancoManager.rebuildCachesFromDatabase(db);
  }

  async updateTranco(db: TrustDatabase, domains: string[], tier: string): Promise<{ bloomFilter: TrustBloomFilter }> {
    const result = await this.trancoManager.updateTranco(db, domains, tier);
    this.bloomFilter = result.bloomFilter;
    return result;
  }

  createBloomFilterFromPresets(): Promise<import('./trustDbSchema.js').BloomFilterData> {
    return this.bloomFilterManager.createBloomFilterFromPresets();
  }

  rebuildForTrancoUpdate(domains: string[], presets: { finance: string[]; gaming: string[]; sns: string[] }): TrustBloomFilter {
    return this.bloomFilterManager.rebuildForTrancoUpdate(domains, presets);
  }
}
