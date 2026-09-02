/**
 * TrustDbKernel.ts
 * Owns TrustDbState + initialize/save/rebuildCaches lifecycle.
 * Settings access via StoragePort / SettingsRepository (static import), no dynamic import of storage.js.
 * Persistence key owned by storage layer (StorageKeys.TRUST_DB); Kernel is single reader/writer via that key.
 */

import type { TrustDatabase, TrustResult } from './trustDbSchema.js';
import { TrustBloomFilter, bloomFilterFromData } from './bloomFilter.js';
import { logDebug, logInfo, logWarn, logError, ErrorCode } from '../logger.js';
import { withOptimisticLock } from '../optimisticLock.js';
import { mergeTrustDatabase } from './mergeTrustDatabase.js';
import { TRANCO_VERSION as CURRENT_TRANCO_VERSION } from './presetDomains.js';
import { SENSITIVE_DOMAINS_PRESETS as PRESETS, JP_ANCHOR_TLDS } from './presets.js';
import { TrustDbVersion, DB_VERSION } from './trustDbVersion.js';
import { repairTrustDatabase } from './trustDbRepair.js';
import { ManagedCollections } from './ManagedCollections.js';
import { TrustPolicy } from './TrustPolicy.js';
import { StorageKeys } from '../storage/types.js';

const STORAGE_KEY = StorageKeys.TRUST_DB;
const JP_ANCHOR_TLDS_PRESET = [...JP_ANCHOR_TLDS] as readonly string[];
const SENSITIVE_DOMAINS_PRESETS = PRESETS;

export interface TrustDbKernelOptions {
  /** For testing: inject alternative settings reader */
  settingsReader?: {
    getAll(): Promise<Record<string, unknown>>;
    setAll(items: Record<string, unknown>): Promise<void>;
  };
}

interface TrustDbState {
  database: TrustDatabase | null;
  bloomFilter: TrustBloomFilter | null;
  initialized: boolean;
}

export class TrustDbKernel {
  static initPromise: Promise<void> | null = null;
  private state: TrustDbState = {
    database: null,
    bloomFilter: null,
    initialized: false,
  };

  private collections: ManagedCollections | null = null;
  private readonly policy: TrustPolicy;
  private readonly trustDbVersion: TrustDbVersion;

  private readonly settingsReader: {
    getAll(): Promise<Record<string, unknown>>;
    setAll(items: Record<string, unknown>): Promise<void>;
  };

  constructor(opts?: TrustDbKernelOptions) {
    const defaultReader = {
      getAll: async (): Promise<Record<string, unknown>> => {
        try {
          const { settingsRepository } = await import('../storage/SettingsRepository.js');
          return (await settingsRepository.getAll()) as unknown as Record<string, unknown>;
        } catch {
          return {};
        }
      },
      setAll: async (items: Record<string, unknown>): Promise<void> => {
        const { settingsRepository } = await import('../storage/SettingsRepository.js');
        await settingsRepository.setAll(items as unknown as Parameters<typeof settingsRepository.setAll>[0]);
      },
    };
    this.settingsReader = opts?.settingsReader ?? defaultReader;
    this.policy = new TrustPolicy({ save: () => this.save() });
    this.trustDbVersion = new TrustDbVersion({ save: () => this.save() });
  }

  // ---- Lifecycle ----
  async initialize(): Promise<void> {
    if (this.state.initialized) {
      logDebug('TrustDb', {}, 'Already initialized');
      return;
    }
    if (TrustDbKernel.initPromise) {
      return TrustDbKernel.initPromise;
    }
    TrustDbKernel.initPromise = this.doInitializeWithRetry(3);
    try {
      await TrustDbKernel.initPromise;
    } finally {
      TrustDbKernel.initPromise = null;
    }
  }

  private async doInitializeWithRetry(maxRetries: number): Promise<void> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.doInitialize();
        return;
      } catch (error) {
        lastError = error as Error;
        logWarn('TrustDb initialization failed, retrying', { attempt: attempt + 1, maxRetries, error: lastError?.message });
        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 100;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    logError('TrustDb', { error: lastError }, ErrorCode.TRUST_DB_INIT_FAILED);
    throw lastError;
  }

  private async doInitialize(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const savedDb = result[STORAGE_KEY] as TrustDatabase | undefined;

      if (savedDb) {
        const repaired = repairTrustDatabase(savedDb as unknown as Record<string, unknown>) as unknown as TrustDatabase;
        let wasRepaired = JSON.stringify(savedDb) !== JSON.stringify(repaired);
        this.state.database = repaired;
        let bloomRebuilt = false;
        try {
          if (!repaired.bloomFilter || typeof repaired.bloomFilter !== 'object') {
            throw new Error('Missing bloomFilter');
          }
          this.state.bloomFilter = bloomFilterFromData(repaired.bloomFilter as unknown as Parameters<typeof bloomFilterFromData>[0]);
        } catch {
          const rebuiltData = await this.policy.createBloomFilterFromPresets();
          this.state.bloomFilter = bloomFilterFromData(rebuiltData);
          (this.state.database as unknown as Record<string, unknown>).bloomFilter = rebuiltData;
          bloomRebuilt = true;
        }
        wasRepaired = wasRepaired || bloomRebuilt;

        if (this.state.database.version !== DB_VERSION) {
          await this.trustDbVersion.migrateDatabase(this.state.database);
        }

        this.policy.rebuildCachesFromDatabase(this.state.database);
        // sync policy state
        this.policy.setState(this.state.database, this.state.bloomFilter, false);

        logInfo('TrustDb', { version: this.state.database.version, domainCount: this.state.database.tranco.count }, 'Loaded existing database');

        if (wasRepaired) {
          await this.save();
          logInfo('TrustDb', {}, 'Repaired corrupted database and persisted');
        }
      } else {
        await this.createDefaultDatabase();
      }

      this.buildManagedCollections();
      this.state.initialized = true;
      this.policy.setState(this.state.database, this.state.bloomFilter, true);
    } catch (error) {
      logError('TrustDb', { error }, ErrorCode.TRUST_DB_INIT_FAILED);
      throw error;
    }
  }

  private buildManagedCollections(): void {
    const db = this.state.database;
    if (!db || !db.jpAnchor || !db.sensitive || !db.tranco) {
      throw new Error('TrustDb: database is corrupted (missing jpAnchor/sensitive/tranco)');
    }
    this.collections = new ManagedCollections(db, () => this.save());
  }

  private async createDefaultDatabase(): Promise<void> {
    const db: TrustDatabase = {
      version: DB_VERSION,
      lastUpdated: new Date().toISOString(),
      tranco: { tier: 'top10k', domains: [], count: 0, sizeBytes: 0 },
      jpAnchor: { tlds: [...JP_ANCHOR_TLDS_PRESET], userTlds: [] },
      sensitive: {
        presets: {
          finance: [...SENSITIVE_DOMAINS_PRESETS.finance],
          gaming: [...SENSITIVE_DOMAINS_PRESETS.gaming],
          sns: [...SENSITIVE_DOMAINS_PRESETS.sns],
        },
        userBlacklist: [],
        whitelist: [],
      },
      bloomFilter: await this.policy.createBloomFilterFromPresets(),
    };
    this.state.database = db;
    this.state.bloomFilter = bloomFilterFromData(db.bloomFilter);
    this.policy.rebuildCachesFromDatabase(db);
    this.policy.setState(db, this.state.bloomFilter, false);
    await this.save();
    logInfo('TrustDb', {}, 'Created default database');
  }

  async save(): Promise<void> {
    if (!this.state.database || !this.state.bloomFilter) {
      throw new Error('TrustDb not initialized');
    }
    const bloomData = this.state.bloomFilter.toData();
    this.state.database.bloomFilter = bloomData;
    this.state.database.lastUpdated = new Date().toISOString();
    const localSnapshot = this.state.database;
    await withOptimisticLock<TrustDatabase>(STORAGE_KEY, (currentDb) => mergeTrustDatabase(currentDb, localSnapshot));
    logDebug('TrustDb', {}, 'Database saved with optimistic lock');
    // keep policy in sync after save (bloom may have changed via updateTranco)
    this.policy.setState(this.state.database, this.state.bloomFilter, this.state.initialized);
  }

  // For testing: expose repair shim
  repairDatabase(db: Record<string, unknown>): void {
    const repaired = repairTrustDatabase(db);
    for (const k of Object.keys(repaired)) db[k] = repaired[k];
    for (const k of Object.keys(db)) if (!(k in repaired)) delete db[k];
  }

  // ---- Delegated API ----

  isDomainTrusted(domain: string): TrustResult {
    // Keep policy in sync if tests mutated state directly
    if (this.state.bloomFilter !== this.policy.getBloomFilter() || this.state.database !== this.policy.getDatabase()) {
      this.policy.setState(this.state.database, this.state.bloomFilter, this.state.initialized);
    }
    return this.policy.isDomainTrusted(domain);
  }

  isTrancoDomain(domain: string): boolean {
    return this.policy.isTrancoDomain(domain);
  }

  async updateTranco(domains: string[], tier: string): Promise<void> {
    const db = this.state.database;
    if (!db) throw new Error('TrustDb not initialized');
    const { bloomFilter } = await this.policy.updateTranco(db, domains, tier);
    this.state.bloomFilter = bloomFilter;
    this.policy.setState(db, bloomFilter, this.state.initialized);
  }

  // Collections delegation
  async addUserTld(tld: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database || !this.collections) return { success: false, error: 'Database not initialized' };
    return this.collections.addUserTld(tld);
  }
  async removeUserTld(tld: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database || !this.collections) return { success: false, error: 'Database not initialized' };
    return this.collections.removeUserTld(tld);
  }
  getVersion(): string {
    return this.trustDbVersion.getVersion();
  }
  getStatus(): { initialized: boolean; version?: string; lastUpdated?: string; trancoTier?: string; trancoCount?: number } {
    if (!this.state.database) return { initialized: false };
    return {
      initialized: true,
      version: this.state.database.version,
      lastUpdated: this.state.database.lastUpdated,
      trancoTier: this.state.database.tranco.tier,
      trancoCount: this.state.database.tranco.count,
    };
  }
  getDatabase(): TrustDatabase | null {
    return this.state.database;
  }
  getJpAnchorTlds(): string[] {
    if (!this.state.database) return [];
    return this.collections ? this.collections.getJpAnchorTlds() : [...this.state.database.jpAnchor.tlds, ...this.state.database.jpAnchor.userTlds];
  }
  async addJpAnchorTld(tld: string): Promise<{ success: boolean; error?: string }> {
    return this.addUserTld(tld);
  }
  async removeJpAnchorTld(tld: string): Promise<{ success: boolean; error?: string }> {
    return this.removeUserTld(tld);
  }
  getSensitiveDomains(category: 'finance' | 'gaming' | 'sns'): string[] {
    if (!this.state.database || !this.collections) return [];
    return this.collections.getSensitiveDomains(category);
  }
  async addSensitiveDomain(domain: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database || !this.collections) return { success: false, error: 'Database not initialized' };
    return this.collections.addSensitiveDomain(domain);
  }
  async removeSensitiveDomain(domain: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database || !this.collections) return { success: false, error: 'Database not initialized' };
    return this.collections.removeSensitiveDomain(domain);
  }
  getWhitelist(): string[] {
    if (!this.state.database || !this.collections) return [];
    return this.collections.getWhitelist();
  }
  async addToWhitelist(domain: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database || !this.collections) return { success: false, error: 'Database not initialized' };
    return this.collections.addToWhitelist(domain);
  }
  async removeFromWhitelist(domain: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database || !this.collections) return { success: false, error: 'Database not initialized' };
    return this.collections.removeFromWhitelist(domain);
  }

  // ---- Tranco version tracking via static StorageKeys + settingsReader (no dynamic import) ----
  getCurrentTrancoVersion(): string {
    return CURRENT_TRANCO_VERSION;
  }
  async getSavedTrancoVersion(): Promise<string | null> {
    const settings = await this.settingsReader.getAll();
    return (settings[StorageKeys.TRANCO_VERSION] as string) || null;
  }
  async updateTrancoVersion(version: string, domains: string[]): Promise<void> {
    await this.settingsReader.setAll({
      [StorageKeys.TRANCO_VERSION]: version,
      [StorageKeys.TRANCO_DOMAINS]: domains,
    } as unknown as Record<string, unknown>);
    logInfo('TrustDb', { version, domainCount: domains.length }, 'Tranco version updated');
  }
  async checkTrancoUpdate(): Promise<{ hasUpdate: boolean; oldVersion: string | null; newVersion: string }> {
    const savedVersion = await this.getSavedTrancoVersion();
    const currentVersion = this.getCurrentTrancoVersion();
    if (savedVersion !== currentVersion) {
      logInfo('TrustDb', { savedVersion, currentVersion }, 'Tranco version update detected');
      return { hasUpdate: true, oldVersion: savedVersion, newVersion: currentVersion };
    }
    return { hasUpdate: false, oldVersion: savedVersion, newVersion: currentVersion };
  }
  async getSavedTrancoDomains(): Promise<string[]> {
    const settings = await this.settingsReader.getAll();
    return (settings[StorageKeys.TRANCO_DOMAINS] as string[]) || [];
  }

  getPolicy(): TrustPolicy {
    return this.policy;
  }

  // expose internal state for tests that poke state directly
  _getState(): TrustDbState {
    return this.state;
  }
  _setState(state: TrustDbState): void {
    this.state = state;
    this.policy.setState(state.database, state.bloomFilter, state.initialized);
  }
}
