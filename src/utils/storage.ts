/**
 * storage.ts
 * Wrapper for chrome.storage.local to manage settings.
 */

// Temporarily disabled to resolve circular dependency
// import { addLog, LogType } from './logger.js';
import { migrateUblockSettings } from './migration.js';
import type { EncryptedData } from './typesCrypto.js';
import {
    generateSalt,
    deriveKeyWithExtensionId,
    encryptApiKey,
    decryptApiKey,
    isEncrypted,
    hashPasswordWithPBKDF2,
    verifyPasswordWithPBKDF2
} from './crypto.js';
import { withOptimisticLock, ensureVersionInitialized } from './optimisticLock.js';
import { normalizeUrl } from './urlUtils.js';
import type { UblockRules, Source, CustomPrompt } from './types.js';

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
    PRIVACY_MODE: 'privacy_mode',           // 'local_only' | 'full_pipeline' | 'masked_cloud' | 'cloud_only'
    PII_CONFIRMATION_UI: 'pii_confirmation_ui', // true | false
    PII_SANITIZE_LOGS: 'pii_sanitize_logs',  // true | false
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
    MP_ENCRYPT_ON_EXPORT: 'mp_encrypt_on_export',       // エクスポート時暗号化フラグ
    MP_REQUIRE_ON_IMPORT: 'mp_require_on_import',       // イポート時パスワード要求フラグ
    // Version tracking for optimistic locking
    SAVED_URLS_VERSION: 'savedUrls_version', // savedUrlsのバージョン番号
    // Custom prompts
    CUSTOM_PROMPTS: 'custom_prompts', // カスタムプロンプト設定
    // Domain filter cache for content scripts (Task #19)
    DOMAIN_FILTER_CACHE: 'domain_filter_cache', // 許可ドメインキャッシュ（content script用）
    DOMAIN_FILTER_CACHE_TIMESTAMP: 'domain_filter_cache_timestamp' // キャッシュタイムスタンプ
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
    [StorageKeys.DOMAIN_WHITELIST]: string[];
    [StorageKeys.DOMAIN_BLACKLIST]: string[];
    [StorageKeys.DOMAIN_FILTER_MODE]: string;
    [StorageKeys.PRIVACY_MODE]: string;
    [StorageKeys.PII_CONFIRMATION_UI]: boolean;
    [StorageKeys.PII_SANITIZE_LOGS]: boolean;
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
    [StorageKeys.DOMAIN_FILTER_CACHE]: string[];  // 許可ドメインリスト（キャッシュ）
    [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: number;  // キャッシュタイムスタンプ
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

// 暗号化対象のAPIキーフィールド
const API_KEY_FIELDS: StorageKey[] = [
    StorageKeys.OBSIDIAN_API_KEY,
    StorageKeys.GEMINI_API_KEY,
    StorageKeys.OPENAI_API_KEY,
    StorageKeys.OPENAI_2_API_KEY
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
    } catch (e) {
        return false;
    }
}

// メモリキャッシュ
let cachedEncryptionKey: CryptoKey | null = null;
let cachedExtensionId: string | null = null;
let cachedSettings: { data: Settings | null; timestamp: number } | null = null;
let cachedMasterPassword: string | null = null; // セッション中のマスターパスワードキャッシュ
let cachedServerKey: CryptoKey | null = null; // 【マイグレーション用】サーバーサイド保存のキー
const SETTINGS_CACHE_TTL = 1000; // 1秒間キャッシュ（record()内の重複呼び出し防止）

// 【セキュリティ修正】マスターパスワード設定状態を追跡
let isMasterPasswordRequired = false; // マスターパスワードが設定済みかどうか

/**
 * 暗号化キーを取得または作成する
 *
 * 【セキュリティ修正】マスターパスワードが設定されている場合、マスターパスワードからキーを導出
 * マスターパスワード未設定の場合は従来の方式でマイグレーション準備
 *
 * @returns {Promise<CryptoKey>} 導出された暗号化キー
 * @throws {Error} ロックされている場合（マスターパスワード未入力）
 */
export async function getOrCreateEncryptionKey(): Promise<CryptoKey> {
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

    // マスターパスワード設定状態を確認
    const result = await chrome.storage.local.get([
        StorageKeys.MASTER_PASSWORD_ENABLED,
        StorageKeys.ENCRYPTION_SALT,
        StorageKeys.ENCRYPTION_SECRET,
        StorageKeys.MASTER_PASSWORD_SALT,
        StorageKeys.IS_LOCKED
    ]);

    const masterPasswordEnabled = result[StorageKeys.MASTER_PASSWORD_ENABLED] as boolean;
    const isLocked = result[StorageKeys.IS_LOCKED] as boolean;

    if (masterPasswordEnabled) {
        // 【セキュリティ修正】マスターパスワードが設定されている場合は強制的にロック
        isMasterPasswordRequired = true;

        if (!cachedMasterPassword) {
            throw new Error('ENCRYPTION_LOCKED: Master password required');
        }

        // マスターパスワードからキーを導出
        const passwordSaltBase64 = result[StorageKeys.MASTER_PASSWORD_SALT] as string;
        if (!passwordSaltBase64) {
            throw new Error('CORRUPTION: Master password salt missing');
        }

        const passwordSalt = base64ToUint8Array(passwordSaltBase64);
        // PBKDF2キー導出を直接使用（マスターパスワードベース）
        cachedEncryptionKey = await deriveKeyFromPassword(cachedMasterPassword, passwordSalt);
        return cachedEncryptionKey;
    }

    // マスターパスワード未設定の場合：従来の方式を使用（マイグレーション準備）
    // 注意：この方式は脆弱だが、マイグレーション完了まで維持
    let saltBase64 = result[StorageKeys.ENCRYPTION_SALT] as string;
    let secret = result[StorageKeys.ENCRYPTION_SECRET] as string;

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

    const salt = base64ToUint8Array(saltBase64);

    // 【脆弱な方式】Extension IDを使用してキー導出
    // マスターパスワード設定後に再暗号化が必要
    cachedEncryptionKey = await deriveKeyWithExtensionId(secret, salt, extensionId);
    return cachedEncryptionKey;
}

/**
 * Base64文字列をUint8Arrayに変換するヘルパー関数
 */
function base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

/**
 * パスワードから暗号化キーを導出する（PBKDF2、extensionIdなし）
 * マスターパスワード方式専用
 */
async function deriveKeyFromPassword(password: string, salt: Uint8Array): Promise<CryptoKey> {
    const webcrypto = global.crypto || crypto;
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);

    const baseKey = await webcrypto.subtle.importKey(
        'raw',
        passwordBuffer,
        'PBKDF2',
        false,
        ['deriveKey']
    );

    const derivedKey = await webcrypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt as BufferSource,
            iterations: 100000,
            hash: 'SHA-256'
        },
        baseKey,
        {
            name: 'AES-GCM',
            length: 256
        },
        false,
        ['encrypt', 'decrypt']
    );

    return derivedKey;
}

/**
 * マスターパスワードが設定されているか確認
 * @returns {Promise<boolean>} マスターパスワードが設定済みの場合true
 */
export async function isMasterPasswordEnabled(): Promise<boolean> {
    const result = await chrome.storage.local.get(StorageKeys.MASTER_PASSWORD_ENABLED);
    return Boolean(result[StorageKeys.MASTER_PASSWORD_ENABLED]);
}

/**
 * 暗号化がロックされているか確認（マスターパスワード未入力）
 * @returns {Promise<boolean>} ロックされている場合true
 */
export async function isEncryptionLocked(): Promise<boolean> {
    const enabled = await isMasterPasswordEnabled();
    return isMasterPasswordRequired && enabled && !cachedMasterPassword;
}

/**
 * マスターパスワードを設定する
 * @param {string} password - マスターパスワード
 * @returns {Promise<boolean>} 成功した場合true
 */
export async function setMasterPassword(password: string): Promise<boolean> {
    if (!password || password.length < 8) {
        throw new Error('Password must be at least 8 characters');
    }

    const salt = generateSalt();
    const saltBase64 = btoa(String.fromCharCode(...salt));
    const hash = await hashPasswordWithPBKDF2(password, salt);

    await chrome.storage.local.set({
        [StorageKeys.MASTER_PASSWORD_ENABLED]: true,
        [StorageKeys.MASTER_PASSWORD_SALT]: saltBase64,
        [StorageKeys.MASTER_PASSWORD_HASH]: hash,
        [StorageKeys.IS_LOCKED]: true // 初期状態でロック（アンロック必要）
    });

    // 【セキュリティ修正】設定時はパスワードキャッシュをクリア（ロック状態で開始）
    cachedMasterPassword = null;
    isMasterPasswordRequired = true;

    // キャッシュをクリア
    cachedEncryptionKey = null;

    return true;
}

/**
 * マスターパスワードを検証し、セッションをアンロックする
 * @param {string} password - マスターパスワード
 * @returns {Promise<boolean>} 成功した場合true
 */
export async function unlockWithPassword(password: string): Promise<boolean> {
    const result = await chrome.storage.local.get([
        StorageKeys.MASTER_PASSWORD_HASH,
        StorageKeys.MASTER_PASSWORD_SALT,
        StorageKeys.MASTER_PASSWORD_ENABLED
    ]);

    const enabled = result[StorageKeys.MASTER_PASSWORD_ENABLED] as boolean;
    if (!enabled) {
        throw new Error('Master password not enabled');
    }

    const storedHash = result[StorageKeys.MASTER_PASSWORD_HASH] as string;
    const saltBase64 = result[StorageKeys.MASTER_PASSWORD_SALT] as string;

    if (!storedHash || !saltBase64) {
        throw new Error('Master password data corrupted');
    }

    const salt = base64ToUint8Array(saltBase64);
    const isValid = await verifyPasswordWithPBKDF2(password, storedHash, salt);

    if (isValid) {
        cachedMasterPassword = password;
        cachedEncryptionKey = null; // 新しいキーを生成するためにキャッシュをクリア
        await chrome.storage.local.set({ [StorageKeys.IS_LOCKED]: false });
        return true;
    }

    return false;
}

/**
 * セッションをロックする（マスターパスワードキャッシュをクリア）
 */
export function lockSession(): void {
    cachedMasterPassword = null;
    cachedEncryptionKey = null;
    chrome.storage.local.set({ [StorageKeys.IS_LOCKED]: true });
}

/** * マスターパスワードを再設定する（古いパスワード検証後）
 * @param {string} oldPassword - 現在のマスターパスワード
 * @param {string} newPassword - 新しいマスターパスワード
 * @returns {Promise<boolean>} 成功した場合true
 */
export async function changeMasterPassword(oldPassword: string, newPassword: string): Promise<boolean> {
    // まず古いパスワードでアンロック試行
    const isValid = await unlockWithPassword(oldPassword);
    if (!isValid) {
        return false;
    }

    // 新しいパスワードを設定（ロック状態になる）
    await setMasterPassword(newPassword);

    // 新しいパスワードでアンロックしてセッションを維持
    return unlockWithPassword(newPassword);
}

/**
 * マスターパスワード設定を解除する（すべての暗号化データを再暗号化できないため注意が必要）
 */
export async function removeMasterPassword(): Promise<void> {
    await chrome.storage.local.remove([
        StorageKeys.MASTER_PASSWORD_ENABLED,
        StorageKeys.MASTER_PASSWORD_SALT,
        StorageKeys.MASTER_PASSWORD_HASH,
        StorageKeys.IS_LOCKED
    ]);

    cachedMasterPassword = null;
    isMasterPasswordRequired = false;
    cachedEncryptionKey = null;
}

/**
 * 暗号化キーのキャッシュをクリアする（テスト用）
 */
export function clearEncryptionKeyCache(): void {
    cachedEncryptionKey = null;
    cachedMasterPassword = null;
}

// HMAC Secret用キャッシュ
let cachedHmacSecret: string | null = null;

/**
 * HMAC Secretを取得または作成する
 * @returns {Promise<string>} HMACシークレット
 */
export async function getOrCreateHmacSecret(): Promise<string> {
    if (cachedHmacSecret) {
        return cachedHmacSecret;
    }

    const result = await chrome.storage.local.get(StorageKeys.HMAC_SECRET);
    let secret = result[StorageKeys.HMAC_SECRET] as string;

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

const DEFAULT_SETTINGS: Settings = {
    [StorageKeys.OBSIDIAN_API_KEY]: '', // APIキー（ユーザーが設定）
    [StorageKeys.OBSIDIAN_PROTOCOL]: 'http', // Default HTTP for Local REST API
    [StorageKeys.OBSIDIAN_PORT]: '27124',
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
        const validStorageKeys: string[] = Object.values(StorageKeys);
        const filteredSettings: Settings = {};
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
                        const decryptedValue = await decryptApiKey(value, key);
                        (merged as Record<StorageKey, StorageKeyValues[StorageKey]>)[field] = decryptedValue as StorageKeyValues[StorageKey];
                    } catch (e) {
                        console.error(`Failed to decrypt ${field}:`, e);
                        (merged as Record<StorageKey, StorageKeyValues[StorageKey]>)[field] = '' as StorageKeyValues[StorageKey];
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
    const keysToGet: string[] = Object.values(StorageKeys);
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
                    const decryptedValue = await decryptApiKey(value, key);
                    (merged as Record<StorageKey, StorageKeyValues[StorageKey]>)[field] = decryptedValue as StorageKeyValues[StorageKey];
                } catch (e) {
                    console.error(`Failed to decrypt ${field}:`, e);
                    (merged as Record<StorageKey, StorageKeyValues[StorageKey]>)[field] = '' as StorageKeyValues[StorageKey];
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
 * 【パフォーマンス改善】設定キャッシュをクリアする（テスト用）
 * ストレージから完全に再読み込みする場合に使用
 */
export function clearSettingsCache(): void {
    cachedSettings = null;
}

/**
 * Save settings to chrome.storage.local with optional allowed URL list update.
 *
 * @param {Settings} settings - Settings to save
 * @param {boolean} updateAllowedUrlsFlag - Whether to update the allowed URL list (default: false)
 */
export async function saveSettings(settings: Settings, updateAllowedUrlsFlag: boolean = false): Promise<void> {
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
    await withOptimisticLock('settings', (currentSettings: Settings) => {
        return { ...currentSettings, ...toSave };
    });
}


// URL set size limit constants
export const MAX_URL_SET_SIZE = 10000;
export const URL_WARNING_THRESHOLD = 8000;
export const URL_RETENTION_DAYS = 7;

export interface SavedUrlEntry {
    url: string;
    timestamp: number;
}

/**
 * Get the list of saved URLs with LRU eviction
 * @returns {Promise<Set<string>>} Set of saved URLs
 */
export async function getSavedUrls(): Promise<Set<string>> {
    const result = await chrome.storage.local.get('savedUrls');
    return new Set((result.savedUrls as string[]) || []);
}

/**
 * Get the detailed URL entries with timestamps
 * @returns {Promise<Map<string, number>>} Map of URLs to timestamps
 */
export async function getSavedUrlsWithTimestamps(): Promise<Map<string, number>> {
    const result = await chrome.storage.local.get('savedUrlsWithTimestamps');
    const entries = (result.savedUrlsWithTimestamps as SavedUrlEntry[]) || [];
    const urlMap = new Map<string, number>();
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
export async function setSavedUrls(urlSet: Set<string>, urlToAdd: string | null = null): Promise<void> {
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
async function updateUrlTimestamp(url: string): Promise<void> {
    const result = await chrome.storage.local.get('savedUrlsWithTimestamps');
    let entries = (result.savedUrlsWithTimestamps as SavedUrlEntry[]) || [];

    // 既存のURLがある場合は削除
    entries = entries.filter(entry => entry.url !== url);

    // 新しいエントリを追加
    entries.push({ url, timestamp: Date.now() });

    // 7日より古いエントリを削除（日数ベース）
    const cutoff = Date.now() - URL_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    entries = entries.filter(entry => entry.timestamp >= cutoff);

    // それでもMAX_URL_SET_SIZEを超える場合は古い順にLRU削除
    if (entries.length > MAX_URL_SET_SIZE) {
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
export async function setSavedUrlsWithTimestamps(urlMap: Map<string, number>, urlToAdd: string | null = null): Promise<void> {
    // Map to entries array
    const entries = Array.from(urlMap.entries()).map(([url, timestamp]) => ({ url, timestamp }));
    const urlArray = Array.from(urlMap.keys());

    // savedUrlsWithTimestampsの楽観的ロックを使用
    await withOptimisticLock('savedUrlsWithTimestamps', () => entries, { maxRetries: 5 });

    // savedUrlsがsavedUrlsWithTimestampsと同期されていない場合は個別に更新
    // (互換性維持のため、savedUrlsも保存する)
    // Note: これは競合の可能性がありますが、savedUrlsはsavedUrlsWithTimestampsから再生成可能です
    const currentSavedUrls = await chrome.storage.local.get('savedUrls');
    const currentSavedArray = currentSavedUrls['savedUrls'] as string[] || [];

    // 配列が同じならスキップ
    if (JSON.stringify(currentSavedArray.sort()) !== JSON.stringify(urlArray.sort())) {
        await chrome.storage.local.set({ savedUrls: urlArray });
    }
}

/**
 * Add a URL to the saved list with LRU tracking (日付ベース対応)
 * @param {string} url - URL to add
 */
export async function addSavedUrl(url: string): Promise<void> {
    const urlMap = await getSavedUrlsWithTimestamps();
    urlMap.set(url, Date.now());
    await setSavedUrlsWithTimestamps(urlMap, url);
}

/**
 * Remove a URL from the saved list
 * @param {string} url - URL to remove
 */
export async function removeSavedUrl(url: string): Promise<void> {
    // 楽観的ロックで安全に削除
    await withOptimisticLock('savedUrls', (currentUrls: string[]) => {
        const urlSet = new Set(currentUrls || []);
        urlSet.delete(url);
        return Array.from(urlSet);
    }, { maxRetries: 5 });

    // タムスタンプ管理からも削除
    await withOptimisticLock('savedUrlsWithTimestamps', (currentEntries: SavedUrlEntry[]) => {
        const entries = currentEntries || [];
        return entries.filter(entry => entry.url !== url);
    }, { maxRetries: 5 });
}

/**
 * Check if URL is in the saved list
 * @param {string} url - URL to check
 * @returns {Promise<boolean>} True if URL is saved
 */
export async function isUrlSaved(url: string): Promise<boolean> {
    const currentUrls = await getSavedUrls();
    return currentUrls.has(url);
}

/**
 * Get the count of saved URLs
 * @returns {Promise<number>} Number of saved URLs
 */
export async function getSavedUrlCount(): Promise<number> {
    const currentUrls = await getSavedUrls();
    return currentUrls.size;
}

/**
 * 設定から許可されたURLのリストを構築
 * @param {object} settings - 設定オブジェクト
 * @returns {Set<string>} 許可されたURLのセット
 */
export function buildAllowedUrls(settings: Settings): Set<string> {
    const allowedUrls = new Set<string>();

    // Obsidian API
    const protocol = settings[StorageKeys.OBSIDIAN_PROTOCOL] || 'http';
    const port = settings[StorageKeys.OBSIDIAN_PORT] || '27124';
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
        } else {
            console.warn(`OpenAI Base URL not in whitelist, skipped: ${openaiBaseUrl}`);
        }
    }

    const openai2BaseUrl = settings[StorageKeys.OPENAI_2_BASE_URL];
    if (openai2BaseUrl) {
        if (isDomainInWhitelist(openai2BaseUrl)) {
            const normalized = normalizeUrl(openai2BaseUrl);
            allowedUrls.add(normalized);
        } else {
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
            } catch (e) {
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

/**
 * 楽観的ロック用のバージョンフィールドを初期化（移行用）
 *
 * 新規インストールまたは既存データにバージョンフィールドがない場合に初期化します。
 * この関数はアプリ起動時に呼び出されることを想定しています。
 *
 * @returns {Promise<void>}
 */
export async function ensureUrlVersionInitialized(): Promise<void> {
    await ensureVersionInitialized('savedUrls');
    await ensureVersionInitialized('savedUrlsWithTimestamps');
}

// ============================================================================
// Domain Filter Cache for Content Scripts (Task #19)
// ============================================================================

/**
 * ドメインフィルタキャッシュの有効期限（ミリ秒）
 * Content Script内で使用するため、メッセージ通信を減らす目的
 */
const DOMAIN_FILTER_CACHE_TTL = 5 * 60 * 1000; // 5分

/**
 * [同期] ドメインフィルタキャッシュを取得
 * Content Scriptから直接呼び出すため、ストレージに同期的アクセスはできませんが
 * chrome.storage.local.get はコールバックで即時取得可能
 * この関数は Content Script で使用します
 *
 * @param {function} callback - キャッシュデータを受け取るコールバック関数
 */
export function getDomainFilterCacheSync(callback: (data: { allowedDomains: string[]; blockedDomains: string[]; cachedAt: number; mode: string }) => void): void {
    chrome.storage.local.get([
        StorageKeys.DOMAIN_FILTER_CACHE,
        StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP,
        StorageKeys.DOMAIN_FILTER_MODE
    ], (result) => {
        const allowedDomains = (result[StorageKeys.DOMAIN_FILTER_CACHE] as string[]) || [];
        const cachedAt = (result[StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP] as number) || 0;
        const mode = (result[StorageKeys.DOMAIN_FILTER_MODE] as string) || 'disabled';

        // ブロックドメインは設定に基づいて動的に算出（シンプル形式のみ）
        // uBlockフォーマットは複雑なため、バックグラウンドでのチェックが必要
        const blockedDomains: string[] = [];

        callback({ allowedDomains, blockedDomains, cachedAt, mode });
    });
}

/**
 * ドメインフィルタキャッシュが有効かどうかを判定
 * @param {number} cachedAt - キャッシュ作成時のタイムスタンプ
 * @returns {boolean} 有効な場合true
 */
export function isDomainFilterCacheValid(cachedAt: number): boolean {
    const now = Date.now();
    return (now - cachedAt) < DOMAIN_FILTER_CACHE_TTL && cachedAt > 0;
}

/**
 * ドメインからパスとクエリを削除して正規化
 * @param {string} url - 正規化対象のURL
 * @returns {string | null} 正規化されたURL（失敗時はnull）
 */
export function normalizeDomainUrl(url: string): string | null {
    try {
        const urlObj = new URL(url);
        let hostname = urlObj.hostname;

        // www. プレフィックスを削除（ドメインマッチングの一貫性）
        if (hostname.startsWith('www.')) {
            hostname = hostname.substring(4);
        }

        return hostname;
    } catch (e) {
        return null;
    }
}

/**
 * パターンマッチング（ワイルドカード対応）
 * Content Scriptで使用するため、パッケージ化
 * @param {string} domain - チェック対象のドメイン
 * @param {string} pattern - パターン（*を含む場合あり）
 * @returns {boolean} 一致する場合true
 */
export function matchesWildcardPattern(domain: string, pattern: string): boolean {
    if (pattern.includes('*')) {
        // ワイルドカードパターンを正規表現に変換
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regexPattern = escaped.replace(/\\\*/g, '.*');
        const regex = new RegExp(`^${regexPattern}$`, 'i');
        return regex.test(domain);
    }
    // 完全一致（大文字小文字区別なし）
    return domain.toLowerCase() === pattern.toLowerCase();
}

/**
 * バックグラウンドスクリプトでドメインフィルタキャッシュを更新
 * @param {Settings} settings - 設定オブジェクト
 */
export async function updateDomainFilterCache(settings: Settings): Promise<void> {
    const mode = settings[StorageKeys.DOMAIN_FILTER_MODE];
    const now = Date.now();

    // モードに応じてキャッシュするドメインを計算
    let cachedDomains: string[] = [];

    if (mode === 'whitelist') {
        const whitelist = (settings[StorageKeys.DOMAIN_WHITELIST] as string[]) || [];
        const simpleEnabled = settings[StorageKeys.SIMPLE_FORMAT_ENABLED] !== false;
        if (simpleEnabled) {
            cachedDomains = whitelist;
        }
        // uBlockフォーマットの算出は複雑で、ここでは単純なシンプル形式のみキャッシュ
    } else if (mode === 'blacklist') {
        const blacklist = (settings[StorageKeys.DOMAIN_BLACKLIST] as string[]) || [];
        const simpleEnabled = settings[StorageKeys.SIMPLE_FORMAT_ENABLED] !== false;
        if (simpleEnabled) {
            // ブラックリストモードでは「許可ドメイン」キャッシュは空
            // 代わりに「ブロックドメイン」をキャッシュ
            // 実装: 別途ブロックドメインキャッシュが必要だが、TTL短縮で対応
            cachedDomains = [];
        }
    }

    await chrome.storage.local.set({
        [StorageKeys.DOMAIN_FILTER_CACHE]: cachedDomains,
        [StorageKeys.DOMAIN_FILTER_CACHE_TIMESTAMP]: now
    });
}
