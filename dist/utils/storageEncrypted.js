/**
 * storageEncrypted.ts
 * 暗号化ストレージ関連の機能
 * 暗号化キー管理、キャッシュ、HMAC Secret管理
 */
import { deriveKeyWithExtensionId } from './crypto.js';
// 暗号化キー用キャッシュ
let cachedEncryptionKey = null;
let cachedExtensionId = null;
// HMAC Secret用キャッシュ
let cachedHmacSecret = null;
/**
 * 暗号化キーを取得または作成する
 * ソルト/シークレットが無ければ自動生成してストレージに保存
 * chrome.runtime.idをキー導出に組み込むことで、異なる環境間のデータ分離を実現
 *
 * @param {typeof import('./storage.js').StorageKeys} StorageKeys - ストレージキーの列挙型
 * @returns {Promise<CryptoKey>} 導出された暗号化キー
 */
export async function getOrCreateEncryptionKey(StorageKeys) {
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
        const salt = crypto.getRandomValues(new Uint8Array(16));
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
/**
 * HMAC Secretを取得または作成する
 * @param {string} HmacSecretKey - HMAC Secretのストレージキー
 * @returns {Promise<string>} HMACシークレット
 */
export async function getOrCreateHmacSecret(HmacSecretKey) {
    if (cachedHmacSecret) {
        return cachedHmacSecret;
    }
    const result = await chrome.storage.local.get(HmacSecretKey);
    let secret = result[HmacSecretKey];
    if (!secret) {
        // 32バイトのランダムシークレットを生成
        const secretBytes = crypto.getRandomValues(new Uint8Array(32));
        secret = btoa(String.fromCharCode(...secretBytes));
        await chrome.storage.local.set({
            [HmacSecretKey]: secret
        });
    }
    cachedHmacSecret = secret;
    return secret;
}
/**
 * 設定キャッシュをクリアする（暗号化関連）
 */
export function clearHmacSecretCache() {
    cachedHmacSecret = null;
}
//# sourceMappingURL=storageEncrypted.js.map