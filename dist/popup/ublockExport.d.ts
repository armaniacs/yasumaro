/**
 * @file src/popup/ublockExport.ts
 * uBlockエクスポートUIロジック
 */
interface UblockRule {
    rawLine: string;
}
interface UblockRules {
    blockRules: UblockRule[];
    exceptionRules: UblockRule[];
}
/**
 * uBlockルールをテキスト形式でエクスポート
 * @param {UblockRules} rules - ルールセット
 * @returns {string} uBlock形式テキスト
 */
export declare function exportToText(rules: UblockRules): string;
/**
 * uBlockルールを .txt ファイルとしてダウンロード
 * @param {UblockRules} rules - ルールセット
 * @param {string} [filename] - ファイル名
 */
export declare function downloadAsFile(rules: UblockRules, filename?: string): void;
/**
 * uBlockルールをクリップボードにコピー
 * @param {UblockRules} rules - ルールセット
 * @returns {Promise<boolean>}
 */
export declare function copyToClipboard(rules: UblockRules): Promise<boolean>;
/**
 * エクスポートUIの初期化
 */
export declare function init(): void;
export {};
//# sourceMappingURL=ublockExport.d.ts.map