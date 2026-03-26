/**
 * trustDb.ts
 * Trust Database main logic and 3-Step Verification (Phase 1)
 */

import type {
  TrustResult,
  TrustDatabase,
  TrancoConfig,
  JpAnchorConfig,
  SensitiveDomainsConfig
} from './trustDbSchema.js';
import { DomainTrustLevel, type BloomFilterData } from './trustDbSchema.js';
import { TrustBloomFilter, bloomFilterFromData, bloomFilterFromDomains } from './bloomFilter.js';
import { logDebug, logInfo, logWarn, logError, ErrorCode } from '../logger.js';
import { withOptimisticLock } from '../optimisticLock.js';
import { TRANCO_VERSION as CURRENT_TRANCO_VERSION } from './presetDomains.js';

// ===== 定数 =====

const DB_VERSION = '1.0.0';
const STORAGE_KEY = 'trust_db:json';
const STORAGE_KEY_BLOOM = 'trust_db:bloom';

// Tranco バージョン追跡（Phase 1）
const STORAGE_KEY_TRANCO_VERSION = 'tranco_version';
const STORAGE_KEY_TRANCO_DOMAINS = 'tranco_domains';

// 30日（ミリ秒）- 同意拒否後の再確認間隔
const CONSENT_RETRY_DAYS = 30;

// JP-Anchor プリセット TLD
const JP_ANCHOR_TLDS_PRESET = ['.go.jp', '.ac.jp', '.lg.jp'] as const;

// Sensitive ドメインプリセット（固定）
const SENSITIVE_DOMAINS_PRESETS = {
  finance: [
    'rakuten.co.jp',
    'sbi.co.jp',
    'shinseibank.com',
    'smfb.co.jp',
    'resona.co.jp',
    'mufg.co.jp',
    'smbc.co.jp',
    'dc-card.co.jp',
    'ucard.co.jp',
    'ufj.co.jp',
    'sumitomo.co.jp',
    'orix.co.jp',
    'credit Saison.co.jp',
    'aeon.co.jp',
    'sevenbank.co.jp',
    'japanpost.jp',
    'yucho.co.jp',
    'cisco.co.jp',
    'aeoncredit.co.jp',
    'jcb.co.jp',
    'vodafone.co.jp'
  ],
  gaming: [
    'nintendo.com',
    'bandainamco.co.jp',
    'square-enix.com',
    'capcom.com',
    'sega.com',
    'konami.com',
    'pokemon.com',
    'level5.com',
    'falcom.co.jp',
    'sega.net'
  ],
  sns: [
    'twitter.com',
    'instagram.com',
    'x.com',
    'facebook.com',
    'line.me',
    'weibo.com',
    't.co'
  ]
} as const;

// 入力バリデーション /////////////////////////

// RFC 1035 / RFC 1123 準拠のドメイン名正規表現（trancoUpdater.ts から移植）
// ルール:
// - ラベルには英字、数字、ハイフンのみ使用可能
// - ラベルは英字または数字で始まり、英字または数字で終わる（ハイフンは不可）
// - ラベルの最大長: 63 文字
// - ドメイン全体の最大長: 253 文字
// - 大文字小文字は区別しない
const DOMAIN_REGEX = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/i;

/**
 * RFC準拠のドメイン名バリデーション
 * @param domain バリデーション対象のドメイン名
 * @returns 有効なドメイン名の場合 true、それ以外の場合 false
 */
function isValidDomain(domain: string): boolean {
  const normalized = domain.toLowerCase().trim();

  // ドメインが空でないこと
  if (!normalized) {
    return false;
  }

  // 最大長チェック（RFC 1035: 253文字）
  if (normalized.length > 253) {
    return false;
  }

  // ドットで始まらないこと（TLD用プレフィックスとして使用する場合を除く）
  if (normalized.startsWith('.')) {
    return false;
  }

  // ドットで終わらないこと
  if (normalized.endsWith('.')) {
    return false;
  }

  // ドットを含まない場合（TLD単体など）はドメインとして扱わない
  if (!normalized.includes('.')) {
    return false;
  }

  // 正規表現による構造チェック
  if (!DOMAIN_REGEX.test(normalized)) {
    return false;
  }

  // 各ラベルの長さチェック（最大63文字）
  const labels = normalized.split('.');
  for (const label of labels) {
    if (label.length === 0) {
      return false; // 連続するドット
    }
    if (label.length > 63) {
      return false; // ラベルが長すぎる
    }
  }

  return true;
}

/**
 * TLD バリデーション
 * @param tld バリデーション対象のTLD（.を含むか含まない）
 * @returns 有効なTLDの場合 true、それ以外の場合 false
 */
function isValidTld(tld: string): boolean {
  const normalized = tld.trim();

  // ドットがない場合は追加
  if (!normalized.startsWith('.')) {
    return isValidTld('.' + normalized);
  }

  // . を除いた部分のみをドメインとして検証
  const tldWithoutDot = normalized.slice(1);

  // 最小長チェック（最低2文字）
  if (tldWithoutDot.length < 2) {
    return false;
  }

  // 最大長チェック（63文字）
  if (tldWithoutDot.length > 63) {
    return false;
  }

  // ドメインルールと同様の構造チェック（ドットを含まない単一ラベルとして）
  const labelRegex = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  return labelRegex.test(tldWithoutDot);
}

// ===== trustDb インターフェース =====

interface TrustDbState {
  database: TrustDatabase | null;
  bloomFilter: TrustBloomFilter | null;
  trancoSet: Set<string>;
  initialized: boolean;
}

class TrustDb {
  private static initPromise: Promise<void> | null = null;
  private state: TrustDbState = {
    database: null,
    bloomFilter: null,
    trancoSet: new Set(),
    initialized: false
  };

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
      // ストレージからデータをロード
      const [savedDb, savedBloom] = await Promise.all([
        chrome.storage.local.get(STORAGE_KEY).then(result => result[STORAGE_KEY]),
        chrome.storage.local.get(STORAGE_KEY_BLOOM).then(result => result[STORAGE_KEY_BLOOM])
      ]);

      if (savedDb && savedBloom) {
        // 既存データをロード
        this.state.database = savedDb as TrustDatabase;
        this.state.bloomFilter = bloomFilterFromData(savedBloom as BloomFilterData);

        // バージョンを確認・マイグレーション
        if (this.state.database.version !== DB_VERSION) {
          await this.migrateDatabase(this.state.database);
        }

        // trancoSet を再構築（サービスワーカー再起動後もキャッシュを有効化）
        this.state.trancoSet = new Set(this.state.database.tranco.domains);
        logInfo('TrustDb', {
          version: this.state.database.version,
          domainCount: this.state.database.tranco.count
        }, 'Loaded existing database');
      } else {
        // 新規作成
        await this.createDefaultDatabase();
      }

      this.state.initialized = true;
    } catch (error) {
      logError('TrustDb', { error }, ErrorCode.TRUST_DB_INIT_FAILED);
      throw error;
    }
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
   * バージョン比較
   * @param v1 比較対象1
   * @param v2 比較対象2
   * @returns v1 < v2 の場合は負の値、v1 > v2 の場合は正の値、等しい場合は 0
   */
  private compareVersions(v1: string, v2: string): number {
    const normalize = (v: string) => v.split('.').map(x => parseInt(x, 10) || 0);
    const [major1, minor1, patch1] = normalize(v1);
    const [major2, minor2, patch2] = normalize(v2);

    if (major1 !== major2) return major1 - major2;
    if (minor1 !== minor2) return minor1 - minor2;
    return patch1 - patch2;
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

    // 楽観的ロックで保護して保存（JSONとBloomFilter両方を同時に更新）
    await withOptimisticLock(STORAGE_KEY, async (_currentDb) => {
      // chrome.storage.local.setは複数キーの更新もアトミック
      await chrome.storage.local.set({
        [STORAGE_KEY]: this.state.database,
        [STORAGE_KEY_BLOOM]: bloomData
      });
      // 初期化時は currentDb が undefined でも許可する
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
    const candidates: string[] = [domain];
    const parts = domain.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      candidates.push(parts.slice(i).join('.'));
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
        // インデックスを取得 (rank 報告用)
        const index = db.tranco.domains.indexOf(candidate);
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
    await this.save();

    logInfo('TrustDb', { tier, count: domains.length }, `Updated Tranco list: ${domains.length} domains`);
  }

  /**
   * TLD を jpAnchor.userTlds に追加する共通ロジック（addUserTld / addJpAnchorTld の共有）
   */
  private async _addTldToUserList(tld: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database) {
      return { success: false, error: 'Database not initialized' };
    }

    // Validate TLD format using RFC-compliant function
    if (!isValidTld(tld)) {
      return {
        success: false,
        error: 'Invalid TLD format. TLD must contain only letters, numbers, and hyphens, must start/end with a letter or number, and be 2-63 characters long (e.g., .com, .jp, .ai)'
      };
    }

    // Ensure TLD starts with dot
    if (!tld.startsWith('.')) {
      tld = '.' + tld;
    }

    // Check for duplicates
    if (this.state.database.jpAnchor.tlds.includes(tld) || this.state.database.jpAnchor.userTlds.includes(tld)) {
      return { success: false, error: 'TLD already exists' };
    }

    this.state.database.jpAnchor.userTlds.push(tld);
    await this.save();
    return { success: true };
  }

  /**
   * ユーザー TLD 追加
   */
  async addUserTld(tld: string): Promise<{ success: boolean; error?: string }> {
    return this._addTldToUserList(tld);
  }

  /**
   * ユーザー TLD 削除
   */
  async removeUserTld(tld: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database) {
      return { success: false, error: 'Database not initialized' };
    }

    const index = this.state.database.jpAnchor.userTlds.indexOf(tld);
    if (index !== -1) {
      this.state.database.jpAnchor.userTlds.splice(index, 1);
      await this.save();
      return { success: true };
    }

    return { success: false, error: 'TLD not found' };
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
   * JP-Anchor TLD を追加
   */
  async addJpAnchorTld(tld: string): Promise<{ success: boolean; error?: string }> {
    return this._addTldToUserList(tld);
  }

  /**
   * JP-Anchor TLD を削除
   */
  async removeJpAnchorTld(tld: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database) {
      return { success: false, error: 'Database not initialized' };
    }

    const index = this.state.database.jpAnchor.userTlds.indexOf(tld);
    if (index !== -1) {
      this.state.database.jpAnchor.userTlds.splice(index, 1);
      await this.save();
      return { success: true };
    }

    return { success: false, error: 'TLD not found' };
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
    if (!this.state.database) {
      return { success: false, error: 'Database not initialized' };
    }

    const normalizedDomain = domain.toLowerCase().trim();

    // Validate domain format using RFC-compliant function
    if (!isValidDomain(normalizedDomain)) {
      return {
        success: false,
        error: 'Invalid domain format. Domain must follow RFC standards: contain only letters, numbers, hyphens, and dots, start/end with letter or number, and be max 253 characters long'
      };
    }

    // Check for duplicates
    if (this.state.database.sensitive.userBlacklist.includes(normalizedDomain)) {
      return { success: false, error: 'Domain already exists' };
    }

    this.state.database.sensitive.userBlacklist.push(normalizedDomain);
    await this.save();
    return { success: true };
  }

  /**
   * Sensitive ドメインを削除
   */
  async removeSensitiveDomain(domain: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database) {
      return { success: false, error: 'Database not initialized' };
    }

    const index = this.state.database.sensitive.userBlacklist.indexOf(domain);
    if (index !== -1) {
      this.state.database.sensitive.userBlacklist.splice(index, 1);
      await this.save();
      return { success: true };
    }

    return { success: false, error: 'Domain not found' };
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
    if (!this.state.database) {
      return { success: false, error: 'Database not initialized' };
    }

    const normalizedDomain = domain.toLowerCase().trim();

    // Validate domain format using RFC-compliant function
    if (!isValidDomain(normalizedDomain)) {
      return {
        success: false,
        error: 'Invalid domain format. Domain must follow RFC standards: contain only letters, numbers, hyphens, and dots, start/end with letter or number, and be max 253 characters long'
      };
    }

    // Check for duplicates
    if (this.state.database.sensitive.whitelist.includes(normalizedDomain)) {
      return { success: false, error: 'Domain already exists' };
    }

    this.state.database.sensitive.whitelist.push(normalizedDomain);
    await this.save();
    return { success: true };
  }

  /**
   * Whitelist からドメインを削除
   */
  async removeFromWhitelist(domain: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database) {
      return { success: false, error: 'Database not initialized' };
    }

    const index = this.state.database.sensitive.whitelist.indexOf(domain);
    if (index !== -1) {
      this.state.database.sensitive.whitelist.splice(index, 1);
      await this.save();
      return { success: true };
    }

    return { success: false, error: 'Domain not found' };
  }

  // ===== Tranco バージョン追跡（Phase 1） =====

  /**
   * 現在の Tranco バージョンを取得
   */
  getCurrentTrancoVersion(): string {
    return CURRENT_TRANCO_VERSION;
  }

  /**
   * 保存されている Tranco バージョンを取得
   */
  async getSavedTrancoVersion(): Promise<string | null> {
    const result = await chrome.storage.local.get(STORAGE_KEY_TRANCO_VERSION);
    return result[STORAGE_KEY_TRANCO_VERSION] as string || null;
  }

  /**
   * Tranco バージョンを更新
   */
  async updateTrancoVersion(version: string, domains: string[]): Promise<void> {
    await chrome.storage.local.set({
      [STORAGE_KEY_TRANCO_VERSION]: version,
      [STORAGE_KEY_TRANCO_DOMAINS]: domains
    });
    logInfo('TrustDb', { version, domainCount: domains.length }, 'Tranco version updated');
  }

  /**
   * Tranco バージョン更新を検知した場合の結果を取得
   */
  async checkTrancoUpdate(): Promise<{ hasUpdate: boolean; oldVersion: string | null; newVersion: string }> {
    const savedVersion = await this.getSavedTrancoVersion();
    const currentVersion = this.getCurrentTrancoVersion();

    if (savedVersion !== currentVersion) {
      logInfo('TrustDb', { savedVersion, currentVersion }, 'Tranco version update detected');
      return {
        hasUpdate: true,
        oldVersion: savedVersion,
        newVersion: currentVersion
      };
    }

    return {
      hasUpdate: false,
      oldVersion: savedVersion,
      newVersion: currentVersion
    };
  }

  /**
   * 保存された Tranco ドメインリストを取得（旧リスト保持用）
   */
  async getSavedTrancoDomains(): Promise<string[]> {
    const result = await chrome.storage.local.get(STORAGE_KEY_TRANCO_DOMAINS);
    return result[STORAGE_KEY_TRANCO_DOMAINS] as string[] || [];
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