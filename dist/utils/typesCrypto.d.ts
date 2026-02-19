/**
 * typesCrypto.ts
 * 暗号化関連の型定義
 * 循環参照回避のために独立したファイル
 */
/**
 * 暗号化データの形式
 */
export interface EncryptedData {
    ciphertext: string;
    iv: string;
}
//# sourceMappingURL=typesCrypto.d.ts.map