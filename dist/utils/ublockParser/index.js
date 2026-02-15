/**
 * ublockParser/index.ts
 * uBlock Origin形式フィルターパーサーのメインエントリーポイント
 *
 * 【機能概要】: uBlock Origin形式のドメインフィルターをパースし、内部データ構造に変換
 * 【実装方針】: 入力値検証とパターンマッチングによる安全なパース処理
 * 【テスト対応】: ソース `src/utils/__tests__/ublockParser.test.js` の29テストケースに対応
 * 🟢 信頼性レベル: plan/UII/02-phase2-parser.md および plan/UII/10-data-structures.md に基づく実装
 */
import { DEFAULT_METADATA, RULE_TYPES } from './constants.js';
import { isValidString, isCommentLine, isEmptyLine, validateDomain, isValidRulePattern } from './validation.js';
import { createEmptyRuleset, generateRuleId, buildRuleObject, parseDomainList as transformParseDomainList } from './transform.js';
import { parseUblockFilterLine } from './parsing.js';
import { cleanupCache, clearCache, generateCacheKey, updateLRUTracker, saveToCache, getFromCache, hasCacheKey } from './cache.js';
import { parseDomainList, parseOptions, parseRuleOptions } from './options.js';
// Re-export constants
export * as CONSTANTS from './constants.js';
// Re-export validation functions
export { isValidString, validateDomain, isCommentLine, isEmptyLine, isValidRulePattern };
// Re-export transform functions
export { generateRuleId, buildRuleObject, createEmptyRuleset, transformParseDomainList };
// Re-export options functions
export { parseDomainList, parseOptions, parseRuleOptions };
// Re-export parsing functions
export { parseUblockFilterLine };
// Re-export cache functions
export { cleanupCache, clearCache, generateCacheKey, updateLRUTracker, saveToCache, getFromCache, hasCacheKey };
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
export function parseUblockFilterListWithErrors(text) {
    // 【キャッシュクリーンアップ】: 定期的にキャッシュをクリーンアップ 🟢
    cleanupCache();
    // 【入力値検証】: null/undefinedの場合は空のルールセットを返す 🟢
    if (!isValidString(text)) {
        return {
            rules: createEmptyRuleset(),
            errors: []
        };
    }
    // 【キャッシュチェック】: キャッシュに存在する場合はキャッシュを返す 🟢
    // 【キャッシュキー生成】: 最初の100文字と長さでキャッシュキーを生成
    const cacheKey = generateCacheKey(text);
    const cached = getFromCache(cacheKey);
    if (cached) {
        return { ...cached, errors: cached.errors || [] };
    }
    //   if (hasCacheKey(cacheKey)) {
    //     const cached = getFromCache(cacheKey);
    //     return { ...cached, errors: cached.errors || [] }; // ディープコピーして返す
    //   }
    // 【行分割】: 改行区切りのテキストを配列に変換 🟢
    const lines = text.split('\n');
    // 【配列初期化】: ルール格納用配列 🟢
    const blockRules = [];
    const exceptionRules = [];
    const errors = [];
    // 【行パース】: 各行をパースしてルールに分類 🟢
    // 【パフォーマンス】: linearループで効率的、1,000行<1秒が達成可能 🟢
    // 【メモリ最適化】: early returnで無駄な処理をスキップ 🟢
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // 【空行スキップ】: 空行は事前にスキップして処理を軽量化 🟢
        if (isEmptyLine(line)) {
            continue;
        }
        // 【コメント行スキップ】: コメント行も事前にスキップ 🟢
        if (isCommentLine(line)) {
            continue;
        }
        try {
            const rule = parseUblockFilterLine(line); // 【単行パース】: 1行ずつ処理
            // 【ルール分類】: nullでない場合にタイプごとに追加 🟢
            if (rule) {
                if (rule.type === RULE_TYPES.BLOCK) {
                    blockRules.push(rule);
                }
                else if (rule.type === RULE_TYPES.EXCEPTION) {
                    exceptionRules.push(rule);
                }
                else if (rule.type === RULE_TYPES.IGNORE) {
                    // 【無視ルール】: 意図的に無視されたルールは何もしない 🟢
                }
            }
            else {
                // 【無効なルールをエラーとして収集】🟢
                // 空行やコメント行でないのにパースできない行はエラーとして扱う
                errors.push({
                    lineNumber: i + 1,
                    line: line,
                    message: '無効なルール形式です'
                });
            }
        }
        catch (error) {
            // 【エラー収集】: パースエラーを収集 🟢
            errors.push({
                lineNumber: i + 1,
                line: line,
                message: error.message
            });
        }
    }
    // 【メタデータ構築】: パース結果の集計情報 🟢
    const rules = {
        blockRules: blockRules, // 【ブロックルール配列】
        exceptionRules: exceptionRules, // 【例外ルール配列】
        // errors: errors,                                 // 【エラー情報】 - UblockRules型にはありませんが、Resultには含まれます
        metadata: {
            source: DEFAULT_METADATA.SOURCE, // 【データソース】: テキストエリア貼り付け
            importedAt: Date.now(), // 【インポート日時】: UNIXタイムスタンプ
            lineCount: lines.length, // 【入力行数】: コメント・空行を含む
            ruleCount: blockRules.length + exceptionRules.length, // 【有効ルール数】
            // errorCount: errors.length         // 【エラー数】
        }
    };
    const result = { rules, errors };
    // 【キャッシュ保存】: キャッシュに結果を保存 🟢
    saveToCache(cacheKey, result);
    return result;
}
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
export function parseUblockFilterList(text) {
    // 【キャッシュクリーンアップ】: 定期的にキャッシュをクリーンアップ 🟢
    cleanupCache();
    // 【入力値検証】: null/undefinedの場合は空のルールセットを返す 🟢
    if (!isValidString(text)) {
        return createEmptyRuleset();
    }
    // 【キャッシュチェック】: キャッシュに存在する場合はキャッシュを返す 🟢
    // 【キャッシュキー生成】: 最初の100文字と長さでキャッシュキーを生成
    const cacheKey = generateCacheKey(text);
    const cached = getFromCache(cacheKey);
    if (cached && 'rules' in cached) {
        // ParseResultWithErrors形式でキャッシュされている場合
        return { ...cached.rules };
    }
    else if (cached) {
        // UblockRules形式でキャッシュされている場合
        return { ...cached };
    }
    // 【行分割】: 改行区切りのテキストを配列に変換 🟢
    const lines = text.split('\n');
    // 【配列初期化】: ルール格納用配列 🟢
    const blockRules = [];
    const exceptionRules = [];
    // 【行パース】: 各行をパースしてルールに分類 🟢
    // 【パフォーマンス】: linearループで効率的、1,000行<1秒が達成可能 🟢
    // 【メモリ最適化】: early returnで無駄な処理をスキップ 🟢
    for (const line of lines) {
        // 【空行スキップ】: 空行は事前にスキップして処理を軽量化 🟢
        if (isEmptyLine(line)) {
            continue;
        }
        // 【コメント行スキップ】: コメント行も事前にスキップ 🟢
        if (isCommentLine(line)) {
            continue;
        }
        const rule = parseUblockFilterLine(line); // 【単行パース】: 1行ずつ処理
        // 【ルール分類】: nullでない場合にタイプごとに追加 🟢
        if (rule) {
            if (rule.type === RULE_TYPES.BLOCK) {
                blockRules.push(rule);
            }
            else if (rule.type === RULE_TYPES.EXCEPTION) {
                exceptionRules.push(rule);
            }
            else if (rule.type === RULE_TYPES.IGNORE) {
                // 【無視ルール】: 意図的に無視されたルールは何もしない 🟢
            }
        }
    }
    // 【メタデータ構築】: パース結果の集計情報 🟢
    const result = {
        blockRules: blockRules, // 【ブロックルール配列】
        exceptionRules: exceptionRules, // 【例外ルール配列】
        metadata: {
            source: DEFAULT_METADATA.SOURCE, // 【データソース】: テキストエリア貼り付け
            importedAt: Date.now(), // 【インポート日時】: UNIXタイムスタンプ
            lineCount: lines.length, // 【入力行数】: コメント・空行を含む
            ruleCount: blockRules.length + exceptionRules.length // 【有効ルール数】
        }
    };
    // 【キャッシュ保存】: キャッシュに結果を保存 🟢
    saveToCache(cacheKey, result);
    return result;
}
//# sourceMappingURL=index.js.map