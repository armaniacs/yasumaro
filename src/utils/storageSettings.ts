/**
 * storageSettings.ts
 * 設定管理関連の機能
 * 設定の取得、保存、マイグレーション
 */

import { encryptApiKey, decryptApiKey, isEncrypted } from './crypto.js';
import { withOptimisticLock } from './optimisticLock.js';
import type {
    UblockRules,
    Source,
    CustomPrompt
} from './types.js';

// 暗号化対象のAPIキーフィールド
export const API_KEY_FIELDS = [
    'obsidian_api_key',
    'gemini_api_key',
    'openai_api_key',
    'openai_2_api_key'
] as const;

// データ移行フラグ - 古い個別キーから単一settingsオブジェクトへの移行完了済み
export const SETTINGS_MIGRATED_KEY = 'settings_migrated';

// メモリキャッシュ
let cachedSettings: { data: unknown; timestamp: number } | null = null;
const SETTINGS_CACHE_TTL = 1000; // 1秒間キャッシュ（record()内の重複呼び出し防止）

/**
 * Settings 型のインターフェース
 * StorageKeyValues のインポートを回避するため、内部で定義
 */
export interface SettingsValue {
    obsidian_api_key?: string | { ciphertext: string; iv: string };
    obsidian_protocol?: 'http' | 'https';
    obsidian_port?: string;
    gemini_api_key?: string | { ciphertext: string; iv: string };
    min_visit_duration?: number;
    min_scroll_depth?: number;
    gemini_model?: string;
    obsidian_daily_path?: string;
    ai_provider?: string;
    openai_base_url?: string;
    openai_api_key?: string | { ciphertext: string; iv: string };
    openai_model?: string;
    openai_2_base_url?: string;
    openai_2_api_key?: string | { ciphertext: string; iv: string };
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
    [key: string]: unknown; // レガシー互換性
}

export type Settings = SettingsValue & {
    [key: string]: unknown;
};

/**
 * デフォルト設定
 */
export const DEFAULT_SETTINGS: Settings = {
    obsidian_api_key: '',
    obsidian_protocol: 'http',
    obsidian_port: '27123',
    min_visit_duration: 5,
    min_scroll_depth: 50,
    gemini_api_key: '',
    gemini_model: 'gemini-1.5-flash',
    obsidian_daily_path: '092.Daily',
    ai_provider: 'openai',
    openai_base_url: 'https://api.groq.com/openai/v1',
    openai_api_key: '',
    openai_model: 'openai/gpt-oss-20b',
    openai_2_base_url: 'http://127.0.0.1:11434/v1',
    openai_2_api_key: '',
    openai_2_model: 'llama3',
    domain_whitelist: [],
    domain_blacklist: [
        'amazon.co.jp',
        'amazon.com',
        'yahoo.co.jp',
        'yahoo.com',
        'facebook.com',
        'twitter.com',
        'x.com',
        'instagram.com',
        'youtube.com',
        'google.com',
        'google.co.jp'
    ],
    domain_filter_mode: 'blacklist',
    privacy_mode: 'masked_cloud',
    pii_confirmation_ui: true,
    pii_sanitize_logs: true,
    ublock_rules: {
        blockDomains: [],
        exceptionDomains: [],
        metadata: {
            importedAt: 0,
            ruleCount: 0
        }
    },
    ublock_sources: [],
    ublock_format_enabled: false,
    simple_format_enabled: true,
    allowed_urls: [],
    allowed_urls_hash: '',
    custom_prompts: [],
    // マスターパスワード保護オプション
    mp_protection_enabled: false,
    mp_encrypt_api_keys: true,
    mp_encrypt_on_export: true,
    mp_require_on_import: true
};

/**
 * 暗号化キーがストレージキーかどうかを判定する
 */
function isEncryptionKey(key: string): boolean {
    return key === 'encryption_salt' ||
        key === 'encryption_secret' ||
        key === 'hmac_secret';
}

/**
 * 古い個別キー方式から単一settingsオブジェクト方式へのマイグレーション
 *
 * @param {ReadonlyArray<string>} validStorageKeys - 有効なストレージキーの配列
 * @returns {Promise<boolean>} マイグレーションが実行された場合はtrue
 */
export async function migrateToSingleSettingsObject(validStorageKeys: ReadonlyArray<string>): Promise<boolean> {
    // 既に移行済みの場合はスキップ
    const result = await chrome.storage.local.get(SETTINGS_MIGRATED_KEY);
    if (result[SETTINGS_MIGRATED_KEY]) {
        return false;
    }

    // 現在のストレージデータを取得
    const existingKeys = await chrome.storage.local.get(null);
    const settings: Settings = {} as Settings;

    // StorageKeysに含まれる個別キーをsettingsオブジェクトに集約
    for (const [key, value] of Object.entries(existingKeys)) {
        if (validStorageKeys.includes(key) &&
            !key.includes('_version') &&
            !isEncryptionKey(key) &&
            key !== SETTINGS_MIGRATED_KEY) {
            settings[key] = value;
        }
    }

    // settingsオブジェクトが空であれば、デフォルト設定で初期化
    if (Object.keys(settings).length === 0) {
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
            settings[key] = value;
        }
    }

    // 楽観的ロックで安全に保存
    await withOptimisticLock('settings', (currentSettings: Settings) => {
        return { ...currentSettings, ...settings };
    });

    // マイグレーション完了フラグを設定
    await chrome.storage.local.set({ [SETTINGS_MIGRATED_KEY]: true });

    // 古い個別キーを削除
    const keysToRemove = Object.keys(existingKeys).filter(key =>
        validStorageKeys.includes(key) &&
        !key.includes('_version') &&
        !isEncryptionKey(key) &&
        key !== SETTINGS_MIGRATED_KEY
    );

    if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
    }

    return true;
}

/**
 * 設定を取得する
 *
 * @param {() => Promise<CryptoKey>} getEncryptionKey - 暗号化キー取得関数
 * @param {() => Promise<boolean>} runMigration - マイグレーション実行関数
 * @param {ReadonlyArray<string>} validStorageKeys - 有効なストレージキーの配列
 * @param {string} ObsidianApiKey - Obsidian APIキーのストレージキー
 * @returns {Promise<Settings>} 設定オブジェクト
 */
export async function getSettings(
    getEncryptionKey: () => Promise<CryptoKey>,
    runMigration: () => Promise<boolean>,
    validStorageKeys: ReadonlyArray<string>,
    ObsidianApiKey: string
): Promise<Settings> {
    // 【パフォーマンス改善】短時間キャッシュチェック（1秒間有効）
    const now = Date.now();
    if (cachedSettings && cachedSettings.data && (now - cachedSettings.timestamp) < SETTINGS_CACHE_TTL) {
        return cachedSettings.data as Settings;
    }

    // 単一settingsオブジェクトが存在する場合はそれを使用
    const result = await chrome.storage.local.get(['settings', SETTINGS_MIGRATED_KEY]);

    const rawSettings = result.settings as Settings | undefined;
    console.log('[Storage] Raw storage result:', {
        hasSettings: !!rawSettings,
        hasMigratedKey: !!result[SETTINGS_MIGRATED_KEY],
        obsidianKeyInSettings: rawSettings ? ObsidianApiKey in rawSettings : false,
        obsidianKeyValue: rawSettings?.[ObsidianApiKey],
        obsidianKeyType: typeof rawSettings?.[ObsidianApiKey],
        isEncryptedCheck: rawSettings?.[ObsidianApiKey] ? isEncrypted(rawSettings[ObsidianApiKey]) : false
    });

    if (result.settings && result[SETTINGS_MIGRATED_KEY]) {
        let settings = result.settings;
        // StorageKeysに含まれないキー（ゴミデータ）を排除
        const filteredSettings: Settings = {} as Settings;
        for (const [key, value] of Object.entries(settings)) {
            if (validStorageKeys.includes(key)) {
                filteredSettings[key] = value;
            }
        }
        const merged = { ...DEFAULT_SETTINGS, ...filteredSettings };

        // 暗号化されたAPIキーを復号
        try {
            const key = await getEncryptionKey();
            for (const field of API_KEY_FIELDS) {
                const value = merged[field];
                if (isEncrypted(value)) {
                    try {
                        merged[field] = await decryptApiKey(value, key);
                    } catch (e) {
                        console.error(`Failed to decrypt ${field}:`, e);
                        merged[field] = '';
                    }
                }
            }
        } catch (e) {
            console.error('Failed to get encryption key for decryption:', e);
        }

        // 【パフォーマンス改善】復号後にキャッシュを保存
        cachedSettings = { data: merged, timestamp: Date.now() };

        return merged;
    }

    // 旧方式: StorageKeysで定義されているキーのみを取得
    let settings = await chrome.storage.local.get(Array.from(validStorageKeys));
    const migrated = await runMigration();
    if (migrated) {
        // マイグレーション後は同じキーで再取得
        const afterMigration = await chrome.storage.local.get(Array.from(validStorageKeys));
        settings = { ...settings, ...afterMigration }; // マイグレーション後の値をマージ
        // addLog(LogType.DEBUG, 'Settings migration completed', { migrated, keysUpdated: Object.keys(afterMigration) });
    }
    const merged = { ...DEFAULT_SETTINGS, ...settings };

    // 暗号化されたAPIキーを復号
    try {
        const key = await getEncryptionKey();
        for (const field of API_KEY_FIELDS) {
            const value = merged[field];
            if (isEncrypted(value)) {
                try {
                    merged[field] = await decryptApiKey(value, key);
                } catch (e) {
                    console.error(`Failed to decrypt ${field}:`, e);
                    merged[field] = '';
                }
            }
        }
    } catch (e) {
        console.error('Failed to get encryption key for decryption:', e);
    }

    // 【パフォーマンス改善】復号後にキャッシュを保存
    cachedSettings = { data: merged, timestamp: Date.now() };

    return merged;
}

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
export async function saveSettings(
    settings: Settings,
    getEncryptionKey: () => Promise<CryptoKey>,
    updateAllowedUrlsFlag: boolean = false,
    buildAllowedUrlsFunc?: (settings: Settings) => Set<string>,
    computeUrlsHashFunc?: (urls: Set<string>) => string,
    ALLOWED_URLS_KEY?: string,
    ALLOWED_URLS_HASH_KEY?: string
): Promise<void> {
    // 【パフォーマンス改善】設定保存時にキャッシュを無効化
    cachedSettings = null;

    const toSave = { ...settings };

    // APIキーフィールドを暗号化
    try {
        const key = await getEncryptionKey();
        for (const field of API_KEY_FIELDS) {
            if (field in toSave && typeof toSave[field] === 'string' && toSave[field] !== '') {
                const originalValue = toSave[field] as string;
                toSave[field] = await encryptApiKey(originalValue, key);
                console.log(`Encrypted ${field}:`, {
                    hadValue: !!originalValue,
                    originalLength: originalValue.length,
                    encrypted: !!toSave[field]
                });
            }
        }
    } catch (e) {
        console.error('Failed to encrypt API keys:', e);
    }

    if (updateAllowedUrlsFlag && buildAllowedUrlsFunc && computeUrlsHashFunc && ALLOWED_URLS_KEY && ALLOWED_URLS_HASH_KEY) {
        // 現在の設定を取得してマージ
        const currentSettings = await getSettings(
            getEncryptionKey,
            async () => false,
            [],
            ''
        );
        const mergedSettings = { ...currentSettings, ...toSave };

        // 許可されたURLのリストを再構築
        const allowedUrls = buildAllowedUrlsFunc(mergedSettings);
        const allowedUrlsHash = computeUrlsHashFunc(allowedUrls);

        Object.assign(toSave, {
            [ALLOWED_URLS_KEY]: Array.from(allowedUrls),
            [ALLOWED_URLS_HASH_KEY]: allowedUrlsHash
        });
    }

    // 楽観的ロックを使用して同時実行時の競合を防止
    await withOptimisticLock('settings', (currentSettings: Settings) => {
        return { ...currentSettings, ...toSave };
    });
}

/**
 * 設定キャッシュをクリアする（テスト用）
 * ストレージから完全に再読み込みする場合に使用
 */
export function clearSettingsCache(): void {
    cachedSettings = null;
}