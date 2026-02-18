/**
 * storage.ts
 * Wrapper for chrome.storage.local to manage settings.
 */
// Temporarily disabled to resolve circular dependency
// import { addLog, LogType } from './logger.js';
import { migrateUblockSettings } from './migration.js';
import { generateSalt, deriveKeyWithExtensionId, encryptApiKey, decryptApiKey, isEncrypted } from './crypto.js';
import { withOptimisticLock, ensureVersionInitialized } from './optimisticLock.js';
import { normalizeUrl } from './urlUtils.js';
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
    // Domain filter settings
    DOMAIN_WHITELIST: 'domain_whitelist',
    DOMAIN_BLACKLIST: 'domain_blacklist',
    DOMAIN_FILTER_MODE: 'domain_filter_mode',
    // Privacy settings（Phase 3）
    PRIVACY_MODE: 'privacy_mode', // 'local_only' | 'full_pipeline' | 'masked_cloud' | 'cloud_only'
    PII_CONFIRMATION_UI: 'pii_confirmation_ui', // true | false
    PII_SANITIZE_LOGS: 'pii_sanitize_logs', // true | false
    // uBlock Origin format settings
    UBLOCK_RULES: 'ublock_rules', // uBlock形式ルールセット（マージ済み）
    UBLOCK_SOURCES: 'ublock_sources', // uBlockソースリスト（複数対応）
    UBLOCK_FORMAT_ENABLED: 'ublock_format_enabled', // uBlock形式有効化フラグ
    SIMPLE_FORMAT_ENABLED: 'simple_format_enabled', // シンプル形式有効化フラグ
    // Dynamic URL validation settings (CSP tightening)
    ALLOWED_URLS: 'allowed_urls', // 許可されたURLのリスト（配列）
    ALLOWED_URLS_HASH: 'allowed_urls_hash', // URLリストのハッシュ（変更検出用）
    // Encryption settings
    ENCRYPTION_SALT: 'encryption_salt', // PBKDF2用ソルト（Base64）
    ENCRYPTION_SECRET: 'encryption_secret', // 自動生成されたランダムシークレット（Base64）
    HMAC_SECRET: 'hmac_secret', // 設定エクスポート用HMACシークレット（Base64）
    // Version tracking for optimistic locking
    SAVED_URLS_VERSION: 'savedUrls_version', // savedUrlsのバージョン番号
    // Custom prompts
    CUSTOM_PROMPTS: 'custom_prompts' // カスタムプロンプト設定
};
// 暗号化対象のAPIキーフィールド
const API_KEY_FIELDS = [
    StorageKeys.OBSIDIAN_API_KEY,
    StorageKeys.GEMINI_API_KEY,
    StorageKeys.OPENAI_API_KEY,
    StorageKeys.OPENAI_2_API_KEY
];
// 許可するAIプロバイダードメインのホワイトリスト
export const ALLOWED_AI_PROVIDER_DOMAINS = [
    // メジャーAIプロバイダー
    'generativelanguage.googleapis.com', // Google Gemini
    'api.groq.com', // Groq
    'api.openai.com', // OpenAI公式
    'api.anthropic.com', // Anthropic Claude
    'api-inference.huggingface.co', // Hugging Face
    'openrouter.ai', // OpenRouter
    'api.openrouter.ai', // OpenRouter API
    'mistral.ai', // Mistral AI
    'deepinfra.com', // DeepInfra
    'cerebras.ai', // Cerebras
    // APIゲートウェイ
    'ai-gateway.helicone.ai', // Helicone
    // LiteLLMサポートプロバイダー
    'api.publicai.co', // PublicAI
    'api.venice.ai', // Venice AI
    'api.scaleway.ai', // Scaleway
    'api.synthetic.new', // Synthetic
    'api.stima.tech', // Apertis (Stima API)
    'nano-gpt.com', // Nano-GPT
    'api.poe.com', // Poe
    'llm.chutes.ai', // Chutes
    'api.abliteration.ai', // Abliteration
    'api.llamagate.dev', // LlamaGate
    'api.gmi-serving.com', // GMI Cloud
    'api.sarvam.ai', // Sarvam AI
    'deepseek.com', // DeepSeek
    'xiaomimimo.com', // Xiaomi MiMo
    // クラウドネイティブAI
    'nebius.com', // Nebius AI
    'sambanova.ai', // SambaNova
    'nscale.com', // Nscale
    'featherless.ai', // Featherless AI
    'galadriel.com', // Galadriel
    'perplexity.ai', // Perplexity AI
    'recraft.ai', // Recraft
    // 埋込みAI
    'jina.ai', // Jina AI
    'voyageai.com', // Voyage AI
    // その他
    'volcengine.com', // Volcano Engine (bytedance)
    'z.ai', // ZHIPU AI
    'wandb.ai', // Weights & Biases
    // Sakuraクラウドドメイン
    'api.ai.sakura.ad.jp', // Sakuraクラウド（AI API）
    // uBlock Originフィルターソース
    'raw.githubusercontent.com', // GitHub Raw Content
    'gitlab.com', // GitLab
    'easylist.to', // EasyList
    'pgl.yoyo.org', // Peter Lowe's List
    // ローカル環境（開発用）
    'localhost',
    '127.0.0.1',
];
/**
 * ドメインがホワイトリストに含まれるかチェックする
 * @param {string} url - チェック対象のURL
 * @returns {boolean} 許可される場合true
 */
export function isDomainInWhitelist(url) {
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
    }
    catch (e) {
        return false;
    }
}
// メモリキャッシュ
let cachedEncryptionKey = null;
let cachedExtensionId = null;
/**
 * 暗号化キーを取得または作成する
 * ソルト/シークレットが無ければ自動生成してストレージに保存
 * chrome.runtime.idをキー導出に組み込むことで、異なる環境間のデータ分離を実現
 *
 * @returns {Promise<CryptoKey>} 導出された暗号化キー
 */
export async function getOrCreateEncryptionKey() {
    if (cachedEncryptionKey && cachedExtensionId) {
        return cachedEncryptionKey;
    }
    // 現在のextension IDを取得
    const extensionId = chrome.runtime.id;
    // Extension ID変更時にキャッシュをクリア（通常は発生しないが安全策）
    if (cachedExtensionId && cachedExtensionId !== extensionId) {
        cachedEncryptionKey = null;
    }
    cachedExtensionId = extensionId;
    const result = await chrome.storage.local.get([
        StorageKeys.ENCRYPTION_SALT,
        StorageKeys.ENCRYPTION_SECRET
    ]);
    let saltBase64 = result[StorageKeys.ENCRYPTION_SALT];
    let secret = result[StorageKeys.ENCRYPTION_SECRET];
    if (!saltBase64 || !secret) {
        // 初回: ソルトとシークレットを生成
        const salt = generateSalt();
        saltBase64 = btoa(String.fromCharCode(...salt));
        // 32バイトのランダムシークレットを生成
        const secretBytes = crypto.getRandomValues(new Uint8Array(32));
        secret = btoa(String.fromCharCode(...secretBytes));
        await chrome.storage.local.set({
            [StorageKeys.ENCRYPTION_SALT]: saltBase64,
            [StorageKeys.ENCRYPTION_SECRET]: secret
        });
    }
    // Base64からUint8Arrayに変換
    const binaryString = atob(saltBase64);
    const salt = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        salt[i] = binaryString.charCodeAt(i);
    }
    // Extension IDを使用してキーを導出
    cachedEncryptionKey = await deriveKeyWithExtensionId(secret, salt, extensionId);
    return cachedEncryptionKey;
}
/**
 * 暗号化キーのキャッシュをクリアする（テスト用）
 */
export function clearEncryptionKeyCache() {
    cachedEncryptionKey = null;
}
// HMAC Secret用キャッシュ
let cachedHmacSecret = null;
/**
 * HMAC Secretを取得または作成する
 * @returns {Promise<string>} HMACシークレット
 */
export async function getOrCreateHmacSecret() {
    if (cachedHmacSecret) {
        return cachedHmacSecret;
    }
    const result = await chrome.storage.local.get(StorageKeys.HMAC_SECRET);
    let secret = result[StorageKeys.HMAC_SECRET];
    if (!secret) {
        // 32バイトのランダムシークレットを生成
        const secretBytes = crypto.getRandomValues(new Uint8Array(32));
        secret = btoa(String.fromCharCode(...secretBytes));
        await chrome.storage.local.set({
            [StorageKeys.HMAC_SECRET]: secret
        });
    }
    cachedHmacSecret = secret;
    return secret;
}
const DEFAULT_SETTINGS = {
    [StorageKeys.OBSIDIAN_API_KEY]: '', // APIキー（ユーザーが設定）
    [StorageKeys.OBSIDIAN_PROTOCOL]: 'http', // Default HTTP for Local REST API
    [StorageKeys.OBSIDIAN_PORT]: '27123',
    [StorageKeys.MIN_VISIT_DURATION]: 5, // seconds
    [StorageKeys.MIN_SCROLL_DEPTH]: 50, // percentage
    [StorageKeys.GEMINI_API_KEY]: '', // APIキー（ユーザーが設定）
    [StorageKeys.GEMINI_MODEL]: 'gemini-1.5-flash',
    [StorageKeys.OBSIDIAN_DAILY_PATH]: '092.Daily', // Default folder path
    [StorageKeys.AI_PROVIDER]: 'openai',
    [StorageKeys.OPENAI_BASE_URL]: 'https://api.groq.com/openai/v1',
    [StorageKeys.OPENAI_API_KEY]: '', // APIキー（ユーザーが設定）
    [StorageKeys.OPENAI_MODEL]: 'openai/gpt-oss-20b',
    [StorageKeys.OPENAI_2_BASE_URL]: 'http://127.0.0.1:11434/v1',
    [StorageKeys.OPENAI_2_API_KEY]: '', // APIキー（ユーザーが設定）
    [StorageKeys.OPENAI_2_MODEL]: 'llama3',
    // Domain filter defaults
    [StorageKeys.DOMAIN_WHITELIST]: [],
    [StorageKeys.DOMAIN_BLACKLIST]: [
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
    [StorageKeys.DOMAIN_FILTER_MODE]: 'blacklist', // 'whitelist', 'blacklist', 'disabled'
    // Privacy defaults
    [StorageKeys.PRIVACY_MODE]: 'masked_cloud',
    [StorageKeys.PII_CONFIRMATION_UI]: true,
    [StorageKeys.PII_SANITIZE_LOGS]: true,
    // uBlock format defaults（軽量化版: ドメイン配列のみ）
    [StorageKeys.UBLOCK_RULES]: {
        blockDomains: [],
        exceptionDomains: [],
        metadata: {
            importedAt: 0,
            ruleCount: 0
        }
    },
    [StorageKeys.UBLOCK_SOURCES]: [], // 複数ソースのリスト
    [StorageKeys.UBLOCK_FORMAT_ENABLED]: false,
    [StorageKeys.SIMPLE_FORMAT_ENABLED]: true,
    // Dynamic URL validation defaults
    [StorageKeys.ALLOWED_URLS]: [], // 許可されたURLのリスト（設定から動的に構築）
    [StorageKeys.ALLOWED_URLS_HASH]: '', // URLリストのハッシュ（変更検出用）
    // Custom prompts defaults
    [StorageKeys.CUSTOM_PROMPTS]: [] // カスタムプロンプトのリスト
};
/**
 * データ移行フラグ - 古い個別キーから単一settingsオブジェクトへの移行完了済み
 */
const SETTINGS_MIGRATED_KEY = 'settings_migrated';
/**
 * 暗号化キーがストレージキーかどうかを判定する
 * @param {string} key - チェック対象のキー
 * @returns {boolean} 暗号化キーの場合true
 */
function isEncryptionKey(key) {
    return key === StorageKeys.ENCRYPTION_SALT ||
        key === StorageKeys.ENCRYPTION_SECRET ||
        key === StorageKeys.HMAC_SECRET;
}
/**
 * 古い個別キー方式から単一settingsオブジェクト方式へのマイグレーション
 *
 * @returns {Promise<boolean>} マイグレーションが実行された場合はtrue
 */
export async function migrateToSingleSettingsObject() {
    // 既に移行済みの場合はスキップ
    const result = await chrome.storage.local.get(SETTINGS_MIGRATED_KEY);
    if (result[SETTINGS_MIGRATED_KEY]) {
        return false;
    }
    // 現在のストレージデータを取得
    const existingKeys = await chrome.storage.local.get(null);
    const settings = {};
    // StorageKeysに含まれる個別キーをsettingsオブジェクトに集約
    for (const [key, value] of Object.entries(existingKeys)) {
        if (Object.values(StorageKeys).includes(key) &&
            !key.includes('_version') &&
            !isEncryptionKey(key) &&
            key !== SETTINGS_MIGRATED_KEY) {
            // 定数名を設定キー名に変換
            // const settingKey = Object.keys(StorageKeys).find(k => StorageKeys[k as keyof typeof StorageKeys] === key);
            // if (settingKey) {
            // 既存のキー名（レガシー）をそのまま使用
            settings[key] = value;
            // }
        }
    }
    // settingsオブジェクトが空であれば、デフォルト設定で初期化
    if (Object.keys(settings).length === 0) {
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
            settings[key] = value;
        }
    }
    // 楽観的ロックで安全に保存
    await withOptimisticLock('settings', (currentSettings) => {
        return { ...currentSettings, ...settings };
    });
    // マイグレーション完了フラグを設定
    await chrome.storage.local.set({ [SETTINGS_MIGRATED_KEY]: true });
    // 古い個別キーを削除
    const keysToRemove = Object.keys(existingKeys).filter(key => Object.values(StorageKeys).includes(key) &&
        !key.includes('_version') &&
        !isEncryptionKey(key) &&
        key !== SETTINGS_MIGRATED_KEY);
    if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
    }
    return true;
}
export async function getSettings() {
    // 単一settingsオブジェクトが存在する場合はそれを使用
    const result = await chrome.storage.local.get(['settings', SETTINGS_MIGRATED_KEY]);
    const rawSettings = result.settings;
    console.log('[Storage] Raw storage result:', {
        hasSettings: !!rawSettings,
        hasMigratedKey: !!result[SETTINGS_MIGRATED_KEY],
        obsidianKeyInSettings: rawSettings ? StorageKeys.OBSIDIAN_API_KEY in rawSettings : false,
        obsidianKeyValue: rawSettings?.[StorageKeys.OBSIDIAN_API_KEY],
        obsidianKeyType: typeof rawSettings?.[StorageKeys.OBSIDIAN_API_KEY],
        isEncryptedCheck: rawSettings?.[StorageKeys.OBSIDIAN_API_KEY] ? isEncrypted(rawSettings[StorageKeys.OBSIDIAN_API_KEY]) : false
    });
    if (result.settings && result[SETTINGS_MIGRATED_KEY]) {
        let settings = result.settings;
        // StorageKeysに含まれないキー（ゴミデータ）を排除
        const validStorageKeys = Object.values(StorageKeys);
        const filteredSettings = {};
        for (const [key, value] of Object.entries(settings)) {
            if (validStorageKeys.includes(key)) {
                filteredSettings[key] = value;
            }
        }
        const merged = { ...DEFAULT_SETTINGS, ...filteredSettings };
        // 暗号化されたAPIキーを復号
        try {
            const key = await getOrCreateEncryptionKey();
            for (const field of API_KEY_FIELDS) {
                const value = merged[field];
                if (isEncrypted(value)) {
                    try {
                        merged[field] = await decryptApiKey(value, key);
                    }
                    catch (e) {
                        console.error(`Failed to decrypt ${field}:`, e);
                        merged[field] = '';
                    }
                }
            }
        }
        catch (e) {
            console.error('Failed to get encryption key for decryption:', e);
        }
        return merged;
    }
    // 旧方式: StorageKeysで定義されているキーのみを取得
    const keysToGet = Object.values(StorageKeys);
    let settings = await chrome.storage.local.get(keysToGet);
    const migrated = await migrateUblockSettings();
    if (migrated) {
        // マイグレーション後は同じキーで再取得
        const afterMigration = await chrome.storage.local.get(keysToGet);
        settings = { ...settings, ...afterMigration }; // マイグレーション後の値をマージ
        // addLog(LogType.DEBUG, 'Settings migration completed', { migrated, keysUpdated: Object.keys(afterMigration) });
    }
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    // 暗号化されたAPIキーを復号
    try {
        const key = await getOrCreateEncryptionKey();
        for (const field of API_KEY_FIELDS) {
            const value = merged[field];
            if (isEncrypted(value)) {
                try {
                    merged[field] = await decryptApiKey(value, key);
                }
                catch (e) {
                    console.error(`Failed to decrypt ${field}:`, e);
                    merged[field] = '';
                }
            }
        }
    }
    catch (e) {
        console.error('Failed to get encryption key for decryption:', e);
    }
    return merged;
}
/**
 * Save settings to chrome.storage.local with optional allowed URL list update.
 *
 * @param {Settings} settings - Settings to save
 * @param {boolean} updateAllowedUrlsFlag - Whether to update the allowed URL list (default: false)
 */
export async function saveSettings(settings, updateAllowedUrlsFlag = false) {
    let toSave = { ...settings };
    // APIキーフィールドを暗号化
    try {
        const key = await getOrCreateEncryptionKey();
        for (const field of API_KEY_FIELDS) {
            if (field in toSave && typeof toSave[field] === 'string' && toSave[field] !== '') {
                const originalValue = toSave[field];
                toSave[field] = await encryptApiKey(toSave[field], key);
                console.log(`Encrypted ${field}:`, {
                    hadValue: !!originalValue,
                    originalLength: originalValue.length,
                    encrypted: !!toSave[field]
                });
            }
        }
    }
    catch (e) {
        console.error('Failed to encrypt API keys:', e);
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
    // 楽観的ロックを使用して同時実行時の競合を防止
    await withOptimisticLock('settings', (currentSettings) => {
        return { ...currentSettings, ...toSave };
    });
}
// URL set size limit constants
export const MAX_URL_SET_SIZE = 10000;
export const URL_WARNING_THRESHOLD = 8000;
/**
 * Get the list of saved URLs with LRU eviction
 * @returns {Promise<Set<string>>} Set of saved URLs
 */
export async function getSavedUrls() {
    const result = await chrome.storage.local.get('savedUrls');
    return new Set(result.savedUrls || []);
}
/**
 * Get the detailed URL entries with timestamps
 * @returns {Promise<Map<string, number>>} Map of URLs to timestamps
 */
export async function getSavedUrlsWithTimestamps() {
    const result = await chrome.storage.local.get('savedUrlsWithTimestamps');
    const entries = result.savedUrlsWithTimestamps || [];
    const urlMap = new Map();
    for (const entry of entries) {
        urlMap.set(entry.url, entry.timestamp);
    }
    return urlMap;
}
/**
 * Save the list of URLs with LRU eviction
 * @param {Set<string>} urlSet - Set of URLs to save
 * @param {string} [urlToAdd] - URL to add/update with current timestamp（オプション）
 */
export async function setSavedUrls(urlSet, urlToAdd = null) {
    const urlArray = Array.from(urlSet);
    // 楽観的ロックで安全に保存
    await withOptimisticLock('savedUrls', () => urlArray, { maxRetries: 5 });
    // LRUタイムスタンプを管理
    if (urlToAdd) {
        await updateUrlTimestamp(urlToAdd);
    }
}
/**
 * Update URL timestamp for LRU tracking
 * @param {string} url - URL to update
 */
async function updateUrlTimestamp(url) {
    const result = await chrome.storage.local.get('savedUrlsWithTimestamps');
    let entries = result.savedUrlsWithTimestamps || [];
    // 既存のURLがある場合は削除
    entries = entries.filter(entry => entry.url !== url);
    // 新しいエントリを追加
    entries.push({ url, timestamp: Date.now() });
    // MAX_URL_SET_SIZEを超えたら古いURLを削除
    if (entries.length > MAX_URL_SET_SIZE) {
        // タイムスタンプでソートして古いものを削除
        entries.sort((a, b) => a.timestamp - b.timestamp);
        entries = entries.slice(entries.length - MAX_URL_SET_SIZE);
    }
    await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });
}
/**
 * Save the URL Map with timestamps (日付ベース重複チェック用)
 * @param {Map<string, number>} urlMap - Map of URLs to timestamps
 * @param {string} [urlToAdd] - URL to add/update with current timestamp（オプション）
 */
export async function setSavedUrlsWithTimestamps(urlMap, urlToAdd = null) {
    // Map to entries array
    const entries = Array.from(urlMap.entries()).map(([url, timestamp]) => ({ url, timestamp }));
    // 楽観的ロックで安全に保存
    await withOptimisticLock('savedUrlsWithTimestamps', () => entries, { maxRetries: 5 });
    // 同時に savedUrls Setも更新（互換性維持）
    const urlSet = new Set(urlMap.keys());
    const urlArray = Array.from(urlSet);
    await withOptimisticLock('savedUrls', () => urlArray, { maxRetries: 5 });
}
/**
 * Add a URL to the saved list with LRU tracking (日付ベース対応)
 * @param {string} url - URL to add
 */
export async function addSavedUrl(url) {
    const urlMap = await getSavedUrlsWithTimestamps();
    urlMap.set(url, Date.now());
    await setSavedUrlsWithTimestamps(urlMap, url);
}
/**
 * Remove a URL from the saved list
 * @param {string} url - URL to remove
 */
export async function removeSavedUrl(url) {
    // 楽観的ロックで安全に削除
    await withOptimisticLock('savedUrls', (currentUrls) => {
        const urlSet = new Set(currentUrls || []);
        urlSet.delete(url);
        return Array.from(urlSet);
    }, { maxRetries: 5 });
    // タムスタンプ管理からも削除
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries) => {
        const entries = currentEntries || [];
        return entries.filter(entry => entry.url !== url);
    }, { maxRetries: 5 });
}
/**
 * Check if URL is in the saved list
 * @param {string} url - URL to check
 * @returns {Promise<boolean>} True if URL is saved
 */
export async function isUrlSaved(url) {
    const currentUrls = await getSavedUrls();
    return currentUrls.has(url);
}
/**
 * Get the count of saved URLs
 * @returns {Promise<number>} Number of saved URLs
 */
export async function getSavedUrlCount() {
    const currentUrls = await getSavedUrls();
    return currentUrls.size;
}
/**
 * 設定から許可されたURLのリストを構築
 * @param {object} settings - 設定オブジェクト
 * @returns {Set<string>} 許可されたURLのセット
 */
export function buildAllowedUrls(settings) {
    const allowedUrls = new Set();
    // Obsidian API
    const protocol = settings[StorageKeys.OBSIDIAN_PROTOCOL] || 'http';
    const port = settings[StorageKeys.OBSIDIAN_PORT] || '27123';
    allowedUrls.add(normalizeUrl(`${protocol}://127.0.0.1:${port}`));
    allowedUrls.add(normalizeUrl(`${protocol}://localhost:${port}`));
    // Gemini API
    allowedUrls.add('https://generativelanguage.googleapis.com');
    // OpenAI互換API - ホワイトリストチェック
    const openaiBaseUrl = settings[StorageKeys.OPENAI_BASE_URL];
    if (openaiBaseUrl) {
        if (isDomainInWhitelist(openaiBaseUrl)) {
            const normalized = normalizeUrl(openaiBaseUrl);
            allowedUrls.add(normalized);
        }
        else {
            console.warn(`OpenAI Base URL not in whitelist, skipped: ${openaiBaseUrl}`);
        }
    }
    const openai2BaseUrl = settings[StorageKeys.OPENAI_2_BASE_URL];
    if (openai2BaseUrl) {
        if (isDomainInWhitelist(openai2BaseUrl)) {
            const normalized = normalizeUrl(openai2BaseUrl);
            allowedUrls.add(normalized);
        }
        else {
            console.warn(`OpenAI 2 Base URL not in whitelist, skipped: ${openai2BaseUrl}`);
        }
    }
    // uBlock Filter Sources - 既存のソース
    const ublockSources = settings[StorageKeys.UBLOCK_SOURCES] || [];
    for (const source of ublockSources) {
        if (source.url && source.url !== 'manual') {
            try {
                const parsed = new URL(source.url);
                allowedUrls.add(normalizeUrl(parsed.origin));
            }
            catch (e) {
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
export function computeUrlsHash(urls) {
    const sortedUrls = Array.from(urls).sort();
    return sortedUrls.join('|');
}
/**
 * 設定を保存し、許可されたURLのリストを再構築
 * @param {Settings} settings - 設定オブジェクト
 */
export async function saveSettingsWithAllowedUrls(settings) {
    // 改訂: saveSettings を使用して常に暗号化とURLリスト更新を行う
    await saveSettings(settings, true);
}
/**
 * 許可されたURLのリストを取得
 * @returns {Promise<Set<string>>} 許可されたURLのセット
 */
export async function getAllowedUrls() {
    const result = await chrome.storage.local.get(StorageKeys.ALLOWED_URLS);
    const urls = result[StorageKeys.ALLOWED_URLS] || [];
    return new Set(urls);
}
/**
 * 楽観的ロック用のバージョンフィールドを初期化（移行用）
 *
 * 新規インストールまたは既存データにバージョンフィールドがない場合に初期化します。
 * この関数はアプリ起動時に呼び出されることを想定しています。
 *
 * @returns {Promise<void>}
 */
export async function ensureUrlVersionInitialized() {
    await ensureVersionInitialized('savedUrls');
    await ensureVersionInitialized('savedUrlsWithTimestamps');
}
//# sourceMappingURL=storage.js.map