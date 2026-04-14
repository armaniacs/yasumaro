/**
 * storage内部共有ステート
 * 暗号化キー・設定キャッシュ等のモジュール間で共有されるミュータブルステート
 */

// 暗号化キーキャッシュ
export let cachedEncryptionKey: CryptoKey | null = null;
export let cachedExtensionId: string | null = null;
export let cachedServerKey: CryptoKey | null = null;

// マスターパスワードキャッシュ
export let cachedMasterPassword: string | null = null;

// マスターパスワード設定状態
export let isMasterPasswordRequired = false;

// 設定キャッシュ
export let cachedSettings: { data: import('./types.js').Settings | null; timestamp: number } | null = null;
export const SETTINGS_CACHE_TTL = 1000; // 1秒間キャッシュ（record()内の重複呼び出し防止）

// HMAC Secret用キャッシュ
export let cachedHmacSecret: string | null = null;

// ストレージクォータ
export const STORAGE_QUOTA_BYTES = 5 * 1024 * 1024; // 5MB (Chrome拡張機能のデフォルト)

// セッター関数（ミュータブルステートの更新用）
export function setCachedEncryptionKey(key: CryptoKey | null): void { cachedEncryptionKey = key; }
export function setCachedExtensionId(id: string | null): void { cachedExtensionId = id; }
export function setCachedMasterPassword(password: string | null): void { cachedMasterPassword = password; }
export function setCachedSettings(settings: { data: import('./types.js').Settings | null; timestamp: number } | null): void { cachedSettings = settings; }
export function setCachedHmacSecret(secret: string | null): void { cachedHmacSecret = secret; }
export function setIsMasterPasswordRequired(required: boolean): void { isMasterPasswordRequired = required; }