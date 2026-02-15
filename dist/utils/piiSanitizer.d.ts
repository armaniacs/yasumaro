/**
 * piiSanitizer.ts
 * 正規表現による個人情報（PII）の検出とマスキング
 * ReDoS対策: 入力サイズ制限とタイムアウト機能を実装
 * パフォーマンス改善: 1回のスキャンで全パターンを検出
 */
export declare const MAX_INPUT_SIZE: number;
interface SanitizeOptions {
    timeout?: number;
    skipSizeLimit?: boolean;
}
interface MaskedItem {
    type: string;
    original: string;
    index?: number;
}
interface SanitizeResult {
    text: string;
    maskedItems: MaskedItem[];
    error?: string;
}
/**
 * テキストからPIIを検出してマスクする
 * 【パフォーマンス改善】: 1回のスキャンで全パターンを検出
 * @param {string} text - 対象テキスト
 * @param {SanitizeOptions} options - オプション
 * @param {number} options.timeout - タイムアウト時間（ミリ秒）、デフォルト5000ms
 * @param {boolean} options.skipSizeLimit - サイズ制限をスキップするか（デフォルトfalse）
 * @returns {Promise<SanitizeResult>} { text: string, maskedItems: Array<{type: string, original: string}>, error?: string }
 */
export declare function sanitizeRegex(text: string, options?: SanitizeOptions): Promise<SanitizeResult>;
export {};
//# sourceMappingURL=piiSanitizer.d.ts.map