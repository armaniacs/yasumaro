/**
 * ublockParser/index.ts
 * uBlock Origin形式フィルターパーサーのメインエントリーポイント
 *
 * 【機能概要】: uBlock Origin形式のドメインフィルターをパースし、内部データ構造に変換
 * 【実装方針】: 入力値検証とパターンマッチングによる安全なパース処理
 * 【テスト対応】: ソース `src/utils/__tests__/ublockParser.test.js` の29テストケースに対応
 * 🟢 信頼性レベル: plan/UII/02-phase2-parser.md および plan/UII/10-data-structures.md に基づく実装
 */
import { isValidString, isCommentLine, isEmptyLine, validateDomain, isValidRulePattern } from './validation.js';
import { createEmptyRuleset, generateRuleId, buildRuleObject, parseDomainList as transformParseDomainList, UblockRules } from './transform.js';
import { parseUblockFilterLine } from './parsing.js';
import { cleanupCache, clearCache, generateCacheKey, updateLRUTracker, saveToCache, getFromCache, hasCacheKey } from './cache.js';
import { parseDomainList, parseOptions, parseRuleOptions } from './options.js';
export * as CONSTANTS from './constants.js';
export { isValidString, validateDomain, isCommentLine, isEmptyLine, isValidRulePattern };
export { generateRuleId, buildRuleObject, createEmptyRuleset, transformParseDomainList };
export { parseDomainList, parseOptions, parseRuleOptions };
export { parseUblockFilterLine };
export { cleanupCache, clearCache, generateCacheKey, updateLRUTracker, saveToCache, getFromCache, hasCacheKey };
/**
 * パースエラー情報
 */
export interface ParseError {
    lineNumber: number;
    line: string;
    message: string;
}
/**
 * パース結果（エラー情報含む）
 */
export interface ParseResultWithErrors {
    rules: UblockRules;
    errors: ParseError[];
}
/**
 * 複数行のuBlockフィルターテキストを一括パース（エラーハンドリング対応）
 *
 * 【改善内容】:
 *   - createEmptyRulesetヘルパー関数でDRY原則適用
 *   - isValidStringによる一貫した入力検証
 *   - 定数DEFAULT_METADATAの使用
 *   - キャッシュ機能の追加（UF-302 パフォーマンス最適化）
 *   - エラーハンドリング機能の追加（UF-303 エラーハンドリング）
 * 【設計方針】: 各行をparseUblockFilterLineでパースし、ブロック/例外ルールに分類
 * 【パフォーマンス】: O(n)のループ処理、1行あたり一定の処理時間
 * 【保守性】: ルールセット構造が変更された場合も保守しやすい
 * 🟢 信頼性レベル: plan/UII/02-phase2-parser.md に記載される機能
 * @param {string} text - 複数行のフィルターテキスト
 * @returns {ParseResultWithErrors} - パース結果とエラー情報
 */
export declare function parseUblockFilterListWithErrors(text: string): ParseResultWithErrors;
/**
 * 複数行のuBlockフィルターテキストを一括パース（キャッシュ対応）
 *
 * 【改善内容】:
 *   - createEmptyRulesetヘルパー関数でDRY原則適用
 *   - isValidStringによる一貫した入力検証
 *   - 定数DEFAULT_METADATAの使用
 *   - キャッシュ機能の追加（UF-302 パフォーマンス最適化）
 * 【設計方針】: 各行をparseUblockFilterLineでパースし、ブロック/例外ルールに分類
 * 【パフォーマンス】: O(n)のループ処理、1行あたり一定の処理時間
 * 【保守性】: ルールセット構造が変更された場合も保守しやすい
 * 🟢 信頼性レベル: plan/UII/02-phase2-parser.md に記載される機能
 * @param {string} text - 複数行のフィルターテキスト
 * @returns {UblockRules} - パースされたUblockRulesオブジェクト
 */
export declare function parseUblockFilterList(text: string): UblockRules;
//# sourceMappingURL=index.d.ts.map