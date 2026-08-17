/**
 * trustDb.ts
 * Trust Database main logic and 3-Step Verification (Phase 1)
 */

import type {
  TrustResult,
  TrustDatabase,
  TrancoConfig,
} from './trustDbSchema.js';
import { DomainTrustLevel, type BloomFilterData } from './trustDbSchema.js';
import { TrustBloomFilter, bloomFilterFromData, bloomFilterFromDomains } from './bloomFilter.js';
import { logDebug, logInfo, logWarn, logError, ErrorCode } from '../logger.js';
import { withOptimisticLock } from '../optimisticLock.js';
import { TRANCO_VERSION as CURRENT_TRANCO_VERSION } from './presetDomains.js';
import { SENSITIVE_DOMAINS_PRESETS as PRESETS, JP_ANCHOR_TLDS } from './presets.js';

// ===== 定数 =====

const DB_VERSION = '1.0.0';
const STORAGE_KEY = 'trust_db:json';

// 30日（ミリ秒）- 同意拒否後の再確認間隔
const _CONSENT_RETRY_DAYS = 30;

// JP-Anchor プリセット TLD（presets.ts から取得）
const JP_ANCHOR_TLDS_PRESET = [...JP_ANCHOR_TLDS] as readonly string[];

// Sensitive ドメインプリセット（presets.ts から取得。正本は presets.ts に一元化）
const SENSITIVE_DOMAINS_PRESETS = PRESETS;

// 入力バリデーション /////////////////////////

// RFC 1035 / RFC 1123 準拠のドメイン名正規表現（trancoUpdater.ts から移植）
// ルール:
// - ラベルには英字、数字、ハイフンのみ使用可能
// - ラベルは英字または数字で始まり、英字または数字で終わる（ハイフンは不可）
// - ラベルの最大長: 63 文字
// - ドメイン全体の最大長: 253 文字
// - 大文字小文字は区別しない

// ドメインバリデーション関数は domainValidation.ts に抽出済み
import { isValidDomain, isValidTld, compareVersions as _compareVersions } from './domainValidation.js';
import { ManagedStringList } from './managedStringList.js';
import { TrancoVersionTracker } from './trancoVersionTracker.js';

// ===== settingsStore 動的import ヘルパー（PBI-2026-08-01-20） =====
//
// settingsStore.ts との循環参照回避のため動的importを使う（settingsStore.ts
// 側も trustDb.ts を動的importしている）。ESMの動的importは2回目以降
// モジュールキャッシュされるためこのメモ化自体に性能上の意味はほぼないが、
// 呼び出し側の重複コードを1箇所に集約する目的で用意している。

let settingsStoreModule: typeof import('../storage/settingsStore.js') | undefined;
let storageTypesModule: typeof import('../storage/types.js') | undefined;

async function getSettingsStore(): Promise<typeof import('../storage/settingsStore.js')> {
  if (!settingsStoreModule) {
    settingsStoreModule = await import('../storage/settingsStore.js');
  }
  return settingsStoreModule;
}

async function getStorageTypes(): Promise<typeof import('../storage/types.js')> {
  if (!storageTypesModule) {
    storageTypesModule = await import('../storage/types.js');
  }
  return storageTypesModule;
}

// ===== trustDb インターフェース =====

interface TrustDbState {
  database: TrustDatabase | null;
  bloomFilter: TrustBloomFilter | null;
  trancoSet: Set<string>;
  trancoRankMap: Map<string, number>;
  initialized: boolean;
}

class TrustDb {
  private static initPromise: Promise<void> | null = null;
  private state: TrustDbState = {
    database: null,
    bloomFilter: null,
    trancoSet: new Set(),
    trancoRankMap: new Map(),
    initialized: false
  };

  // Built once initialize() has loaded/created this.state.database, since
  // ManagedStringList needs a stable reference to the backing array.
  private userTldsList: ManagedStringList | null = null;
  private sensitiveDomainsList: ManagedStringList | null = null;
  private whitelistList: ManagedStringList | null = null;

  private readonly trancoVersionTracker = new TrancoVersionTracker({
    getSettingsStore,
    getStorageTypes,
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
        // 既存データをロード
        this.state.database = savedDb;
        this.state.bloomFilter = bloomFilterFromData(savedDb.bloomFilter);

        // バージョンを確認・マイグレーション
        if (this.state.database.version !== DB_VERSION) {
          await this.migrateDatabase(this.state.database);
        }

        // trancoSet を再構築（サービスワーカー再起動後もキャッシュを有効化）
        this.state.trancoSet = new Set(this.state.database.tranco.domains);

        // trancoRankMap を構築 (O(1) ランク検索用)
        this.state.trancoRankMap = new Map(this.state.database.tranco.domains.map((domain, index) => [domain, index]));

        logInfo('TrustDb', {
          version: this.state.database.version,
          domainCount: this.state.database.tranco.count
        }, 'Loaded existing database');
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
   * ManagedStringList インスタンスを構築する（DB ロード/マイグレーション/新規作成の
   * いずれの経路でも、initialize() の最後に一度だけ呼ばれる）。
   */
  private buildManagedStringLists(): void {
    const db = this.state.database!;

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
  }

  /**
   * データベースのマイグレーション
   * @param db マイグレーション対象のデータベース
   */
  private async migrateDatabase(db: TrustDatabase): Promise<void> {
    const currentVersion = db.version || '0.0.0';
    const targetVersion = DB_VERSION;

    logInfo('TrustDb', { from: currentVersion, to: targetVersion }, 'Starting database migration');

    try {
      // バージョン比較とマイグレーションパスの実行
      if (this.compareVersions(currentVersion, targetVersion) < 0) {
        await this.applyMigrations(currentVersion, targetVersion, db);

        // マイグレーション後のデータを保存（バージョン更新前に保存）
        await this.save();

        // バージョンを更新（保存成功後にのみ更新）
        db.version = targetVersion;
        db.lastUpdated = new Date().toISOString();

        // バージョン更新を保存
        await this.save();

        logInfo('TrustDb', { to: targetVersion }, 'Database migration completed');
      }
    } catch (error) {
      logError('TrustDb', { from: currentVersion, to: targetVersion, error }, ErrorCode.TRUST_DB_MIGRATION_FAILED);
      throw error;
    }
  }

  /**
   * バージョン比較（domainValidation.ts の compareVersions に委譲）
   */
  private compareVersions(v1: string, v2: string): number {
    return _compareVersions(v1, v2);
  }

  /**
   * マイグレーションパスの適用
   * @param from 以前のバージョン
   * @param to ターゲットバージョン
   * @param db データベース
   */
  private async applyMigrations(from: string, to: string, db: TrustDatabase): Promise<void> {
    // 将来的なマイグレーションパスはここに追加
    // 例: v1.0.0 -> v1.1.0、v1.1.0 -> v1.2.0 など

    // 現在はマイグレーションパスが定義されていないため、
    // 新規スキーマに合うようにデフォルト値を設定するのみ
    logDebug('TrustDb', { from, to }, 'Applying migration defaults');

    // デフォルト値の設定（既存データに欠けているフィールドがあれば追加）
    if (!db.tranco) {
      db.tranco = { tier: 'top10k', domains: [], count: 0, sizeBytes: 0 };
    }
    if (!db.jpAnchor) {
      db.jpAnchor = { tlds: [...JP_ANCHOR_TLDS_PRESET], userTlds: [] };
    }
    if (!db.sensitive) {
      db.sensitive = {
        presets: {
          finance: [...SENSITIVE_DOMAINS_PRESETS.finance],
          gaming: [...SENSITIVE_DOMAINS_PRESETS.gaming],
          sns: [...SENSITIVE_DOMAINS_PRESETS.sns]
        },
        userBlacklist: [],
        whitelist: []
      };
    }
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
      bloomFilter: await this.createBloomFilterFromPresets()
    };

    this.state.database = db;
    this.state.bloomFilter = bloomFilterFromData(db.bloomFilter);

    // trancoRankMap を初期化
    this.state.trancoRankMap = new Map();

    await this.save();
    logInfo('TrustDb', {}, 'Created default database');
  }

  /**
   * プリセットから Bloom Filter データを作成
   */
  private createBloomFilterFromPresets(): Promise<BloomFilterData> {
    const allSensitiveDomains: string[] = Object.values(SENSITIVE_DOMAINS_PRESETS).flat();

    const bloom = bloomFilterFromDomains(allSensitiveDomains, 0.01);
    return Promise.resolve(bloom.toData());
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

    // Save the entire database atomically via optimistic lock
    await withOptimisticLock(STORAGE_KEY, async (_currentDb) => {
      // Return the current database state; the lock handler persists it
      return this.state.database;
    });

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

    // URL が渡された場合はホスト名を抽出する
    let normalizedDomain = domain.toLowerCase().trim();
    if (normalizedDomain.startsWith('http://') || normalizedDomain.startsWith('https://')) {
      try {
        normalizedDomain = new URL(normalizedDomain).hostname;
      } catch {
        // パース失敗はそのまま使用
      }
    }

    // Step 1: JP-Anchor TLD 判定
    const anchorResult = this.checkJpAnchor(normalizedDomain);
    if (anchorResult.level === DomainTrustLevel.TRUSTED) {
      return anchorResult;
    }

    // Step 2: Sensitive List 判定
    const sensitiveResult = this.checkSensitive(normalizedDomain);
    if (sensitiveResult.level === DomainTrustLevel.SENSITIVE) {
      return sensitiveResult;
    }

    // Step 3: Tranco 判定
    const trancoResult = this.checkTranco(normalizedDomain);
    if (trancoResult.level === DomainTrustLevel.TRUSTED) {
      return trancoResult;
    }

    return {
      level: DomainTrustLevel.UNVERIFIED,
      source: 'unknown',
      reason: 'Domain not in any trusted list'
    };
  }

  /**
   * Step 1: JP-Anchor TLD 判定
   */
  private checkJpAnchor(domain: string): TrustResult {
    const allTlds = [
      ...this.state.database!.jpAnchor.tlds,
      ...this.state.database!.jpAnchor.userTlds
    ];

    for (const tld of allTlds) {
      if (domain.endsWith(tld)) {
        return {
          level: DomainTrustLevel.TRUSTED,
          source: 'jp-anchor',
          reason: `Domain ends with ${tld}`,
          category: 'anchor'
        };
      }
    }

    return { level: DomainTrustLevel.UNVERIFIED, source: 'unknown', reason: 'Not a JP-Anchor domain' };
  }

  /**
   * Step 2: Sensitive List 判定
   */
  private checkSensitive(domain: string): TrustResult {
    const db = this.state.database!;

    // ホワイトリスト優先
    if (db.sensitive.whitelist.includes(domain)) {
      return {
        level: DomainTrustLevel.TRUSTED,
        source: 'whitelist',
        reason: 'Domain is in user whitelist',
        category: 'unknown'
      };
    }

    // ユーザー追加ブラックリスト
    if (db.sensitive.userBlacklist.includes(domain)) {
      return {
        level: DomainTrustLevel.SENSITIVE,
        source: 'user-blacklist',
        reason: 'Domain is in user blacklist',
        category: 'unknown'
      };
    }

    // Bloom Filter でチェック（偽陽性の可能性あり）
    if (!this.state.bloomFilter!.mightContain(domain)) {
      return { level: DomainTrustLevel.UNVERIFIED, source: 'unknown', reason: 'Not in sensitive list' };
    }

    // 精密照合（偽陽性チェック）
    const financeCheck = this.checkCategory(domain, db.sensitive.presets.finance, 'finance');
    if (financeCheck) return financeCheck;

    const gamingCheck = this.checkCategory(domain, db.sensitive.presets.gaming, 'gaming');
    if (gamingCheck) return gamingCheck;

    const snsCheck = this.checkCategory(domain, db.sensitive.presets.sns, 'sns');
    if (snsCheck) return snsCheck;

    // Bloom Filter 偽陽性
    return { level: DomainTrustLevel.UNVERIFIED, source: 'unknown', reason: 'Bloom filter false positive' };
  }

  /**
   * カテゴリ固有のチェック
   */
  private checkCategory(
    domain: string,
    list: string[],
    category: 'finance' | 'gaming' | 'sns'
  ): TrustResult | null {
    if (list.includes(domain)) {
      return {
        level: DomainTrustLevel.SENSITIVE,
        source: 'sensitive-presets',
        reason: `Domain is in ${category} sensitive list`,
        category
      };
    }
    return null;
  }

  /**
   * Step 3: Tranco 判定
   * 最適化: キャッシュされたSet を使用して O(1) 検索
   */
  private checkTranco(domain: string): TrustResult {
    const db = this.state.database!;

    if (db.tranco.domains.length === 0) {
      return { level: DomainTrustLevel.UNVERIFIED, source: 'unknown', reason: 'Tranco list is empty' };
    }

    // サブドメインを除いた候補リストを生成 (例: edition.cnn.com → [edition.cnn.com, cnn.com])
    // 【修正】2部ドメインでも正しくサブドメイン除去を行えるようループ条件を修正
    const candidates: string[] = [domain];
    const parts = domain.split('.');
    // 少なくとも1ラベル（TLDは除く）残すようにする
    for (let i = 1; i < parts.length; i++) {
      const candidate = parts.slice(i).join('.');
      // TLDのみにならないようにチェック（ドットを含むことを確認）
      if (candidate.includes('.')) {
        candidates.push(candidate);
      }
    }

    // キャッシュされたSetを使用 (O(1) 検索)
    const trancoSet = this.state.trancoSet;

    for (const candidate of candidates) {
      // Bloom Filter でチェック
      if (!this.state.bloomFilter!.mightContain(candidate)) {
        continue;
      }

      // 精密照合 (Set.has は O(1))
      if (trancoSet.has(candidate)) {
        // インデックスを取得 (rank 報告用) - O(1) マップ検索
        const index = this.state.trancoRankMap.get(candidate)!;
        return {
          level: DomainTrustLevel.TRUSTED,
          source: 'tranco',
          reason: `Domain is in Tranco top ${db.tranco.tier} at rank ${index + 1}`,
          category: 'tranco'
        };
      }
    }

    return { level: DomainTrustLevel.UNVERIFIED, source: 'unknown', reason: 'Not in Tranco list' };
  }

  /**
   * データベース更新（外部から）
   */
  async updateTranco(domains: string[], tier: string): Promise<void> {
    const db = this.state.database;
    if (!db) {
      throw new Error('TrustDb not initialized');
    }

    // Bloom Filter 生成
    const bloom = bloomFilterFromDomains([
      ...domains,
      ...db.sensitive.presets.finance,
      ...db.sensitive.presets.gaming,
      ...db.sensitive.presets.sns
    ]);

    // 更新
    db.tranco = {
      tier: tier as TrancoConfig['tier'],
      domains,
      count: domains.length,
      sizeBytes: domains.join('\n').length
    };

    this.state.bloomFilter = bloom;
    this.state.trancoSet = new Set(domains); // Setをキャッシュ

    // trancoRankMap を構築 (O(1) ランク検索用)
    this.state.trancoRankMap = new Map(domains.map((domain, index) => [domain, index]));

    await this.save();

    logInfo('TrustDb', { tier, count: domains.length }, `Updated Tranco list: ${domains.length} domains`);
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
    return DB_VERSION;
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
    if (!this.state.database) return [];
    const db = this.state.database;
    return [...db.sensitive.presets[category], ...db.sensitive.userBlacklist];
  }

  /**
   * Sensitive ドメインを追加
   */
  async addSensitiveDomain(domain: string, _category?: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database || !this.sensitiveDomainsList) {
      return { success: false, error: 'Database not initialized' };
    }
    return this.sensitiveDomainsList.add(domain);
  }

  /**
   * Sensitive ドメインを削除
   */
  async removeSensitiveDomain(domain: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database || !this.sensitiveDomainsList) {
      return { success: false, error: 'Database not initialized' };
    }
    return this.sensitiveDomainsList.remove(domain);
  }

  /**
   * Whitelist を取得
   */
  getWhitelist(): string[] {
    if (!this.state.database) return [];
    return [...this.state.database.sensitive.whitelist];
  }

  /**
   * Whitelist にドメインを追加
   */
  async addToWhitelist(domain: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database || !this.whitelistList) {
      return { success: false, error: 'Database not initialized' };
    }
    return this.whitelistList.add(domain);
  }

  /**
   * Whitelist からドメインを削除
   */
  async removeFromWhitelist(domain: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database || !this.whitelistList) {
      return { success: false, error: 'Database not initialized' };
    }
    return this.whitelistList.remove(domain);
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
    let normalized = domain.toLowerCase().trim();
    if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
      try {
        normalized = new URL(normalized).hostname;
      } catch {
        // パース失敗はそのまま使用
      }
    }
    return this.state.trancoSet.has(normalized);
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