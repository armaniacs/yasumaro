/**
 * validation.ts
 * uBlockインポートモジュール - バリデーション機能
 */
/**
 * URLが安全なプロトコルかどうかを検証する
 * PRIV-003/SECURITY-007: URLバリデーションの強化
 * 【URL検証バイパス対策】厳格なURL構造検証を追加
 * @param {string} url - 検証するURL
 * @returns {boolean} 安全なhttps/http/ftpプロトコルで、有効な構造の場合true
 */
export declare function isValidUrl(url: string | null | undefined): boolean;
//# sourceMappingURL=validation.d.ts.map