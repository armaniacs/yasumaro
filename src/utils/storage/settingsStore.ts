/**
 * storage/settingsStore.ts
 * Settings CRUD, legacy-key migration, and the allowed-URL list that's
 * derived from settings. Split out of storage.ts (PBI: storage.ts deepening).
 */

import { logInfo, logDebug, logError, ErrorCode } from '../logger.js';
import { errorMessage } from '../errorUtils.js';
import { migrateUblockSettings, migrateJpLayoutDefault, migrateCategoryBDefault, migrateWhitelistExtractionDefault } from '../migration.js';
import { isEncrypted, encryptApiKey, decryptApiKey } from '../crypto.js';
import { withOptimisticLock } from '../optimisticLock.js';
import { normalizeUrl } from '../urlUtils.js';
import { getOrCreateEncryptionKey } from './encryptionSession.js';
import { getStorageUsage, estimateDataSize, STORAGE_QUOTA_BYTES } from './quota.js';
import { purgeLegacyStorage } from './savedUrlStore.js';
import { StorageKeys } from './types.js';
import { DEFAULT_SETTINGS } from './defaults.js';
import type { StorageKey, StorageKeyValues, Settings } from './types.js';

export { purgeLegacyStorage } from './savedUrlStore.js';

// 暗号化対象のAPIキーフィールド
export const API_KEY_FIELDS: StorageKey[] = [
    StorageKeys.OBSIDIAN_API_KEY,
    StorageKeys.GEMINI_API_KEY,
    StorageKeys.OPENAI_API_KEY,
    StorageKeys.OPENAI_2_API_KEY,
    StorageKeys.PROVIDER_API_KEY,
    StorageKeys.GITHUB_PAT,
];

// 許可するAIプロバイダードメインのホワイトリスト
export const ALLOWED_AI_PROVIDER_DOMAINS = [
    // メジャーAIプロバイダー
    'generativelanguage.googleapis.com',   // Google Gemini
    'api.groq.com',                          // Groq
    'api.openai.com',                        // OpenAI公式
    'api.anthropic.com',                     // Anthropic Claude
    'api-inference.huggingface.co',          // Hugging Face
    'openrouter.ai',                         // OpenRouter
    'api.openrouter.ai',                     // OpenRouter API
    'mistral.ai',                            // Mistral AI
    'deepinfra.com',                         // DeepInfra
    'cerebras.ai',                           // Cerebras

    // APIゲートウェイ
    'ai-gateway.helicone.ai',                // Helicone

    // LiteLLMサポートプロバイダー
    'api.publicai.co',                       // PublicAI
    'api.venice.ai',                         // Venice AI
    'api.scaleway.ai',                       // Scaleway
    'api.synthetic.new',                     // Synthetic
    'api.stima.tech',                        // Apertis (Stima API)
    'nano-gpt.com',                          // Nano-GPT
    'api.poe.com',                           // Poe
    'llm.chutes.ai',                         // Chutes
    'api.abliteration.ai',                   // Abliteration
    'api.llamagate.dev',                     // LlamaGate
    'api.gmi-serving.com',                   // GMI Cloud
    'api.sarvam.ai',                         // Sarvam AI
    'deepseek.com',                          // DeepSeek
    'xiaomimimo.com',                        // Xiaomi MiMo

    // クラウドネイティブAI
    'nebius.com',                            // Nebius AI
    'sambanova.ai',                          // SambaNova
    'nscale.com',                            // Nscale
    'featherless.ai',                        // Featherless AI
    'galadriel.com',                         // Galadriel
    'perplexity.ai',                         // Perplexity AI
    'recraft.ai',                            // Recraft

    // 埋込みAI
    'jina.ai',                               // Jina AI
    'voyageai.com',                          // Voyage AI

    // その他
    'volcengine.com',                        // Volcano Engine (bytedance)
    'z.ai',                                  // ZHIPU AI
    'wandb.ai',                              // Weights & Biases

    // Sakuraクラウドドメイン
    'api.ai.sakura.ad.jp',                          // Sakuraクラウド（AI API）

    // uBlock Originフィルターソース
    'raw.githubusercontent.com',             // GitHub Raw Content
    'gitlab.com',                            // GitLab
    'easylist.to',                           // EasyList
    'pgl.yoyo.org',                          // Peter Lowe's List

    // ローカル環境（開発用）
    'localhost',
    '127.0.0.1',
];

/**
 * ドメインがホワイトリストに含まれるかチェックする
 * @param {string} url - チェック対象のURL
 * @returns {boolean} 許可される場合true
 */
export function isDomainInWhitelist(url: string): boolean {
    try {
        const parsedUrl = new URL(url);
        const hostname = parsedUrl.hostname;

        // 完全一致チェック
        if (ALLOWED_AI_PROVIDER_DOMAINS.includes(hostname)) {
            return true;
        }

        // ワイルドカードチェック（*.sakuraha.jp 等）
        for (const allowedDomain of ALLOWED_AI_PROVIDER_DOMAINS) {
            if (allowedDomain.startsWith('*.')) {
                const domainSuffix = allowedDomain.substring(2);
                if (hostname === domainSuffix || hostname.endsWith('.' + domainSuffix)) {
                    return true;
                }
            }
        }

        return false;
    } catch (_e) {
        return false;
    }
}

// メモリキャッシュ
let cachedSettings: { data: Settings | null; timestamp: number } | null = null;
const SETTINGS_CACHE_TTL = 1000; // 1秒間キャッシュ（record()内の重複呼び出し防止）

/**
 * データ移行フラグ - 古い個別キーから単一settingsオブジェクトへの移行完了済み
 */
const SETTINGS_MIGRATED_KEY = 'settings_migrated';

/**
 * 暗号化キーがストレージキーかどうかを判定する
 * @param {string} key - チェック対象のキー
 * @returns {boolean} 暗号化キーの場合true
 */
function isEncryptionKey(key: string): boolean {
    return key === StorageKeys.ENCRYPTION_SALT ||
        key === StorageKeys.ENCRYPTION_SECRET ||
        key === StorageKeys.HMAC_SECRET ||
        key === StorageKeys.MASTER_PASSWORD_SALT ||
        key === StorageKeys.MASTER_PASSWORD_HASH;
}

/**
 * 古い個別キー方式から単一settingsオブジェクト方式へのマイグレーション
 *
 * @returns {Promise<boolean>} マイグレーションが実行された場合はtrue
 */
export async function migrateToSingleSettingsObject(): Promise<boolean> {
    // 既に移行済みの場合はスキップ
    const result = await chrome.storage.local.get(SETTINGS_MIGRATED_KEY);
    if (result[SETTINGS_MIGRATED_KEY]) {
        return false;
    }

    // 現在のストレージデータを取得
    const existingKeys = await chrome.storage.local.get(null);
    const settings: Settings = {};

    // StorageKeysに含まれる個別キーをsettingsオブジェクトに集約
    for (const [key, value] of Object.entries(existingKeys)) {
        if (Object.values(StorageKeys).includes(key as StorageKey) &&
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
        Object.values(StorageKeys).includes(key as StorageKey) &&
        !key.includes('_version') &&
        !isEncryptionKey(key) &&
        key !== SETTINGS_MIGRATED_KEY
    );

    if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
    }

    return true;
}

export async function getSettings(): Promise<Settings> {
    // 【パフォーマンス改善】短時間キャッシュチェック（1秒間有効）
    const now = Date.now();
    if (cachedSettings && cachedSettings.data && (now - cachedSettings.timestamp) < SETTINGS_CACHE_TTL) {
        return cachedSettings.data;
    }

    // 単一settingsオブジェクトが存在する場合はそれを使用
    const result = await chrome.storage.local.get(['settings', SETTINGS_MIGRATED_KEY]);

    const rawSettings = result.settings as Settings | undefined;
    await logInfo('[Storage] Raw storage result:', {
        hasSettings: !!rawSettings,
        hasKeys: rawSettings ? Object.keys(rawSettings).some(k => k.toLowerCase().includes('key')) : false
    });

    if (result.settings && result[SETTINGS_MIGRATED_KEY]) {
        let settings = result.settings;
        // StorageKeysに含まれないキー（ゴミデータ）を排除
        const validStorageKeys: string[] = Object.values(StorageKeys);
        const filteredSettings: Settings = {};
        for (const [key, value] of Object.entries(settings)) {
            if (validStorageKeys.includes(key)) {
                filteredSettings[key] = value;
            }
        }
        const merged = { ...DEFAULT_SETTINGS, ...filteredSettings };

        // obsidian_enabled が未設定の場合、obsidian_api_key の有無で初期化（既存ユーザー向けマイグレーション）
        if (!(StorageKeys.OBSIDIAN_ENABLED in filteredSettings)) {
            const apiKey = merged[StorageKeys.OBSIDIAN_API_KEY] as string | undefined;
            merged[StorageKeys.OBSIDIAN_ENABLED] = !!(apiKey && apiKey.length >= 16);
        }

        // AI_PROVIDER_PRIORITY_LIST が未設定の場合、既存の AI_PROVIDER を1位スロットとして導出（既存ユーザー向けマイグレーション）
        if (!(StorageKeys.AI_PROVIDER_PRIORITY_LIST in filteredSettings)) {
            const legacyProvider = merged[StorageKeys.AI_PROVIDER] as string | undefined;
            merged[StorageKeys.AI_PROVIDER_PRIORITY_LIST] = legacyProvider ? [{ provider: legacyProvider }] : [];
        }

        // LOCAL_MARKDOWN_EXPORT_TIMING が未設定の場合、既存の AUTO_ENABLED から導出（既存ユーザー向けマイグレーション）
        if (!(StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING in filteredSettings)) {
            const legacyAutoEnabled = merged[StorageKeys.LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED];
            merged[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING] = legacyAutoEnabled ? 'idle' : 'manual';
        }

        // 暗号化されたAPIキーを復号
        try {
            const key = await getOrCreateEncryptionKey();
            for (const field of API_KEY_FIELDS) {
                const value = merged[field];
                if (isEncrypted(value)) {
                    try {
                        const decryptedValue = await decryptApiKey(value, key);
                        (merged as Record<StorageKey, StorageKeyValues[StorageKey]>)[field] = decryptedValue as StorageKeyValues[StorageKey];
                    } catch (e) {
                        await logError(`Failed to decrypt ${field}`, { error: errorMessage(e), field }, ErrorCode.CRYPTO_DECRYPTION_FAILURE);
                        (merged as Record<StorageKey, StorageKeyValues[StorageKey]>)[field] = '' as StorageKeyValues[StorageKey];
                    }
                }
            }
        } catch (e) {
            await logError('Failed to get encryption key for decryption', { error: errorMessage(e) }, ErrorCode.CRYPTO_KEY_DERIVE_FAILURE);
        }

        // 【パフォーマンス改善】復号後にキャッシュを保存
        cachedSettings = { data: merged, timestamp: Date.now() };

        return merged;
    }

    // 旧方式: StorageKeysで定義されているキーのみを取得
    const keysToGet: string[] = Object.values(StorageKeys);
    let settings = await chrome.storage.local.get(keysToGet);

    // Merge with 'settings' object if it exists (saveSettings writes to this object)
    // The 'settings' object takes precedence since saveSettings always writes there
    if (rawSettings) {
        settings = { ...settings, ...rawSettings };
    }

    const migrated = await migrateUblockSettings();
    if (migrated) {
        // マイグレーション後は同じキーで再取得
        const afterMigration = await chrome.storage.local.get(keysToGet);
        settings = { ...settings, ...afterMigration }; // マイグレーション後の値をマージ
    }

    // Category A: jpLayout デフォルト移行（既存ユーザーは明示的 false を保存）
    await migrateJpLayoutDefault();

    // Category B: newsMedia/ecSite/qaSite/videoSite デフォルト移行（既存ユーザーは明示的 false を保存）
    await migrateCategoryBDefault();

    // Domain Whitelist Extraction Mode デフォルト移行（既存ユーザーは明示的 false を保存）
    await migrateWhitelistExtractionDefault();

    // Tranco バージョン初期化（Phase 1）
    try {
        const { getTrustDb } = await import('../trustDb/trustDb.js');
        const db = getTrustDb();
        await db.initialize();
    } catch (e) {
        // テスト環境などで関数がロードできない場合に備えて保護
        logDebug('storage', { error: e }, 'Failed to initialize Tranco version');
    }
    const merged = { ...DEFAULT_SETTINGS, ...settings };

    // obsidian_enabled が未設定の場合、obsidian_api_key の有無で初期化（既存ユーザー向けマイグレーション）
    if (!(StorageKeys.OBSIDIAN_ENABLED in settings)) {
        const apiKey = merged[StorageKeys.OBSIDIAN_API_KEY] as string | undefined;
        merged[StorageKeys.OBSIDIAN_ENABLED] = !!(apiKey && apiKey.length >= 16);
    }

    // AI_PROVIDER_PRIORITY_LIST が未設定の場合、既存の AI_PROVIDER を1位スロットとして導出（既存ユーザー向けマイグレーション）
    if (!(StorageKeys.AI_PROVIDER_PRIORITY_LIST in settings)) {
        const legacyProvider = merged[StorageKeys.AI_PROVIDER] as string | undefined;
        merged[StorageKeys.AI_PROVIDER_PRIORITY_LIST] = legacyProvider ? [{ provider: legacyProvider }] : [];
    }

    // LOCAL_MARKDOWN_EXPORT_TIMING が未設定の場合、既存の AUTO_ENABLED から導出（既存ユーザー向けマイグレーション）
    if (!(StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING in settings)) {
        const legacyAutoEnabled = merged[StorageKeys.LOCAL_MARKDOWN_EXPORT_AUTO_ENABLED];
        merged[StorageKeys.LOCAL_MARKDOWN_EXPORT_TIMING] = legacyAutoEnabled ? 'idle' : 'manual';
    }
    try {
        const key = await getOrCreateEncryptionKey();
        for (const field of API_KEY_FIELDS) {
            const value = merged[field];
            if (isEncrypted(value)) {
                try {
                    const decryptedValue = await decryptApiKey(value, key);
                    (merged as Record<StorageKey, StorageKeyValues[StorageKey]>)[field] = decryptedValue as StorageKeyValues[StorageKey];
                } catch (e) {
                    await logError(`Failed to decrypt ${field}`, { error: errorMessage(e), field }, ErrorCode.CRYPTO_DECRYPTION_FAILURE);
                    (merged as Record<StorageKey, StorageKeyValues[StorageKey]>)[field] = '' as StorageKeyValues[StorageKey];
                }
            }
        }
    } catch (e) {
        await logError('Failed to get encryption key for decryption', { error: errorMessage(e) }, ErrorCode.CRYPTO_KEY_DERIVE_FAILURE);
    }

    // 【パフォーマンス改善】復号後にキャッシュを保存
    cachedSettings = { data: merged, timestamp: Date.now() };

    return merged;
}

/**
 * 【パフォーマンス改善】設定キャッシュをクリアする（テスト用）
 * ストレージから完全に再読み込みする場合に使用
 */
export function clearSettingsCache(): void {
    cachedSettings = null;
}

/**
 * PBI 2026-07-09-10: Lazily construct a SqliteClient-backed health check.
 * Dynamic import keeps this module free of a static dependency on
 * sqliteClient.ts (used from Service Worker/popup/dashboard contexts alike;
 * SqliteClient itself is message-passing based so it works from any of them).
 * Falls back to reporting unhealthy if the client can't even be constructed.
 */
async function getDefaultSqliteHealthCheck(): Promise<() => Promise<boolean>> {
    try {
        const { SqliteClient } = await import('../../background/sqliteClient.js');
        const client = new SqliteClient();
        return () => client.isSqliteHealthy();
    } catch {
        return async () => false;
    }
}

/**
 * Save settings to chrome.storage.local with optional allowed URL list update.
 *
 * @param {Settings} settings - Settings to save
 * @param {boolean} updateAllowedUrlsFlag - Whether to update the allowed URL list (default: false)
 */
export async function saveSettings(
    settings: Settings,
    updateAllowedUrlsFlag: boolean = false,
    sqliteHealthCheck?: () => Promise<boolean>
): Promise<void> {
    // 【パフォーマンス改善】設定保存時にキャッシュを無効化
    cachedSettings = null;

    let toSave = { ...settings };

    // APIキーフィールドを暗号化
    try {
        const key = await getOrCreateEncryptionKey();
        for (const field of API_KEY_FIELDS) {
            if (field in toSave && typeof toSave[field] === 'string' && toSave[field] !== '') {
                const originalValue = toSave[field] as string;
                (toSave as Record<StorageKey, StorageKeyValues[StorageKey]>)[field] = await encryptApiKey(originalValue, key) as StorageKeyValues[StorageKey];
                await logDebug(`Encrypted ${field}:`, {
                    hadValue: !!originalValue,
                    originalLength: originalValue.length,
                    encrypted: !!toSave[field]
                });
            }
        }
    } catch (e) {
        await logError('Failed to encrypt API keys', { error: errorMessage(e) }, ErrorCode.CRYPTO_ENCRYPTION_FAILURE);
        throw e;
    }

    if (updateAllowedUrlsFlag) {
        // 現在の設定を取得してマージ
        const currentSettings = await getSettings();
        const mergedSettings = { ...currentSettings, ...toSave };

        // 許可されたURLのリストを再構築
        const allowedUrls = buildAllowedUrls(mergedSettings);
        const allowedUrlsHash = computeUrlsHash(allowedUrls);

        toSave = {
            ...toSave,
            [StorageKeys.ALLOWED_URLS]: Array.from(allowedUrls),
            [StorageKeys.ALLOWED_URLS_HASH]: allowedUrlsHash
        };
    }

    // 【セキュリティ改善】保存前にクォータチェック
    // クォータ超過時は自動的にレガシーデータをクリーンアップしてリトライ
    const currentUsage = await getStorageUsage();
    const newDataSize = estimateDataSize(toSave);
    if (currentUsage + newDataSize > STORAGE_QUOTA_BYTES) {
        await logInfo('Storage quota near limit, attempting legacy cleanup', {
            currentUsage, newDataSize, limit: STORAGE_QUOTA_BYTES,
        }, 'storage/settingsStore.ts');

        // Try to free space by cleaning up legacy savedUrlsWithTimestamps.
        // PBI 2026-07-09-10: when the caller doesn't supply its own health
        // check, fall back to a default one (dynamic import to avoid a
        // settingsStore.ts -> sqliteClient.ts static dependency) so this
        // safety gate is on by default rather than opt-in per call site.
        const effectiveHealthCheck = sqliteHealthCheck ?? (await getDefaultSqliteHealthCheck());
        const freed = await purgeLegacyStorage(effectiveHealthCheck);
        const afterCleanup = await getStorageUsage();

        if (afterCleanup + newDataSize <= STORAGE_QUOTA_BYTES) {
            await logInfo('Legacy cleanup freed space, proceeding with save', {
                freed, usageAfter: afterCleanup,
            }, 'storage/settingsStore.ts');
        } else {
            const errorMsg = `Storage quota exceeded (current: ${afterCleanup}, new: ${newDataSize}, limit: ${STORAGE_QUOTA_BYTES})`;
            await logError(errorMsg, { freed, usageAfter: afterCleanup }, ErrorCode.STORAGE_QUOTA_EXCEEDED, 'storage/settingsStore.ts');
            throw new Error(errorMsg);
        }
    }

    // 楽観的ロックを使用して同時実行時の競合を防止
    await withOptimisticLock('settings', (currentSettings: Settings) => {
        return { ...currentSettings, ...toSave };
    });
}

/**
 * 設定から許可されたURLのリストを構築
 * @param {object} settings - 設定オブジェクト
 * @returns {Set<string>} 許可されたURLのセット
 */
export function buildAllowedUrls(settings: Settings): Set<string> {
    const allowedUrls = new Set<string>();

    // Obsidian API
    const protocol = settings[StorageKeys.OBSIDIAN_PROTOCOL] || 'https';
    const port = settings[StorageKeys.OBSIDIAN_PORT] || '27124';
    try {
        allowedUrls.add(normalizeUrl(`${protocol}://127.0.0.1:${port}`));
    } catch (e) {
        console.warn(`Invalid Obsidian URL (127.0.0.1), skipping: ${errorMessage(e)}`);
    }
    try {
        allowedUrls.add(normalizeUrl(`${protocol}://localhost:${port}`));
    } catch (e) {
        console.warn(`Invalid Obsidian URL (localhost), skipping: ${errorMessage(e)}`);
    }

    // Gemini API
    allowedUrls.add('https://generativelanguage.googleapis.com');

    // OpenAI互換API - ホワイトリストチェック
    const openaiBaseUrl = settings[StorageKeys.OPENAI_BASE_URL];
    if (openaiBaseUrl) {
        if (isDomainInWhitelist(openaiBaseUrl)) {
            try {
                const normalized = normalizeUrl(openaiBaseUrl);
                allowedUrls.add(normalized);
            } catch (e) {
                console.warn(`Invalid OpenAI Base URL, skipping: ${openaiBaseUrl}, error: ${errorMessage(e)}`);
            }
        } else {
            console.warn(`OpenAI Base URL not in whitelist, skipped: ${openaiBaseUrl}`);
        }
    }

    const openai2BaseUrl = settings[StorageKeys.OPENAI_2_BASE_URL];
    if (openai2BaseUrl) {
        if (isDomainInWhitelist(openai2BaseUrl)) {
            try {
                const normalized = normalizeUrl(openai2BaseUrl);
                allowedUrls.add(normalized);
            } catch (e) {
                console.warn(`Invalid OpenAI 2 Base URL, skipping: ${openai2BaseUrl}, error: ${errorMessage(e)}`);
            }
        } else {
            console.warn(`OpenAI 2 Base URL not in whitelist, skipped: ${openai2BaseUrl}`);
        }
    }

    // OpenAI互換プロバイダー（provider_base_url）- ホワイトリストチェック
    const providerBaseUrl = settings[StorageKeys.PROVIDER_BASE_URL];
    if (providerBaseUrl) {
        if (isDomainInWhitelist(providerBaseUrl)) {
            try {
                const normalized = normalizeUrl(providerBaseUrl);
                allowedUrls.add(normalized);
            } catch (e) {
                console.warn(`Invalid Provider Base URL, skipping: ${providerBaseUrl}, error: ${errorMessage(e)}`);
            }
        } else {
            console.warn(`Provider Base URL not in whitelist, skipped: ${providerBaseUrl}`);
        }
    }

    // uBlock Filter Sources - 既存のソース
    const ublockSources = settings[StorageKeys.UBLOCK_SOURCES] || [];
    for (const source of ublockSources) {
        if (source.url && source.url !== 'manual') {
            try {
                const parsed = new URL(source.url);
                allowedUrls.add(normalizeUrl(parsed.origin));
            } catch (_e) {
                // 無効なURLは無視
            }
        }
    }

    // uBlock Filter Sources - 固定的に許可するフィルターリスト提供サイト
    // 新規インポート時にもアクセスできるよう、固定ドメインを追加
    allowedUrls.add('https://raw.githubusercontent.com');
    allowedUrls.add('https://gitlab.com');
    allowedUrls.add('https://easylist.to');
    allowedUrls.add('https://pgl.yoyo.org');
    allowedUrls.add('https://nsfw.oisd.nl');

    return allowedUrls;
}

/**
 * URLリストのハッシュを計算
 * @param {Set<string>} urls - URLのセット
 * @returns {string} ハッシュ値
 */
export function computeUrlsHash(urls: Set<string>): string {
    const sortedUrls = Array.from(urls).sort();
    return sortedUrls.join('|');
}

/**
 * 設定を保存し、許可されたURLのリストを再構築
 * @param {Settings} settings - 設定オブジェクト
 */
export async function saveSettingsWithAllowedUrls(settings: Settings): Promise<void> {
    // 改訂: saveSettings を使用して常に暗号化とURLリスト更新を行う
    await saveSettings(settings, true);
    // 【Task #19 最適化】ドメインフィルタキャッシュを更新
    const { updateDomainFilterCache } = await import('./domainFilterCache.js');
    await updateDomainFilterCache(settings);
}

/**
 * 許可されたURLのリストを取得
 * @returns {Promise<Set<string>>} 許可されたURLのセット
 */
export async function getAllowedUrls(): Promise<Set<string>> {
    const result = await chrome.storage.local.get(StorageKeys.ALLOWED_URLS);
    const urls = (result[StorageKeys.ALLOWED_URLS] as string[]) || [];
    return new Set(urls);
}
