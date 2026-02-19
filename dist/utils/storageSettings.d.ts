/**
 * storageSettings.ts
 * 設定管理関連の機能
 * 設定の取得、保存、マイグレーション
 */
import type { UblockRules, Source, CustomPrompt } from './types.js';
export declare const API_KEY_FIELDS: readonly ["obsidian_api_key", "gemini_api_key", "openai_api_key", "openai_2_api_key"];
export declare const SETTINGS_MIGRATED_KEY = "settings_migrated";
/**
 * Settings 型のインターフェース
 * StorageKeyValues のインポートを回避するため、内部で定義
 */
export interface SettingsValue {
    obsidian_api_key?: string | {
        ciphertext: string;
        iv: string;
    };
    obsidian_protocol?: 'http' | 'https';
    obsidian_port?: string;
    gemini_api_key?: string | {
        ciphertext: string;
        iv: string;
    };
    min_visit_duration?: number;
    min_scroll_depth?: number;
    gemini_model?: string;
    obsidian_daily_path?: string;
    ai_provider?: string;
    openai_base_url?: string;
    openai_api_key?: string | {
        ciphertext: string;
        iv: string;
    };
    openai_model?: string;
    openai_2_base_url?: string;
    openai_2_api_key?: string | {
        ciphertext: string;
        iv: string;
    };
    openai_2_model?: string;
    domain_whitelist?: string[];
    domain_blacklist?: string[];
    domain_filter_mode?: string;
    privacy_mode?: string;
    pii_confirmation_ui?: boolean;
    pii_sanitize_logs?: boolean;
    ublock_rules?: UblockRules;
    ublock_sources?: Source[];
    ublock_format_enabled?: boolean;
    simple_format_enabled?: boolean;
    allowed_urls?: string[];
    allowed_urls_hash?: string;
    custom_prompts?: CustomPrompt[];
    [key: string]: unknown;
}
export type Settings = SettingsValue & {
    [key: string]: unknown;
};
/**
 * デフォルト設定
 */
export declare const DEFAULT_SETTINGS: Settings;
/**
 * 古い個別キー方式から単一settingsオブジェクト方式へのマイグレーション
 *
 * @param {ReadonlyArray<string>} validStorageKeys - 有効なストレージキーの配列
 * @returns {Promise<boolean>} マイグレーションが実行された場合はtrue
 */
export declare function migrateToSingleSettingsObject(validStorageKeys: ReadonlyArray<string>): Promise<boolean>;
/**
 * 設定を取得する
 *
 * @param {() => Promise<CryptoKey>} getEncryptionKey - 暗号化キー取得関数
 * @param {() => Promise<boolean>} runMigration - マイグレーション実行関数
 * @param {ReadonlyArray<string>} validStorageKeys - 有効なストレージキーの配列
 * @param {string} ObsidianApiKey - Obsidian APIキーのストレージキー
 * @returns {Promise<Settings>} 設定オブジェクト
 */
export declare function getSettings(getEncryptionKey: () => Promise<CryptoKey>, runMigration: () => Promise<boolean>, validStorageKeys: ReadonlyArray<string>, ObsidianApiKey: string): Promise<Settings>;
/**
 * 設定を保存する
 *
 * @param {Settings} settings - 設定オブジェクト
 * @param {() => Promise<CryptoKey>} getEncryptionKey - 暗号化キー取得関数
 * @param {boolean} [updateAllowedUrlsFlag=false] - 許可URLリストを更新するかどうか
 * @param {(settings: Settings) => Set<string>} buildAllowedUrlsFunc - 許可URLリスト構築関数
 * @param {(urls: Set<string>) => string} computeUrlsHashFunc - URLハッシュ計算関数
 * @param {string} ALLOWED_URLS_KEY - 許可URLのストレージキー
 * @param {string} ALLOWED_URLS_HASH_KEY - 許可URLハッシュのストレージキー
 */
export declare function saveSettings(settings: Settings, getEncryptionKey: () => Promise<CryptoKey>, updateAllowedUrlsFlag?: boolean, buildAllowedUrlsFunc?: (settings: Settings) => Set<string>, computeUrlsHashFunc?: (urls: Set<string>) => string, ALLOWED_URLS_KEY?: string, ALLOWED_URLS_HASH_KEY?: string): Promise<void>;
/**
 * 設定キャッシュをクリアする（テスト用）
 * ストレージから完全に再読み込みする場合に使用
 */
export declare function clearSettingsCache(): void;
//# sourceMappingURL=storageSettings.d.ts.map