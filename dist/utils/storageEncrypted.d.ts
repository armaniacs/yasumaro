/**
 * storageEncrypted.ts
 * 暗号化ストレージ関連の機能
 * 暗号化キー管理、キャッシュ、HMAC Secret管理
 */
/**
 * 暗号化キーを取得または作成する
 * ソルト/シークレットが無ければ自動生成してストレージに保存
 * chrome.runtime.idをキー導出に組み込むことで、異なる環境間のデータ分離を実現
 *
 * @param {typeof import('./storage.js').StorageKeys} StorageKeys - ストレージキーの列挙型
 * @returns {Promise<CryptoKey>} 導出された暗号化キー
 */
export declare function getOrCreateEncryptionKey(StorageKeys: {
    ENCRYPTION_SALT: string;
    ENCRYPTION_SECRET: string;
}): Promise<CryptoKey>;
/**
 * 暗号化キーのキャッシュをクリアする（テスト用）
 */
export declare function clearEncryptionKeyCache(): void;
/**
 * HMAC Secretを取得または作成する
 * @param {string} HmacSecretKey - HMAC Secretのストレージキー
 * @returns {Promise<string>} HMACシークレット
 */
export declare function getOrCreateHmacSecret(HmacSecretKey: string): Promise<string>;
/**
 * 設定キャッシュをクリアする（暗号化関連）
 */
export declare function clearHmacSecretCache(): void;
//# sourceMappingURL=storageEncrypted.d.ts.map