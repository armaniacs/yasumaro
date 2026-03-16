/**
 * trustDbSchema.ts
 * Type definitions for Trust Database (Phase 1)
 */

/**
 * Tranco Tier 選択肢
 */
export type TrancoTier = 'top1k' | 'top10k' | 'top100k';

/**
 * Safety Mode（簡易UIのため）
 */
export type SafetyMode = 'strict' | 'balanced' | 'relaxed';

/**
 * ドメイン信頼判定レベル
 */
export enum DomainTrustLevel {
  TRUSTED = 'trusted',        // JP-Anchor or Tranco上位
  SENSITIVE = 'sensitive',    // 金融/ゲーム/SNS
  UNVERIFIED = 'unverified',  // その他
  LOCKED = 'locked'           // 未許可ドメイン（P0）
}

/**
 * 信頼判定のソース
 */
export type TrustSource =
  | 'jp-anchor'           // JP-Anchor TLD一致
  | 'tranco'              // Trancoランキング上位
  | 'sensitive-presets'   // 金融/ゲーム/SNSプリセット
  | 'user-blacklist'      // ユーザー追加のブラックリスト
  | 'whitelist'           // ユーザー追加のホワイトリスト
  | 'unknown';            // 不明

/**
 * 信頼判定結果
 */
export interface TrustResult {
  level: DomainTrustLevel;
  source: TrustSource;
  reason?: string;
  category?: 'finance' | 'gaming' | 'sns' | 'anchor' | 'tranco' | 'unknown';
}

/**
 * Bloom Filter データ
 */
export interface BloomFilterData {
  data: string;              // Base64エンコードされたビット配列
  hashCount: number;         // ハッシュ関数の数
  bitCount: number;          // ビット数
  expectedDomainCount: number;
  hash: string;              // データ整合性検証用SHA256ハッシュ
}

/**
 * JP-Anchor List 設定
 */
export interface JpAnchorConfig {
  tlds: string[];            // プリセットTLD (.go.jp, .ac.jp, .lg.jp)
  userTlds: string[];        // ユーザー追加TLD
}

/**
 * Sensitive（警戒）ドメイン設定
 */
export interface SensitiveDomainsConfig {
  presets: {
    finance: string[];       // 日本主要金融ドメイン
    gaming: string[];        // 主要ゲームドメイン
    sns: string[];           // 主要SNSドメイン
  };
  userBlacklist: string[];   // ユーザー追加ブラックリスト
  whitelist: string[];       // ユーザー追加ホワイトリスト（除外）
}

/**
 * Tranco List 設定
 */
export interface TrancoConfig {
  tier: TrancoTier;          // top1k / top10k / top100k
  domains: string[];         // ドメインリスト（上位N件）
  count: number;             // ドメイン数
  sizeBytes: number;         // サイズ（バイト）
  lastUpdated?: string;      // ISO 8601 形式
}

/**
 * Trust Database 完全構造
 */
export interface TrustDatabase {
  version: string;           // DBバージョン
  lastUpdated: string;       // ISO 8601 形式
  tranco: TrancoConfig;      // Tranco設定
  jpAnchor: JpAnchorConfig;  // JP-Anchor設定
  sensitive: SensitiveDomainsConfig; // 警戒ドメイン設定
  bloomFilter: BloomFilterData; // Bloom Filterデータ
}

/**
 * Tranco 更新結果
 */
export interface TrancoUpdateResult {
  success: boolean;
  domainsCount: number;
  sizeBytes: number;
  error?: string;
  duration?: number;         // 実行時間（ミリ秒）
}

/**
 * Trust Database 更新結果
 */
export interface TrustDbUpdateResult {
  success: boolean;
  error?: string;
  version?: string;
  lastUpdated?: string;
}

/**
 * Alert Settings
 */
export interface AlertSettings {
  alertFinance: boolean;     // 金融サイト警告
  alertSensitive: boolean;   // 警戒リスト警告
  alertUnverified: boolean;  // 未検証サイト警告
}

/**
 * Safety Mode 関連設定
 */
export interface SafetyConfig {
  mode: SafetyMode;
  trancoTier: TrancoTier;
  alerts: AlertSettings;
}