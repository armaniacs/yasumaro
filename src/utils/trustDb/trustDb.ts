// @layer 1-循環 — Infrastructure (circular with storage/settingsStore, see ADR 2026-08-20)
/**
 * trustDb.ts
 * Trust Database orchestrator: owns TrustDbState, the init/save lifecycle,
 * and composes the extracted submodules (DomainVerifier, BloomFilterManager,
 * TrancoManager, SensitiveDomainStore, WhitelistStore, TrustDbVersion,
 * ManagedStringList, TrancoVersionTracker).
 */

import type {
  TrustResult,
  TrustDatabase,
} from './trustDbSchema.js';
import { DomainTrustLevel } from './trustDbSchema.js';
import { TrustBloomFilter, bloomFilterFromData } from './bloomFilter.js';
import { logDebug, logInfo, logWarn, logError, ErrorCode } from '../logger.js';
import { withOptimisticLock } from '../optimisticLock.js';
import { mergeTrustDatabase } from './mergeTrustDatabase.js';
import { TRANCO_VERSION as CURRENT_TRANCO_VERSION } from './presetDomains.js';
import { SENSITIVE_DOMAINS_PRESETS as PRESETS, JP_ANCHOR_TLDS } from './presets.js';

// ===== 定数 =====

const STORAGE_KEY = 'trust_db:json';

// 30日（ミリ秒）- 同意拒否後の再確認間隔
const _CONSENT_RETRY_DAYS = 30;

// JP-Anchor プリセット TLD（presets.ts から取得）
const JP_ANCHOR_TLDS_PRESET = [...JP_ANCHOR_TLDS] as readonly string[];

// Sensitive ドメインプリセット（presets.ts から取得。正本は presets.ts に一元化）
const SENSITIVE_DOMAINS_PRESETS = PRESETS;

// 入力バリデーション /////////////////////////

// ドメインバリデーション関数は domainValidation.ts に抽出済み
import { isValidDomain, isValidTld } from './domainValidation.js';
import { ManagedStringList } from './managedStringList.js';
import { TrancoVersionTracker } from './trancoVersionTracker.js';
import { DomainVerifier } from './domainVerifier.js';
import { BloomFilterManager } from './bloomFilterManager.js';
import { TrancoManager } from './trancoManager.js';
import { SensitiveDomainStore } from './sensitiveDomainStore.js';
import { WhitelistStore } from './whitelistStore.js';
import { TrustDbVersion, DB_VERSION } from './trustDbVersion.js';

// ===== settingsStore 動的import ヘルパー（PBI-2026-08-01-20） =====
//
// settingsStore.ts との循環参照回避のため動的importを使う（settingsStore.ts
// 側も trustDb.ts を動的importしている）。ESMの動的importは2回目以降
// モジュールキャッシュされるためこのメモ化自体に性能上の意味はほぼないが、
// 呼び出し側の重複コードを1箇所に集約する目的で用意している。
//
// NOTE (PBI-27 分解時に確認): storage/types.ts の StorageKeys はプレーンな
// オブジェクトで、settingsStore.ts を実行時に import していない（trustDb.ts
// への依存は `import type` のみで実行時参照を生まない）ため、storage/types.js
// の動的import は不要と判断し静的importへ変更した。実際の循環は
// settingsStore.ts <-> trustDb.ts の間にのみ残るため、getSettingsStore() は
// 動的importのまま維持する。

let settingsStoreModule: typeof import('../storage/settingsStore.js') | undefined;

async function getSettingsStore(): Promise<typeof import('../storage/settingsStore.js')> {
  if (!settingsStoreModule) {
    settingsStoreModule = await import('../storage/settingsStore.js');
  }
  return settingsStoreModule;
}

// TrancoVersionTracker は getStorageTypes を deps として要求するため、
// 静的importした types モジュールをその場で解決するアダプタを渡す。
async function getStorageTypesStatic(): Promise<typeof import('../storage/types.js')> {
  return await import('../storage/types.js');
}

// ===== trustDb インターフェース =====

interface TrustDbState {
  database: TrustDatabase | null;
  bloomFilter: TrustBloomFilter | null;
  initialized: boolean;
}

class TrustDb {
  private static initPromise: Promise<void> | null = null;
  private state: TrustDbState = {
    database: null,
    bloomFilter: null,
    initialized: false
  };

  // Built once initialize() has loaded/created this.state.database, since
  // ManagedStringList needs a stable reference to the backing array.
  private userTldsList: ManagedStringList | null = null;
  private sensitiveDomainsList: ManagedStringList | null = null;
  private whitelistList: ManagedStringList | null = null;
  private sensitiveDomainStore: SensitiveDomainStore | null = null;
  private whitelistStore: WhitelistStore | null = null;

  private readonly domainVerifier = new DomainVerifier();
  private readonly bloomFilterManager = new BloomFilterManager();
  private readonly trancoManager = new TrancoManager({
    bloomFilterManager: this.bloomFilterManager,
    save: () => this.save(),
  });
  private readonly trustDbVersion = new TrustDbVersion({
    save: () => this.save(),
  });

  private readonly trancoVersionTracker = new TrancoVersionTracker({
    getSettingsStore,
    getStorageTypes: getStorageTypesStatic,
    currentVersion: CURRENT_TRANCO_VERSION,
  });

  /**
   * Trust Database を初期化
   */
  async initialize(): Promise<void> {
    if (this.state.initialized) {
      logDebug('TrustDb', {}, 'Already initialized');
      return;
    }

    // 既に初期化中の場合はそのPromiseを返す
    if (TrustDb.initPromise) {
      return TrustDb.initPromise;
    }

    TrustDb.initPromise = this.doInitializeWithRetry(3);
    try {
      await TrustDb.initPromise;
    } finally {
      TrustDb.initPromise = null;
    }
  }

  /**
   * 初期化を指数関数的バックオフでリトライ
   */
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
          // 指数関数的バックオフ: 100ms → 200ms → 400ms
          const delay = Math.pow(2, attempt) * 100;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    logError('TrustDb', { error: lastError }, ErrorCode.TRUST_DB_INIT_FAILED);
    throw lastError;
  }

  /**
   * 初期化の実際の処理
   */
  private async doInitialize(): Promise<void> {
    try {
      // ストレージからデータをロード（単一キーで統合）
      const result = await chrome.storage.local.get(STORAGE_KEY);
      const savedDb = result[STORAGE_KEY] as TrustDatabase | undefined;

      if (savedDb && savedDb.bloomFilter) {
        // 破損DBの包括的修復: 全必須フィールドをデフォルトで補完（Phase 1 根源: DB自体が部分的に欠落）
        const beforeRepair = JSON.stringify(savedDb);
        this.repairDatabase(savedDb);
        const afterRepair = JSON.stringify(savedDb);
        const wasRepaired = beforeRepair !== afterRepair;
        // 既存データをロード
        this.state.database = savedDb;
        this.state.bloomFilter = bloomFilterFromData(savedDb.bloomFilter);

        // バージョンを確認・マイグレーション
        if (this.state.database.version !== DB_VERSION) {
          await this.trustDbVersion.migrateDatabase(this.state.database);
        }

        // trancoSet / trancoRankMap を再構築（サービスワーカー再起動後もキャッシュを有効化）
        this.trancoManager.rebuildCachesFromDatabase(this.state.database);

        logInfo('TrustDb', {
          version: this.state.database.version,
          domainCount: this.state.database.tranco.count
        }, 'Loaded existing database');

        if (wasRepaired) {
          await this.save();
          logInfo('TrustDb', {}, 'Repaired corrupted database and persisted');
        }
      } else {
        // 新規作成
        await this.createDefaultDatabase();
      }

      this.buildManagedStringLists();
      this.state.initialized = true;
    } catch (error) {
      logError('TrustDb', { error }, ErrorCode.TRUST_DB_INIT_FAILED);
      throw error;
    }
  }

  /**
   * 破損DBを包括的に修復（全必須フィールドのデフォルト補完）
   * Phase 1 根源: 個別フィールドのガード追加では新たな欠落が次々に顕在化するため、
   * 単一箇所で全フィールドを検証・修復し、将来の欠落にも対応
   */
  private repairDatabase(db: Partial<TrustDatabase> & Record<string, unknown>): void {
    const anyDb = db as Record<string, unknown>;
    // Top-level
    if (!anyDb.version) anyDb.version = DB_VERSION;
    if (!anyDb.lastUpdated) anyDb.lastUpdated = new Date().toISOString();
    // jpAnchor
    if (!anyDb.jpAnchor || typeof anyDb.jpAnchor !== 'object') anyDb.jpAnchor = { tlds: [...JP_ANCHOR_TLDS_PRESET], userTlds: [] };
    const jpAnchor = anyDb.jpAnchor as Record<string, unknown>;
    if (!Array.isArray(jpAnchor.tlds)) jpAnchor.tlds = [...JP_ANCHOR_TLDS_PRESET];
    if (!Array.isArray(jpAnchor.userTlds)) jpAnchor.userTlds = [];
    // sensitive
    if (!anyDb.sensitive || typeof anyDb.sensitive !== 'object') anyDb.sensitive = { presets: { finance: [], gaming: [], sns: [] }, userBlacklist: [], whitelist: [] };
    const sensitive = anyDb.sensitive as Record<string, unknown>;
    if (!sensitive.presets || typeof sensitive.presets !== 'object') sensitive.presets = { finance: [], gaming: [], sns: [] };
    const presets = sensitive.presets as Record<string, unknown>;
    if (!Array.isArray(presets.finance)) presets.finance = [];
    if (!Array.isArray(presets.gaming)) presets.gaming = [];
    if (!Array.isArray(presets.sns)) presets.sns = [];
    if (!Array.isArray(sensitive.userBlacklist)) sensitive.userBlacklist = [];
    if (!Array.isArray(sensitive.whitelist)) sensitive.whitelist = [];
    // tranco
    if (!anyDb.tranco || typeof anyDb.tranco !== 'object') anyDb.tranco = { tier: 'top10k', domains: [], count: 0, sizeBytes: 0 };
    const tranco = anyDb.tranco as Record<string, unknown>;
    if (!tranco.tier) tranco.tier = 'top10k';
    if (!Array.isArray(tranco.domains)) tranco.domains = [];
    if (typeof tranco.count !== 'number') tranco.count = (tranco.domains as unknown[]).length;
    if (typeof tranco.sizeBytes !== 'number') tranco.sizeBytes = 0;
    // bloomFilter
    if (!anyDb.bloomFilter) {
      // bloomFilter が無い場合は後続で createDefaultDatabase が呼ばれるが、ここでは修復せず呼び出し元で再生成
    }
  }

  /**
   * ManagedStringList インスタンスを構築する（DB ロード/マイグレーション/新規作成の
   * いずれの経路でも、initialize() の最後に一度だけ呼ばれる）。
   */
  private buildManagedStringLists(): void {
    const db = this.state.database;
    if (!db || !db.jpAnchor || !db.sensitive || !db.tranco) {
      throw new Error('TrustDb: database is corrupted (missing jpAnchor/sensitive/tranco)');
    }

    this.userTldsList = new ManagedStringList(db.jpAnchor.userTlds, {
      save: () => this.save(),
      duplicateErrorMessage: 'TLD already exists',
      notFoundErrorMessage: 'TLD not found',
      normalize: (tld) => (tld.startsWith('.') ? tld : '.' + tld),
      validate: (tld) => {
        if (!isValidTld(tld)) {
          return {
            valid: false,
            error: 'Invalid TLD format. TLD must contain only letters, numbers, and hyphens, must start/end with a letter or number, and be 2-63 characters long (e.g., .com, .jp, .ai)'
          };
        }
        // Also reject TLDs already present in the built-in preset list.
        if (db.jpAnchor.tlds.includes(tld)) {
          return { valid: false, error: 'TLD already exists' };
        }
        return { valid: true };
      },
    });

    this.sensitiveDomainsList = new ManagedStringList(db.sensitive.userBlacklist, {
      save: () => this.save(),
      normalize: (domain) => domain.toLowerCase().trim(),
      validate: (domain) => {
        if (!isValidDomain(domain)) {
          return {
            valid: false,
            error: 'Invalid domain format. Domain must follow RFC standards: contain only letters, numbers, hyphens, and dots, start/end with letter or number, and be max 253 characters long'
          };
        }
        return { valid: true };
      },
    });

    this.whitelistList = new ManagedStringList(db.sensitive.whitelist, {
      save: () => this.save(),
      normalize: (domain) => domain.toLowerCase().trim(),
      validate: (domain) => {
        if (!isValidDomain(domain)) {
          return {
            valid: false,
            error: 'Invalid domain format. Domain must follow RFC standards: contain only letters, numbers, hyphens, and dots, start/end with letter or number, and be max 253 characters long'
          };
        }
        return { valid: true };
      },
    });

    this.sensitiveDomainStore = new SensitiveDomainStore(
      this.sensitiveDomainsList,
      () => this.state.database!.sensitive.presets
    );
    this.whitelistStore = new WhitelistStore(this.whitelistList);
  }

  /**
   * デフォルトデータベースを作成
   */
  private async createDefaultDatabase(): Promise<void> {
    const db: TrustDatabase = {
      version: DB_VERSION,
      lastUpdated: new Date().toISOString(),
      tranco: {
        tier: 'top10k',
        domains: [], // 後で更新可能
        count: 0,
        sizeBytes: 0
      },
      jpAnchor: {
        tlds: [...JP_ANCHOR_TLDS_PRESET],
        userTlds: []
      },
      sensitive: {
        presets: {
          finance: [...SENSITIVE_DOMAINS_PRESETS.finance],
          gaming: [...SENSITIVE_DOMAINS_PRESETS.gaming],
          sns: [...SENSITIVE_DOMAINS_PRESETS.sns]
        },
        userBlacklist: [],
        whitelist: []
      },
      bloomFilter: await this.bloomFilterManager.createBloomFilterFromPresets()
    };

    this.state.database = db;
    this.state.bloomFilter = bloomFilterFromData(db.bloomFilter);

    // trancoRankMap を初期化
    this.trancoManager.rebuildCachesFromDatabase(db);

    await this.save();
    logInfo('TrustDb', {}, 'Created default database');
  }

  /**
   * データベースを保存（楽観的ロックで保護）
   */
  async save(): Promise<void> {
    if (!this.state.database || !this.state.bloomFilter) {
      throw new Error('TrustDb not initialized');
    }

    const bloomData = this.state.bloomFilter.toData();
    this.state.database.bloomFilter = bloomData;
    this.state.database.lastUpdated = new Date().toISOString();

    // Save the entire database atomically via optimistic lock.
    // The updateFn must consume `currentDb` (the value read inside the CAS
    // critical section) and merge this writer's intended state onto it, so
    // a concurrent writer's delta is not silently dropped (VULN-029).
    const localSnapshot = this.state.database;
    await withOptimisticLock<TrustDatabase>(
      STORAGE_KEY,
      (currentDb) => mergeTrustDatabase(currentDb, localSnapshot)
    );

    logDebug('TrustDb', {}, 'Database saved with optimistic lock');
  }

  /**
   * ドメインを信頼判定（3-Step Verification）
   */
  isDomainTrusted(domain: string): TrustResult {
    if (!this.state.initialized || !this.state.database || !this.state.bloomFilter) {
      logError('TrustDb', {}, ErrorCode.TRUST_DB_NOT_INITIALIZED);
      return {
        level: DomainTrustLevel.UNVERIFIED,
        source: 'unknown',
        reason: 'Trust database not initialized'
      };
    }

    return this.domainVerifier.isDomainTrusted(domain, {
      database: this.state.database,
      bloomFilter: this.state.bloomFilter,
      trancoSet: this.trancoManager.trancoSet,
      trancoRankMap: this.trancoManager.trancoRankMap,
    });
  }

  /**
   * データベース更新（外部から）
   */
  async updateTranco(domains: string[], tier: string): Promise<void> {
    const db = this.state.database;
    if (!db) {
      throw new Error('TrustDb not initialized');
    }

    const { bloomFilter } = await this.trancoManager.updateTranco(db, domains, tier);
    this.state.bloomFilter = bloomFilter;
  }

  /**
   * ユーザー TLD 追加（jpAnchor.userTlds に追加。addJpAnchorTld と同じリストを操作する）
   */
  async addUserTld(tld: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database || !this.userTldsList) {
      return { success: false, error: 'Database not initialized' };
    }
    return this.userTldsList.add(tld);
  }

  /**
   * ユーザー TLD 削除
   */
  async removeUserTld(tld: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database || !this.userTldsList) {
      return { success: false, error: 'Database not initialized' };
    }
    return this.userTldsList.remove(tld);
  }

  /**
   * バージョン情報を取得
   */
  getVersion(): string {
    return this.trustDbVersion.getVersion();
  }

  /**
   * データベース状態を取得
   */
  getStatus(): {
    initialized: boolean;
    version?: string;
    lastUpdated?: string;
    trancoTier?: string;
    trancoCount?: number;
  } {
    if (!this.state.database) {
      return { initialized: false };
    }

    return {
      initialized: true,
      version: this.state.database.version,
      lastUpdated: this.state.database.lastUpdated,
      trancoTier: this.state.database.tranco.tier,
      trancoCount: this.state.database.tranco.count
    };
  }

  /**
   * Trust Database の読み取り専用コピーを取得
   */
  getDatabase(): TrustDatabase | null {
    return this.state.database;
  }

  /**
   * JP-Anchor TLD リストを取得
   */
  getJpAnchorTlds(): string[] {
    if (!this.state.database) return [];
    return [...this.state.database.jpAnchor.tlds, ...this.state.database.jpAnchor.userTlds];
  }

  /**
   * JP-Anchor TLD を追加（addUserTld と同じ jpAnchor.userTlds を操作する）
   */
  async addJpAnchorTld(tld: string): Promise<{ success: boolean; error?: string }> {
    return this.addUserTld(tld);
  }

  /**
   * JP-Anchor TLD を削除
   */
  async removeJpAnchorTld(tld: string): Promise<{ success: boolean; error?: string }> {
    return this.removeUserTld(tld);
  }

  /**
   * Sensitive ドメインリストを取得（カテゴリ指定）
   */
  getSensitiveDomains(category: 'finance' | 'gaming' | 'sns'): string[] {
    if (!this.state.database || !this.sensitiveDomainStore) return [];
    return this.sensitiveDomainStore.getSensitiveDomains(category);
  }

  /**
   * Sensitive ドメインを追加
   */
  async addSensitiveDomain(domain: string, _category?: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database || !this.sensitiveDomainStore) {
      return { success: false, error: 'Database not initialized' };
    }
    return this.sensitiveDomainStore.addSensitiveDomain(domain);
  }

  /**
   * Sensitive ドメインを削除
   */
  async removeSensitiveDomain(domain: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database || !this.sensitiveDomainStore) {
      return { success: false, error: 'Database not initialized' };
    }
    return this.sensitiveDomainStore.removeSensitiveDomain(domain);
  }

  /**
   * Whitelist を取得
   */
  getWhitelist(): string[] {
    if (!this.state.database || !this.whitelistStore) return [];
    return this.whitelistStore.getWhitelist();
  }

  /**
   * Whitelist にドメインを追加
   */
  async addToWhitelist(domain: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database || !this.whitelistStore) {
      return { success: false, error: 'Database not initialized' };
    }
    return this.whitelistStore.addToWhitelist(domain);
  }

  /**
   * Whitelist からドメインを削除
   */
  async removeFromWhitelist(domain: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database || !this.whitelistStore) {
      return { success: false, error: 'Database not initialized' };
    }
    return this.whitelistStore.removeFromWhitelist(domain);
  }

  // ===== Tranco バージョン追跡（Phase 1） =====

  /**
   * 現在の Tranco バージョンを取得
   */
  getCurrentTrancoVersion(): string {
    return this.trancoVersionTracker.getCurrentTrancoVersion();
  }

  /**
   * 保存されている Tranco バージョンを取得
   */
  async getSavedTrancoVersion(): Promise<string | null> {
    return this.trancoVersionTracker.getSavedTrancoVersion();
  }

  /**
   * Tranco バージョンを更新
   */
  async updateTrancoVersion(version: string, domains: string[]): Promise<void> {
    return this.trancoVersionTracker.updateTrancoVersion(version, domains);
  }

  /**
   * Tranco バージョン更新を検知した場合の結果を取得
   */
  async checkTrancoUpdate(): Promise<{ hasUpdate: boolean; oldVersion: string | null; newVersion: string }> {
    return this.trancoVersionTracker.checkTrancoUpdate();
  }

  /**
   * 保存された Tranco ドメインリストを取得（旧リスト保持用）
   */
  async getSavedTrancoDomains(): Promise<string[]> {
    return this.trancoVersionTracker.getSavedTrancoDomains();
  }

  /**
   * 訪問ドメインが Tranco ドメインかを判定
   */
  isTrancoDomain(domain: string): boolean {
    return this.trancoManager.isTrancoDomain(domain);
  }
}

// ===== シングルトンインスタンス =====

let trustDbInstance: TrustDb | null = null;

export function getTrustDb(): TrustDb {
  if (!trustDbInstance) {
    trustDbInstance = new TrustDb();
  }
  return trustDbInstance;
}

// ===== ユーティリティ関数 =====

/**
 * ドメインが信頼済みかを簡易確認
 */
export async function isDomainTrusted(domain: string): Promise<TrustResult> {
  const db = getTrustDb();
  await db.initialize();
  return db.isDomainTrusted(domain);
}
