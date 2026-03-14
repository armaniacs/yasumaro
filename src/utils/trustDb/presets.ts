/**
 * presets.ts
 * Default presets for Trust Database (Phase 1)
 * Initial domain lists and configurations
 */

import type {
  BloomFilterData,
  JpAnchorConfig,
  SensitiveDomainsConfig,
  TrancoConfig,
  TrustDatabase,
} from './trustDbSchema.js';

/**
 * JP-Anchor TLD プリセット
 * 日本の公式ドメイン接尾辞
 */
export const JP_ANCHOR_TLDS: string[] = [
  '.go.jp',  // Government organizations
  '.ac.jp',  // Academic institutions
  '.lg.jp',  // Local government
];

/**
 * Sensitive（警戒）ドメインプリセット
 */
export const SENSITIVE_DOMAINS_PRESETS = {
  finance: [
    // 日本主要金融機関
    'rakuten.co.jp',
    'sbi.co.jp',
    'shinseibank.com',
    'jp-bank.japanpost.jp',
    'smlb.co.jp',
    'resona.co.jp',
    'sumitomomitsui.co.jp',
    'mizuhobank.co.jp',
    'ufj.co.jp',
    'nomura.co.jp',
    'daiwa.co.jp',
    'nomura.co.jp',
    'smbc.co.jp',
    // 主要クレジットカード
    'card.co.jp',           // JCB Co., Ltd.
    'marinecredit.co.jp',   // MUFJ (旧UFJ)
    'amex.jp',              // American Express Japan
    // 銀行系クレジットカード
    'dccard.co.jp',
    'nicos.co.jp',
    'uc-card.co.jp',
    'jcb.co.jp',
    'citibank.co.jp',
  ],
  gaming: [
    // 主要ゲーム会社
    'nintendo.com',
    'nintendo.co.jp',
    'bandainamco.co.jp',
    'square-enix.com',
    'square-enix.co.jp',
    'sega.co.jp',
    'capcom.co.jp',
    'konami.com',
    'konami.jp',
    'dena.com',
    'gree.jp',
    'mixi.co.jp',           // 元SNS、現在ゲーム中心
  ],
  sns: [
    // 主要SNS
    'twitter.com',
    'x.com',
    'instagram.com',
    'facebook.com',
    'linkedin.com',
    'pinterest.com',
    'tiktok.com',
    'reddit.com',
  ],
};

/**
 * デフォルト Tranco Tier 設定（初回のみ）
 * ユーザーが更新した場合、設定が上書きされる
 */
export const DEFAULT_TRANC_TIER: 'top1k' | 'top10k' | 'top100k' = 'top10k';

/**
 * Trust Database 初期値を生成
 */
export function createDefaultTrustDb(): TrustDatabase {
  const now = new Date().toISOString();

  return {
    version: '1.0.0',
    lastUpdated: now,
    tranco: {
      tier: DEFAULT_TRANC_TIER,
      domains: [],  // 初回は空、ユーザー更新で埋める
      count: 0,
      sizeBytes: 0,
      lastUpdated: now,
    },
    jpAnchor: {
      tlds: [...JP_ANCHOR_TLDS],
      userTlds: [],
    },
    sensitive: {
      presets: {
        finance: [...SENSITIVE_DOMAINS_PRESETS.finance],
        gaming: [...SENSITIVE_DOMAINS_PRESETS.gaming],
        sns: [...SENSITIVE_DOMAINS_PRESETS.sns],
      },
      userBlacklist: [],
      whitelist: [],
    },
    bloomFilter: {
      data: '',  // 初期化時に作成
      hashCount: 0,
      bitCount: 0,
      expectedDomainCount: 0,
    },
  };
}

/**
 * JP-Anchor 設定初期値
 */
export function createDefaultJpAnchorConfig(): JpAnchorConfig {
  return {
    tlds: [...JP_ANCHOR_TLDS],
    userTlds: [],
  };
}

/**
 * Sensitive ドメイン設定初期値
 */
export function createDefaultSensitiveConfig(): SensitiveDomainsConfig {
  return {
    presets: {
      finance: [...SENSITIVE_DOMAINS_PRESETS.finance],
      gaming: [...SENSITIVE_DOMAINS_PRESETS.gaming],
      sns: [...SENSITIVE_DOMAINS_PRESETS.sns],
    },
    userBlacklist: [],
    whitelist: [],
  };
}

/**
 * 空の Bloom Filter データを作成
 */
export function createEmptyBloomFilterData(): BloomFilterData {
  return {
    data: '',
    hashCount: 0,
    bitCount: 0,
    expectedDomainCount: 0,
  };
}

/**
 * ユーティリティ: すべてのプリセットドメインを取得
 */
export function getAllPresetDomains(): string[] {
  return [
    ...SENSITIVE_DOMAINS_PRESETS.finance,
    ...SENSITIVE_DOMAINS_PRESETS.gaming,
    ...SENSITIVE_DOMAINS_PRESETS.sns,
  ];
}

/**
 * ユーティリティ: プリセット総数
 */
export const PRESET_DOMAIN_COUNT = getAllPresetDomains().length;