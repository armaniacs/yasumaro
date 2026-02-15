/**
 * rulesBuilder.ts
 * uBlockインポートモジュール - 変換ロジック
 */
import { ParseError } from '../../utils/ublockParser.js';
interface Source {
    blockDomains?: string[];
    exceptionDomains?: string[];
}
interface RebuiltRules {
    blockRules: string[];
    exceptionRules: string[];
    blockDomains: string[];
    exceptionDomains: string[];
    metadata: {
        importedAt: number;
        ruleCount: number;
    };
}
interface PreviewResult {
    blockCount: number;
    exceptionCount: number;
    errorCount: number;
    errorDetails: ParseError[];
}
/**
 * 超軽量化: ソースからドメインセットを構築
 * ストレージにはドメイン文字列の配列のみを保存
 * @param {Array} sources - ソースリスト
 * @returns {Object} 軽量なルールデータ
 */
export declare function rebuildRulesFromSources(sources: Source[]): RebuiltRules;
/**
 * uBlockフィルターのプレビュー
 * @param {string} text - フィルターテキスト
 * @returns {Object} プレビュー結果
 */
export declare function previewUblockFilter(text: string): PreviewResult;
export {};
//# sourceMappingURL=rulesBuilder.d.ts.map