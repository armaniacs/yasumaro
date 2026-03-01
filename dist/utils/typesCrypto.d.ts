/**
 * typesCrypto.ts
 * 暗号化関連の型定義
 * 循環参照回避のために独立したファイル
 */
/**
 * SubtleCrypto 拡張: timingSafeEqual メソッド
 * これは Web Crypto API 標準で定義されていますが、TypeScript 型定義に含まれていない場合があります
 */
declare global {
    interface SubtleCrypto {
        timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): Promise<boolean>;
    }
}
/**
 * 暗号化データの形式
 */
export interface EncryptedData {
    ciphertext: string;
    iv: string;
}
//# sourceMappingURL=typesCrypto.d.ts.map