/**
 * storage.ts
 * Wrapper for chrome.storage.local to manage settings.
 */
import type { EncryptedData } from './typesCrypto.js';
import type { UblockRules, Source, CustomPrompt } from './types.js';
export declare const StorageKeys: {
    readonly OBSIDIAN_API_KEY: "obsidian_api_key";
    readonly OBSIDIAN_PROTOCOL: "obsidian_protocol";
    readonly OBSIDIAN_PORT: "obsidian_port";
    readonly GEMINI_API_KEY: "gemini_api_key";
    readonly MIN_VISIT_DURATION: "min_visit_duration";
    readonly MIN_SCROLL_DEPTH: "min_scroll_depth";
    readonly GEMINI_MODEL: "gemini_model";
    readonly OBSIDIAN_DAILY_PATH: "obsidian_daily_path";
    readonly AI_PROVIDER: "ai_provider";
    readonly OPENAI_BASE_URL: "openai_base_url";
    readonly OPENAI_API_KEY: "openai_api_key";
    readonly OPENAI_MODEL: "openai_model";
    readonly OPENAI_2_BASE_URL: "openai_2_base_url";
    readonly OPENAI_2_API_KEY: "openai_2_api_key";
    readonly OPENAI_2_MODEL: "openai_2_model";
    readonly DOMAIN_WHITELIST: "domain_whitelist";
    readonly DOMAIN_BLACKLIST: "domain_blacklist";
    readonly DOMAIN_FILTER_MODE: "domain_filter_mode";
    readonly PRIVACY_MODE: "privacy_mode";
    readonly PII_CONFIRMATION_UI: "pii_confirmation_ui";
    readonly PII_SANITIZE_LOGS: "pii_sanitize_logs";
    readonly AUTO_SAVE_PRIVACY_BEHAVIOR: "auto_save_privacy_behavior";
    readonly UBLOCK_RULES: "ublock_rules";
    readonly UBLOCK_SOURCES: "ublock_sources";
    readonly UBLOCK_FORMAT_ENABLED: "ublock_format_enabled";
    readonly SIMPLE_FORMAT_ENABLED: "simple_format_enabled";
    readonly ALLOWED_URLS: "allowed_urls";
    readonly ALLOWED_URLS_HASH: "allowed_urls_hash";
    readonly ENCRYPTION_SALT: "encryption_salt";
    readonly ENCRYPTION_SECRET: "encryption_secret";
    readonly HMAC_SECRET: "hmac_secret";
    readonly MASTER_PASSWORD_ENABLED: "master_password_enabled";
    readonly MASTER_PASSWORD_SALT: "master_password_salt";
    readonly MASTER_PASSWORD_HASH: "master_password_hash";
    readonly IS_LOCKED: "is_locked";
    readonly MP_PROTECTION_ENABLED: "mp_protection_enabled";
    readonly MP_ENCRYPT_API_KEYS: "mp_encrypt_api_keys";
    readonly MP_ENCRYPT_ON_EXPORT: "mp_encrypt_on_export";
    readonly MP_REQUIRE_ON_IMPORT: "mp_require_on_import";
    readonly SAVED_URLS_VERSION: "savedUrls_version";
    readonly CUSTOM_PROMPTS: "custom_prompts";
    readonly DOMAIN_FILTER_CACHE: "domain_filter_cache";
    readonly DOMAIN_FILTER_CACHE_TIMESTAMP: "domain_filter_cache_timestamp";
};
export type StorageKey = typeof StorageKeys[keyof typeof StorageKeys];
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
    [StorageKeys.DOMAIN_WHITELIST]: string[];
    [StorageKeys.DOMAIN_BLACKLIST]: string[];
    [StorageKeys.DOMAIN_FILTER_MODE]: string;
    [StorageKeys.PRIVACY_MODE]: string;
    [StorageKeys.PII_CONFIRMATION_UI]: boolean;
    [StorageKeys.PII_SANITIZE_LOGS]: boolean;
    [StorageKeys.AUTO_SAVE_PRIVACY_BEHAVIOR]: 'save' | 'skip' | 'confirm';
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
    [StorageKeys.SAVED_URLS_VERSION]: number;
    [StorageKeys.CUSTOM_PROMPTS]: CustomPrompt[];
    [StorageKeys.DOMAIN_FILTER_CACHE]: string[];
    [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: number;
}
export type StrictSettings = {
    [K in StorageKey]: StorageKeyValues[K];
};
export type Settings = Partial<StorageKeyValues> & {
    [key: string]: unknown;
};
export declare const ALLOWED_AI_PROVIDER_DOMAINS: string[];
/**
 * ドメインがホワイトリストに含まれるかチェックする
 * @param {string} url - チェック対象のURL
 * @returns {boolean} 許可される場合true
 */
export declare function isDomainInWhitelist(url: string): boolean;
/**
 * 暗号化キーを取得または作成する
 *
 * 【セキュリティ修正】マスターパスワードが設定されている場合、マスターパスワードからキーを導出
 * マスターパスワード未設定の場合は従来の方式でマイグレーション準備
 *
 * @returns {Promise<CryptoKey>} 導出された暗号化キー
 * @throws {Error} ロックされている場合（マスターパスワード未入力）
 */
export declare function getOrCreateEncryptionKey(): Promise<CryptoKey>;
/**
 * マスターパスワードが設定されているか確認
 * @returns {Promise<boolean>} マスターパスワードが設定済みの場合true
 */
export declare function isMasterPasswordEnabled(): Promise<boolean>;
/**
 * 暗号化がロックされているか確認（マスターパスワード未入力）
 * @returns {Promise<boolean>} ロックされている場合true
 */
export declare function isEncryptionLocked(): Promise<boolean>;
/**
 * マスターパスワードを設定する
 * @param {string} password - マスターパスワード
 * @returns {Promise<boolean>} 成功した場合true
 */
export declare function setMasterPassword(password: string): Promise<boolean>;
/**
 * マスターパスワードを検証し、セッションをアンロックする
 * @param {string} password - マスターパスワード
 * @returns {Promise<boolean>} 成功した場合true
 */
export declare function unlockWithPassword(password: string): Promise<boolean>;
/**
 * セッションをロックする（マスターパスワードキャッシュをクリア）
 */
export declare function lockSession(): void;
/** * マスターパスワードを再設定する（古いパスワード検証後）
 * @param {string} oldPassword - 現在のマスターパスワード
 * @param {string} newPassword - 新しいマスターパスワード
 * @returns {Promise<boolean>} 成功した場合true
 */
export declare function changeMasterPassword(oldPassword: string, newPassword: string): Promise<boolean>;
/**
 * マスターパスワード設定を解除する（すべての暗号化データを再暗号化できないため注意が必要）
 */
export declare function removeMasterPassword(): Promise<void>;
/**
 * 暗号化キーのキャッシュをクリアする（テスト用）
 */
export declare function clearEncryptionKeyCache(): void;
/**
 * HMAC Secretを取得または作成する
 * @returns {Promise<string>} HMACシークレット
 */
export declare function getOrCreateHmacSecret(): Promise<string>;
/**
 * 古い個別キー方式から単一settingsオブジェクト方式へのマイグレーション
 *
 * @returns {Promise<boolean>} マイグレーションが実行された場合はtrue
 */
export declare function migrateToSingleSettingsObject(): Promise<boolean>;
export declare function getSettings(): Promise<Settings>;
/**
 * 【パフォーマンス改善】設定キャッシュをクリアする（テスト用）
 * ストレージから完全に再読み込みする場合に使用
 */
export declare function clearSettingsCache(): void;
/**
 * Save settings to chrome.storage.local with optional allowed URL list update.
 *
 * @param {Settings} settings - Settings to save
 * @param {boolean} updateAllowedUrlsFlag - Whether to update the allowed URL list (default: false)
 */
export declare function saveSettings(settings: Settings, updateAllowedUrlsFlag?: boolean): Promise<void>;
export declare const MAX_URL_SET_SIZE = 10000;
export declare const URL_WARNING_THRESHOLD = 8000;
export declare const URL_RETENTION_DAYS = 7;
export interface SavedUrlEntry {
    url: string;
    timestamp: number;
    recordType?: string;
    maskedCount?: number;
}
/**
 * Get the list of saved URLs with LRU eviction
 * @returns {Promise<Set<string>>} Set of saved URLs
 */
export declare function getSavedUrls(): Promise<Set<string>>;
/**
 * Get the detailed URL entries with timestamps
 * @returns {Promise<Map<string, number>>} Map of URLs to timestamps
 */
export declare function getSavedUrlsWithTimestamps(): Promise<Map<string, number>>;
/**
 * Save the list of URLs with LRU eviction
 * @param {Set<string>} urlSet - Set of URLs to save
 * @param {string} [urlToAdd] - URL to add/update with current timestamp（オプション）
 */
export declare function setSavedUrls(urlSet: Set<string>, urlToAdd?: string | null): Promise<void>;
/**
 * Save the URL Map with timestamps (日付ベース重複チェック用)
 * @param {Map<string, number>} urlMap - Map of URLs to timestamps
 * @param {string} [urlToAdd] - URL to add/update with current timestamp（オプション）
 */
export declare function setSavedUrlsWithTimestamps(urlMap: Map<string, number>, urlToAdd?: string | null): Promise<void>;
/**
 * Add a URL to the saved list with LRU tracking (日付ベース対応)
 * @param {string} url - URL to add
 */
export declare function addSavedUrl(url: string): Promise<void>;
/**
 * Remove a URL from the saved list
 * @param {string} url - URL to remove
 */
export declare function removeSavedUrl(url: string): Promise<void>;
/**
 * Check if URL is in the saved list
 * @param {string} url - URL to check
 * @returns {Promise<boolean>} True if URL is saved
 */
export declare function isUrlSaved(url: string): Promise<boolean>;
/**
 * Get the count of saved URLs
 * @returns {Promise<number>} Number of saved URLs
 */
export declare function getSavedUrlCount(): Promise<number>;
/**
 * 設定から許可されたURLのリストを構築
 * @param {object} settings - 設定オブジェクト
 * @returns {Set<string>} 許可されたURLのセット
 */
export declare function buildAllowedUrls(settings: Settings): Set<string>;
/**
 * URLリストのハッシュを計算
 * @param {Set<string>} urls - URLのセット
 * @returns {string} ハッシュ値
 */
export declare function computeUrlsHash(urls: Set<string>): string;
/**
 * 設定を保存し、許可されたURLのリストを再構築
 * @param {Settings} settings - 設定オブジェクト
 */
export declare function saveSettingsWithAllowedUrls(settings: Settings): Promise<void>;
/**
 * 許可されたURLのリストを取得
 * @returns {Promise<Set<string>>} 許可されたURLのセット
 */
export declare function getAllowedUrls(): Promise<Set<string>>;
/**
 * 楽観的ロック用のバージョンフィールドを初期化（移行用）
 *
 * 新規インストールまたは既存データにバージョンフィールドがない場合に初期化します。
 * この関数はアプリ起動時に呼び出されることを想定しています。
 *
 * @returns {Promise<void>}
 */
export declare function ensureUrlVersionInitialized(): Promise<void>;
/**
 * [同期] ドメインフィルタキャッシュを取得
 * Content Scriptから直接呼び出すため、ストレージに同期的アクセスはできませんが
 * chrome.storage.local.get はコールバックで即時取得可能
 * この関数は Content Script で使用します
 *
 * @param {function} callback - キャッシュデータを受け取るコールバック関数
 */
export declare function getDomainFilterCacheSync(callback: (data: {
    allowedDomains: string[];
    blockedDomains: string[];
    cachedAt: number;
    mode: string;
}) => void): void;
/**
 * ドメインフィルタキャッシュが有効かどうかを判定
 * @param {number} cachedAt - キャッシュ作成時のタイムスタンプ
 * @returns {boolean} 有効な場合true
 */
export declare function isDomainFilterCacheValid(cachedAt: number): boolean;
/**
 * ドメインからパスとクエリを削除して正規化
 * @param {string} url - 正規化対象のURL
 * @returns {string | null} 正規化されたURL（失敗時はnull）
 */
export declare function normalizeDomainUrl(url: string): string | null;
/**
 * パターンマッチング（ワイルドカード対応）
 * Content Scriptで使用するため、パッケージ化
 * @param {string} domain - チェック対象のドメイン
 * @param {string} pattern - パターン（*を含む場合あり）
 * @returns {boolean} 一致する場合true
 */
export declare function matchesWildcardPattern(domain: string, pattern: string): boolean;
/**
 * バックグラウンドスクリプトでドメインフィルタキャッシュを更新
 * @param {Settings} settings - 設定オブジェクト
 */
export declare function updateDomainFilterCache(settings: Settings): Promise<void>;
//# sourceMappingURL=storage.d.ts.map