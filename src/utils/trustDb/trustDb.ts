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
import { logDebug, logInfo, logError, ErrorCode } from '../logger.js';

// ===== 定数 =====

const DB_VERSION = '1.0.0';
const STORAGE_KEY = 'trust_db:json';
const STORAGE_KEY_BLOOM = 'trust_db:bloom';

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

// ===== trustDb インターフェース =====

interface TrustDbState {
  database: TrustDatabase | null;
  bloomFilter: TrustBloomFilter | null;
  initialized: boolean;
}

class TrustDb {
  private state: TrustDbState = {
    database: null,
    bloomFilter: null,
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

    try {
      // ストレージからデータをロード
      const [savedDb, savedBloom] = await Promise.all([
        chrome.storage.local.get(STORAGE_KEY).then(result => result[STORAGE_KEY]),
        chrome.storage.local.get(STORAGE_KEY_BLOOM).then(result => result[STORAGE_KEY_BLOOM])
      ]);

      if (savedDb && savedBloom) {
        // 既存データを復元
        this.state.database = savedDb as TrustDatabase;
        this.state.bloomFilter = bloomFilterFromData(savedBloom as BloomFilterData);
        logInfo('TrustDb', { domainCount: (savedDb as any).domainCount || 'unknown' }, 'Loaded existing database');
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
    const allSensitiveDomains: string[] = [
      ...SENSITIVE_DOMAINS_PRESETS.finance,
      ...SENSITIVE_DOMAINS_PRESETS.gaming,
      ...SENSITIVE_DOMAINS_PRESETS.sns
    ];

    const bloom = bloomFilterFromDomains(allSensitiveDomains, 0.01);
    return Promise.resolve(bloom.toData());
  }

  /**
   * データベースを保存
   */
  async save(): Promise<void> {
    if (!this.state.database || !this.state.bloomFilter) {
      throw new Error('TrustDb not initialized');
    }

    const bloomData = this.state.bloomFilter.toData();

    this.state.database.bloomFilter = bloomData;
    this.state.database.lastUpdated = new Date().toISOString();

    await chrome.storage.local.set({
      [STORAGE_KEY]: this.state.database,
      [STORAGE_KEY_BLOOM]: bloomData
    });

    logDebug('TrustDb', {}, 'Database saved');
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

    for (const candidate of candidates) {
      // Bloom Filter でチェック
      if (!this.state.bloomFilter!.mightContain(candidate)) {
        continue;
      }

      // 精密照合
      const index = db.tranco.domains.indexOf(candidate);
      if (index !== -1) {
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
    await this.save();

    logInfo('TrustDb', { tier, count: domains.length }, `Updated Tranco list: ${domains.length} domains`);
  }

  /**
   * ユーザー TLD 追加
   */
  async addUserTld(tld: string): Promise<void> {
    if (!this.state.database) {
      throw new Error('TrustDb not initialized');
    }

    if (!tld.startsWith('.')) {
      tld = '.' + tld;
    }

    if (!this.state.database.jpAnchor.userTlds.includes(tld)) {
      this.state.database.jpAnchor.userTlds.push(tld);
      await this.save();
    }
  }

  /**
   * ユーザー TLD 削除
   */
  async removeUserTld(tld: string): Promise<void> {
    if (!this.state.database) {
      throw new Error('TrustDb not initialized');
    }

    this.state.database.jpAnchor.userTlds =
      this.state.database.jpAnchor.userTlds.filter(t => t !== tld);
    await this.save();
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
    if (!this.state.database) {
      return { success: false, error: 'Database not initialized' };
    }

    // Validate TLD format
    if (!tld.startsWith('.') || tld.length < 2) {
      return { success: false, error: 'Invalid TLD format' };
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
  async addSensitiveDomain(domain: string, category?: string): Promise<{ success: boolean; error?: string }> {
    if (!this.state.database) {
      return { success: false, error: 'Database not initialized' };
    }

    const normalizedDomain = domain.toLowerCase().trim();
    if (!normalizedDomain || normalizedDomain.includes('.') === false) {
      return { success: false, error: 'Invalid domain format' };
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
    if (!normalizedDomain || normalizedDomain.includes('.') === false) {
      return { success: false, error: 'Invalid domain format' };
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