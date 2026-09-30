/**
 * typesCrypto.ts
 * 暗号化関連の型定義
 * 循環参照回避のために独立したファイル
 */

/**
 * 暗号化データの形式
 *
 * `version` は AAD 有無の判別子（crypto/envelope.ts の versioning 規約に合わせる）。
 * 欠落または 1 は AAD なしの旧形式（v1）、2 は保存位置のフィールドに
 * 束縛された形式（v2）。
 * フィールド識別子自体は格納しない — 入れ替え攻撃者が ciphertext と一緒に
 * 束縛まで移せてしまうため、束縛は呼び出し側が読み出し位置から渡す。
 */
export interface EncryptedData {
    ciphertext: string;
    iv: string;
    version?: number;
}
