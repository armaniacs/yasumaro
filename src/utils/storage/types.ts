/**
 * storage/types.ts
 * ストレージキー定数・型定義
 * storage.tsから型・定数を分離したモジュール
 */

import type { EncryptedData } from '../typesCrypto.js';
import type { UblockRules, Source, CustomPrompt, TagCategory } from '../types.js';
import type { SafetyMode, TrancoTier } from '../trustDb/trustDbSchema.js';

export const StorageKeys = {
    OBSIDIAN_API_KEY: 'obsidian_api_key',
    OBSIDIAN_PROTOCOL: 'obsidian_protocol', // 'http' or 'https'
    OBSIDIAN_PORT: 'obsidian_port',
    GEMINI_API_KEY: 'gemini_api_key',
    MIN_VISIT_DURATION: 'min_visit_duration',
    MIN_SCROLL_DEPTH: 'min_scroll_depth',
    GEMINI_MODEL: 'gemini_model',
    OBSIDIAN_DAILY_PATH: 'obsidian_daily_path',
    AI_PROVIDER: 'ai_provider',
    OPENAI_BASE_URL: 'openai_base_url',
    OPENAI_API_KEY: 'openai_api_key',
    OPENAI_MODEL: 'openai_model',
    OPENAI_2_BASE_URL: 'openai_2_base_url',
    OPENAI_2_API_KEY: 'openai_2_api_key',
    OPENAI_2_MODEL: 'openai_2_model',
    // LM Studio settings
    LM_STUDIO_BASE_URL: 'lm_studio_base_url',
    LM_STUDIO_MODEL: 'lm_studio_model',
    // Ollama settings
    OLLAMA_BASE_URL: 'ollama_base_url',
    OLLAMA_MODEL: 'ollama_model',
    // OpenAI-compatible provider settings (dynamic)
    PROVIDER_TYPE: 'provider_type',       // 'openrouter' | 'perplexity' | 'groq' | ...
    PROVIDER_BASE_URL: 'provider_base_url', // Dynamic API URL
    PROVIDER_API_KEY: 'provider_api_key',   // Dynamic API key
    PROVIDER_MODEL: 'provider_model',       // Dynamic model ID
    // Domain filter settings
    DOMAIN_WHITELIST: 'domain_whitelist',
    DOMAIN_BLACKLIST: 'domain_blacklist',
    DOMAIN_FILTER_MODE: 'domain_filter_mode',
    // Privacy settings（Phase 3）
    PRIVACY_MODE: 'privacy_mode',           // 'local_only' | 'full_pipeline' | 'masked_cloud' | 'cloud_only'
    PII_CONFIRMATION_UI: 'pii_confirmation_ui', // true | false
    PII_SANITIZE_LOGS: 'pii_sanitize_logs',  // true | false
    AUTO_SAVE_PRIVACY_BEHAVIOR: 'auto_save_privacy_behavior', // 'save' | 'skip' | 'confirm'
    // Content cleansing settings (Phase 0)
    CONTENT_STRIP_HARD_ENABLED: 'content_strip_hard_enabled', // Hard Strip 有効化フラグ
    CONTENT_STRIP_KEYWORDS: 'content_strip_keywords', // Keyword Strip キーワードリスト
    CONTENT_STRIP_KEYWORD_ENABLED: 'content_strip_keyword_enabled', // Keyword Strip 有効化フラグ
    // uBlock Origin format settings
    UBLOCK_RULES: 'ublock_rules',           // uBlock形式ルールセット（マージ済み）
    UBLOCK_SOURCES: 'ublock_sources',       // uBlockソースリスト（複数対応）
    UBLOCK_FORMAT_ENABLED: 'ublock_format_enabled', // uBlock形式有効化フラグ
    SIMPLE_FORMAT_ENABLED: 'simple_format_enabled', // シンプル形式有効化フラグ
    // Dynamic URL validation settings (CSP tightening)
    ALLOWED_URLS: 'allowed_urls',           // 許可されたURLのリスト（配列）
    ALLOWED_URLS_HASH: 'allowed_urls_hash', // URLリストのハッシュ（変更検出用）
    // Encryption settings
    ENCRYPTION_SALT: 'encryption_salt',     // PBKDF2用ソルト（Base64）
    ENCRYPTION_SECRET: 'encryption_secret', // 自動生成されたランダムシークレット（Base64）[廃止予定]
    HMAC_SECRET: 'hmac_secret',             // 設定エクスポート用HMACシークレット（Base64）
    // 【セキュリティ修正】マスターパスワード関連
    MASTER_PASSWORD_ENABLED: 'master_password_enabled', // マスターパスワード設定済みフラグ
    MASTER_PASSWORD_SALT: 'master_password_salt',       // マスターパスワード用ソルト（Base64）
    MASTER_PASSWORD_HASH: 'master_password_hash',       // マスターパスワードのハッシュ（Base64）
    IS_LOCKED: 'is_locked',                  // 暗号化がロックされているかどうか
    // 【マスターパスワード保護オプション】
    MP_PROTECTION_ENABLED: 'mp_protection_enabled',    // マスターパスワード保護有効フラグ
    MP_ENCRYPT_API_KEYS: 'mp_encrypt_api_keys',         // APIキー暗号化フラグ
    // タグ機能設定
    TAG_CATEGORIES: 'tag_categories',                  // ユーザー追加カテゴリ + デフォルト管理
    TAG_SUMMARY_MODE: 'tag_summary_mode',              // タグ付き要約を使用するか
    // L0 Extractive Compression Settings
    L0_EXTRACTIVE_ENABLED: 'l0_extractive_enabled',   // L0抽出を有効化するか（デフォルト: true）
    L0_EXTRACTIVE_TOP_K: 'l0_extractive_top_k',       // 抽出する文数（デフォルト: 10）
    L0_EXTRACTIVE_MIN_LENGTH: 'l0_extractive_min_length', // 最小文長（デフォルト: 20）
    L0_EXTRACTIVE_SIMILARITY_THRESHOLD: 'l0_extractive_similarity_threshold', // 類似度閾値（デフォルト: 0.3）
    L0_EXTRACTIVE_PERFORMANCE_THRESHOLD: 'l0_extractive_performance_threshold', // パフォーマンス閾値ms（デフォルト: 1000）
    MP_ENCRYPT_ON_EXPORT: 'mp_encrypt_on_export',       // エクスポート時暗号化フラグ
    MP_REQUIRE_ON_IMPORT: 'mp_require_on_import',       // インポート時パスワード要求フラグ
    // Custom prompts
    CUSTOM_PROMPTS: 'custom_prompts', // カスタムプロンプト設定
    // Domain filter cache for content scripts (Task #19)
    DOMAIN_FILTER_CACHE: 'domain_filter_cache', // 許可ドメインキャッシュ（content script用）
    DOMAIN_FILTER_CACHE_TIMESTAMP: 'domain_filter_cache_timestamp', // キャッシュタイムスタンプ
    // Privacy consent (GDPR/CCPA compliance)
    PRIVACY_CONSENT: 'privacy_consent', // プライバシーポリシーへの同意状態
    // Privacy（v4.2.1） - 自動コンテンツフェッチ設定（明示的 consent を要求）
    AUTO_CONTENT_FETCH_ENABLED: 'auto_content_fetch_enabled', // バックグラウンドタブからのコンテンツフェッチを有効化するか（デフォルト: false）
    // Trust & Alert Settings (Phase 2)
    ALERT_FINANCE: 'alert_finance', // 金融サイト警告（デフォルト: true）
    ALERT_SENSITIVE: 'alert_sensitive', // 警戒リスト警告（デフォルト: true）
    ALERT_UNVERIFIED: 'alert_unverified', // 未検証サイト警告（デフォルト: false）
    SAVE_ABORTED_PAGES: 'save_aborted_pages', // 警告で中断したページを履歴に残す（デフォルト: false）
    // Trust Database Settings (Phase 1)
    SAFETY_MODE: 'safety_mode', // Safety Mode (strict/balanced/relaxed, デフォルト: balanced)
    TRANCO_TIER: 'tranco_tier', // Tranco Tier (top1k/top10k/top100k, デフォルト: top10k)
    // Permission Manager Settings (P0)
    DENIED_DOMAINS: 'denied_domains', // 拒否ドメイン情報: { [domain: string]: { count: number; lastDenied: string; lastDismissed?: string } }
    PERMISSION_NOTIFY_THRESHOLD: 'permission_notify_threshold', // 通知する訪問回数の閾値（デフォルト: 3、範囲: 1〜50）
    // Conditional CSP Settings (P1)
    CONDITIONAL_CSP_ENABLED: 'conditional_csp_enabled', // 条件付きCSP有効フラグ（デフォルト: true）
    CONDITIONAL_CSP_PROVIDERS: 'conditional_csp_providers', // 追加するAIプロバイダーIDリスト（デフォルト: []）
    // AI Limits Settings
    MAX_TOKENS_PER_PROMPT: 'max_tokens_per_prompt', // 最大トークン数（デフォルト: 1000、範囲: 10〜16000）
    AI_TIMEOUT_MS: 'ai_timeout_ms', // AIリクエストタイムアウト（デフォルト: 自動、ローカル=120000ms、クラウド=30000ms）
    // Rate Limit Settings (Configurable)
    SKIP_AI_RATE_LIMIT_MAX: 'skip_ai_rate_limit_max', // skipAI操作の最大回数（デフォルト: 5）
    SKIP_AI_RATE_LIMIT_WINDOW_MS: 'skip_ai_rate_limit_window_ms', // skipAIレートリミットウィンドウ（デフォルト: 60000ms）
    // AI Summary Cleansing Settings
    AI_SUMMARY_CLEANSING_ENABLED: 'ai_summary_cleansing_enabled', // AI要約用クレンジング有効フラグ（デフォルト: true）
    AI_SUMMARY_CLEANSING_ALT: 'ai_summary_cleansing_alt', // 画像alt属性削除（デフォルト: true）
    AI_SUMMARY_CLEANSING_METADATA: 'ai_summary_cleansing_metadata', // メタデータ削除（デフォルト: true）
    AI_SUMMARY_CLEANSING_ADS: 'ai_summary_cleansing_ads', // 広告関連要素削除（デフォルト: true）
    AI_SUMMARY_CLEANSING_NAV: 'ai_summary_cleansing_nav', // ナビゲーション・フッター削除（デフォルト: true）
    AI_SUMMARY_CLEANSING_SOCIAL: 'ai_summary_cleansing_social', // コメント・ソーシャルウィジェット削除（デフォルト: true）
    AI_SUMMARY_CLEANSING_DEEP: 'ai_summary_cleansing_deep', // 積極的クレンジング（デフォルト: false）
    AI_SUMMARY_CLEANSING_LINK_DENSITY: 'ai_summary_cleansing_link_density', // リンク密度フィルタ（デフォルト: false）
    AI_SUMMARY_CLEANSING_JSON_LD: 'ai_summary_cleansing_json_ld', // JSON-LD構造化データ削除（デフォルト: false）
    AI_SUMMARY_CLEANSING_LAZY_LOAD: 'ai_summary_cleansing_lazy_load', // 遅延読み込み要素削除（デフォルト: false）
    AI_SUMMARY_CLEANSING_SKIP_LINK: 'ai_summary_cleansing_skip_link', // スキップリンク削除（デフォルト: false）
    AI_SUMMARY_CLEANSING_CARD: 'ai_summary_cleansing_card', // カード型要素削除（デフォルト: false）
    // NEW: Advanced cleansing options
    AI_SUMMARY_CLEANSING_FIXED: 'ai_summary_cleansing_fixed', // 固定要素削除（デフォルト: false）
    AI_SUMMARY_CLEANSING_RECOMMEND: 'ai_summary_cleansing_recommend', // 推荐セクション削除（デフォルト: true）
    AI_SUMMARY_CLEANSING_PAGINATION: 'ai_summary_cleansing_pagination', // ページネーション削除（デフォルト: false）
    AI_SUMMARY_CLEANSING_SNS_PROMO: 'ai_summary_cleansing_sns_promo', // SNSプロモ削除（デフォルト: false）
    AI_SUMMARY_CLEANSING_POPUP: 'ai_summary_cleansing_popup', // ポップアップ削除（デフォルト: true）
    AI_SUMMARY_CLEANSING_PLATFORM: 'ai_summary_cleansing_platform', // プラットフォーム噪声削除（デフォルト: false）
    // NEW: 9 additional cleansing options
    AI_SUMMARY_CLEANSING_TEXT_DENSITY: 'ai_summary_cleansing_text_density', // テキスト密度フィルタリング（デフォルト: false）
    AI_SUMMARY_CLEANSING_SHORT_SEQ: 'ai_summary_cleansing_short_seq', // 短文要素の連続削除（デフォルト: false）
    AI_SUMMARY_CLEANSING_SYMBOL_LINE: 'ai_summary_cleansing_symbol_line', // 特殊記号行の削除（デフォルト: false）
    AI_SUMMARY_CLEANSING_LINK_PARA: 'ai_summary_cleansing_link_para', // リンクのみ段落の削除（デフォルト: false）
    AI_SUMMARY_CLEANSING_ENHANCED_HIDDEN: 'ai_summary_cleansing_enhanced_hidden', // 非表示要素強化削除（デフォルト: false）
    AI_SUMMARY_CLEANSING_EMPTY_ELEM: 'ai_summary_cleansing_empty_elem', // 空要素の削除（デフォルト: false）
    AI_SUMMARY_CLEANSING_JP_LAYOUT: 'ai_summary_cleansing_jp_layout', // JP BEM系レイアウトパターン（デフォルト: false）
    AI_SUMMARY_CLEANSING_JP_NAVIGATION: 'ai_summary_cleansing_jp_navigation', // JP ナビ・剰利用語（デフォルト: false）
    AI_SUMMARY_CLEANSING_AUTHOR: 'ai_summary_cleansing_author', // 執筆者・メタ情報（デフォルト: false）
    // Threshold settings for numeric cleansing
    AI_SUMMARY_CLEANSING_LINK_RATIO_THRESHOLD: 'ai_summary_cleansing_link_ratio_threshold', // リンク密度閾値（デフォルト: 70）
    AI_SUMMARY_CLEANSING_SHORT_TEXT_THRESHOLD: 'ai_summary_cleansing_short_text_threshold', // 短文閾値文字数（デフォルト: 30）
    AI_SUMMARY_CLEANSING_SHORT_SEQ_COUNT: 'ai_summary_cleansing_short_seq_count', // 短文連続数閾値（デフォルト: 5）
    AI_SUMMARY_CLEANSING_LINK_PARA_THRESHOLD: 'ai_summary_cleansing_link_para_threshold', // リンクのみ段落閾値（デフォルト: 50）
    // Custom pattern settings
    AI_SUMMARY_CLEANSING_CUSTOM_PATTERNS: 'ai_summary_cleansing_custom_patterns', // カスタムパターン列表
    // Tranco List Update Notification (Phase 1)
    TRANCO_VERSION: 'tranco_version', // 現在の Tranco リストバージョン（ISO 8601形式）
    TRANCO_DOMAINS: 'tranco_domains', // 保存された Tranco ドメインリスト（旧リスト保持用）
    TRANCO_NOTIFICATION_SHOWN: 'tranco_notification_shown', // 通知が表示されたバージョン（7日抑制制御用）
    TRANCO_CONSENT_GRANTED: 'tranco_consent_granted', // 同意が与えられたバージョン
    TRANCO_CONSENT_DENIED_REASON: 'tranco_consent_denied_reason', // 同意拒否の理由
    TRANCO_CONSENT_DENIED_TIMESTAMP: 'tranco_consent_denied_timestamp', // 同意拒否タイムスタンプ（30日再確認用）
    // AI Usage Tracking (FinOps)
    AI_USAGE_MONTH: 'ai_usage_month', // 現在の月（YYYY-MM形式）
    AI_USAGE_TOKENS_SENT: 'ai_usage_tokens_sent', // 当月送信トークン数
    AI_USAGE_TOKENS_RECEIVED: 'ai_usage_tokens_received', // 当月受信トークン数
    AI_USAGE_REQUEST_COUNT: 'ai_usage_request_count', // 当月リクエスト数
    AI_RATE_LIMIT_WINDOW_START: 'ai_rate_limit_window_start', // レート制限ウィンドウ開始時刻
    AI_RATE_LIMIT_COUNT: 'ai_rate_limit_count', // 現在のウィンドウ内リクエスト数
    // Text Quality
    CONTENT_DEDUP_ENABLED: 'content_dedup_enabled',     // センテンス冗長除去（デフォルト: true）
    CONTENT_DEDUP_THRESHOLD: 'content_dedup_threshold', // Jaccard類似度閾値（デフォルト: 0.7）
    SUMMARY_NORMALIZE_ENABLED: 'summary_normalize_enabled' // 日本語文末正規化（デフォルト: true）
} as const;

export type StorageKey = typeof StorageKeys[keyof typeof StorageKeys];

// 各 StorageKey に対応する値型
export interface StorageKeyValues {
    [StorageKeys.OBSIDIAN_API_KEY]: string | EncryptedData;
    [StorageKeys.OBSIDIAN_PROTOCOL]: 'http' | 'https';
    [StorageKeys.OBSIDIAN_PORT]: string;
    [StorageKeys.GEMINI_API_KEY]: string | EncryptedData;
    [StorageKeys.MIN_VISIT_DURATION]: number;
    [StorageKeys.MIN_SCROLL_DEPTH]: number;
    [StorageKeys.GEMINI_MODEL]: string;
    [StorageKeys.OBSIDIAN_DAILY_PATH]: string;
    [StorageKeys.AI_PROVIDER]: string;
    [StorageKeys.OPENAI_BASE_URL]: string;
    [StorageKeys.OPENAI_API_KEY]: string | EncryptedData;
    [StorageKeys.OPENAI_MODEL]: string;
    [StorageKeys.OPENAI_2_BASE_URL]: string;
    [StorageKeys.OPENAI_2_API_KEY]: string | EncryptedData;
    [StorageKeys.OPENAI_2_MODEL]: string;
    [StorageKeys.LM_STUDIO_BASE_URL]: string;
    [StorageKeys.LM_STUDIO_MODEL]: string;
    [StorageKeys.OLLAMA_BASE_URL]: string;
    [StorageKeys.OLLAMA_MODEL]: string;
    [StorageKeys.PROVIDER_TYPE]: string;
    [StorageKeys.PROVIDER_BASE_URL]: string;
    [StorageKeys.PROVIDER_API_KEY]: string | EncryptedData;
    [StorageKeys.PROVIDER_MODEL]: string;
    [StorageKeys.DOMAIN_WHITELIST]: string[];
    [StorageKeys.DOMAIN_BLACKLIST]: string[];
    [StorageKeys.DOMAIN_FILTER_MODE]: string;
    [StorageKeys.PRIVACY_MODE]: string;
    [StorageKeys.PII_CONFIRMATION_UI]: boolean;
    [StorageKeys.PII_SANITIZE_LOGS]: boolean;
    [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'save' | 'skip' | 'confirm';
    [StorageKeys.CONTENT_STRIP_HARD_ENABLED]: boolean;
    [StorageKeys.CONTENT_STRIP_KEYWORDS]: string[];
    [StorageKeys.CONTENT_STRIP_KEYWORD_ENABLED]: boolean;
    [StorageKeys.UBLOCK_RULES]: UblockRules;
    [StorageKeys.UBLOCK_SOURCES]: Source[];
    [StorageKeys.UBLOCK_FORMAT_ENABLED]: boolean;
    [StorageKeys.SIMPLE_FORMAT_ENABLED]: boolean;
    [StorageKeys.ALLOWED_URLS]: string[];
    [StorageKeys.ALLOWED_URLS_HASH]: string;
    [StorageKeys.ENCRYPTION_SALT]: string;
    [StorageKeys.ENCRYPTION_SECRET]: string;
    [StorageKeys.HMAC_SECRET]: string;
    [StorageKeys.MASTER_PASSWORD_ENABLED]: boolean;
    [StorageKeys.MASTER_PASSWORD_SALT]: string;
    [StorageKeys.MASTER_PASSWORD_HASH]: string;
    [StorageKeys.IS_LOCKED]: boolean;
    [StorageKeys.MP_PROTECTION_ENABLED]: boolean;
    [StorageKeys.MP_ENCRYPT_API_KEYS]: boolean;
    [StorageKeys.MP_ENCRYPT_ON_EXPORT]: boolean;
    [StorageKeys.MP_REQUIRE_ON_IMPORT]: boolean;
    [StorageKeys.CUSTOM_PROMPTS]: CustomPrompt[];
    [StorageKeys.DOMAIN_FILTER_CACHE]: string[];
    [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: number;
    [StorageKeys.TAG_CATEGORIES]: TagCategory[];
    [StorageKeys.TAG_SUMMARY_MODE]: boolean;
    [StorageKeys.L0_EXTRACTIVE_ENABLED]: boolean;
    [StorageKeys.L0_EXTRACTIVE_TOP_K]: number;
    [StorageKeys.L0_EXTRACTIVE_MIN_LENGTH]: number;
    [StorageKeys.L0_EXTRACTIVE_SIMILARITY_THRESHOLD]: number;
    [StorageKeys.L0_EXTRACTIVE_PERFORMANCE_THRESHOLD]: number;
    [StorageKeys.PRIVACY_CONSENT]: { hasConsented: boolean; consentDate?: string; consentVersion?: string } | boolean;
    [StorageKeys.AUTO_CONTENT_FETCH_ENABLED]: boolean;
    [StorageKeys.ALERT_FINANCE]: boolean;
    [StorageKeys.ALERT_SENSITIVE]: boolean;
    [StorageKeys.ALERT_UNVERIFIED]: boolean;
    [StorageKeys.SAVE_ABORTED_PAGES]: boolean;
    [StorageKeys.SAFETY_MODE]: SafetyMode;
    [StorageKeys.TRANCO_TIER]: TrancoTier;
    [StorageKeys.DENIED_DOMAINS]: Record<string, { count: number; lastDenied: string; lastDismissed?: string }>;
    [StorageKeys.PERMISSION_NOTIFY_THRESHOLD]: number;
    [StorageKeys.CONDITIONAL_CSP_ENABLED]: boolean;
    [StorageKeys.CONDITIONAL_CSP_PROVIDERS]: string[];
    [StorageKeys.MAX_TOKENS_PER_PROMPT]: number;
    [StorageKeys.AI_TIMEOUT_MS]: number;
    [StorageKeys.SKIP_AI_RATE_LIMIT_MAX]: number;
    [StorageKeys.SKIP_AI_RATE_LIMIT_WINDOW_MS]: number;
    [StorageKeys.AI_SUMMARY_CLEANSING_ENABLED]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_ALT]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_METADATA]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_ADS]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_NAV]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_SOCIAL]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_DEEP]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_LINK_DENSITY]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_JSON_LD]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_LAZY_LOAD]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_SKIP_LINK]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_CARD]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_FIXED]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_RECOMMEND]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_PAGINATION]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_SNS_PROMO]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_POPUP]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_PLATFORM]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_TEXT_DENSITY]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_SHORT_SEQ]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_SYMBOL_LINE]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_LINK_PARA]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_ENHANCED_HIDDEN]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_EMPTY_ELEM]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_JP_LAYOUT]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_JP_NAVIGATION]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_AUTHOR]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_LINK_RATIO_THRESHOLD]: number;
    [StorageKeys.AI_SUMMARY_CLEANSING_SHORT_TEXT_THRESHOLD]: number;
    [StorageKeys.AI_SUMMARY_CLEANSING_SHORT_SEQ_COUNT]: number;
    [StorageKeys.AI_SUMMARY_CLEANSING_LINK_PARA_THRESHOLD]: number;
    [StorageKeys.AI_SUMMARY_CLEANSING_CUSTOM_PATTERNS]: string[];
    [StorageKeys.TRANCO_VERSION]: string;
    [StorageKeys.TRANCO_DOMAINS]: string[];
    [StorageKeys.TRANCO_NOTIFICATION_SHOWN]: string | null;
    [StorageKeys.TRANCO_CONSENT_GRANTED]: string | null;
    [StorageKeys.TRANCO_CONSENT_DENIED_REASON]: string | null;
    [StorageKeys.TRANCO_CONSENT_DENIED_TIMESTAMP]: number | null;
    [StorageKeys.AI_USAGE_MONTH]: string;
    [StorageKeys.AI_USAGE_TOKENS_SENT]: number;
    [StorageKeys.AI_USAGE_TOKENS_RECEIVED]: number;
    [StorageKeys.AI_USAGE_REQUEST_COUNT]: number;
    [StorageKeys.AI_RATE_LIMIT_WINDOW_START]: number;
    [StorageKeys.AI_RATE_LIMIT_COUNT]: number;
    [StorageKeys.CONTENT_DEDUP_ENABLED]: boolean;
    [StorageKeys.CONTENT_DEDUP_THRESHOLD]: number;
    [StorageKeys.SUMMARY_NORMALIZE_ENABLED]: boolean;
}

// 厳格な Settings 型
export type StrictSettings = {
    [K in StorageKey]: StorageKeyValues[K];
};

// 以前の Settings 型（後方互換性のため）
// StrictSettings に徐々に移行を進める
// StorageKeys で型チェック可能にするために index signature を追加
export type Settings = Partial<StorageKeyValues> & {
    [key: string]: unknown; // レガシー互換性
};