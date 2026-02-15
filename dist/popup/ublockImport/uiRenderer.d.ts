/**
 * uiRenderer.ts
 * uBlockインポートモジュール - UI操作機能
 */
interface Source {
    url: string;
    importedAt: number;
    ruleCount: number;
    blockDomains?: string[];
    exceptionDomains?: string[];
}
interface PreviewResult {
    blockCount: number;
    exceptionCount: number;
    errorCount: number;
    errorDetails: string[] | {
        lineNumber: number;
        message: string;
        line?: string;
    }[];
}
/**
 * ソースリストをUIに描画
 * @param {Array} sources - ソースリスト
 * @param {Function} deleteCallback - 削除コールバック
 * @param {Function} reloadCallback - 再読み込みコールバック
 */
export declare function renderSourceList(sources: Source[], deleteCallback?: (index: number) => void, reloadCallback?: (index: number) => void): void;
/**
 * プレビューUI更新
 * @param {Object|string} result - プレビュー結果またはエラーメッセージ
 */
export declare function updatePreviewUI(result: PreviewResult | string): void;
/**
 * プレビューを非表示にする
 */
export declare function hidePreview(): void;
/**
 * 入力エリアのテキストをクリア
 */
export declare function clearInput(): void;
/**
 * ドメインリストをシンプル形式でエクスポート
 * @param {Array} sources - ソースリスト
 */
export declare function exportSimpleFormat(sources: Source[]): string;
/**
 * uBlock形式のテキストをクリップボードにコピー
 */
export declare function copyToClipboard(text: string): Promise<boolean>;
/**
 * ドメインリストをuBlock形式で構築
 * @param {Array} sources - ソースリスト
 */
export declare function buildUblockFormat(sources: Source[]): string;
export {};
//# sourceMappingURL=uiRenderer.d.ts.map