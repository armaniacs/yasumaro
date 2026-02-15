/**
 * rulesBuilder.ts
 * uBlockインポートモジュール - 変換ロジック
 */
import { parseUblockFilterListWithErrors } from '../../utils/ublockParser.js';
/**
 * 超軽量化: ソースからドメインセットを構築
 * ストレージにはドメイン文字列の配列のみを保存
 * @param {Array} sources - ソースリスト
 * @returns {Object} 軽量なルールデータ
 */
export function rebuildRulesFromSources(sources) {
    const blockDomains = new Set();
    const exceptionDomains = new Set();
    // null/undefined の場合、空の結果を返す
    if (!sources || !Array.isArray(sources)) {
        sources = [];
    }
    for (const source of sources) {
        if (source && source.blockDomains) {
            source.blockDomains.forEach(d => blockDomains.add(d));
        }
        if (source && source.exceptionDomains) {
            source.exceptionDomains.forEach(d => exceptionDomains.add(d));
        }
    }
    // ストレージには配列のみ保存（オブジェクトは保存しない）
    // 互換性のため blockRules/blockDomains 両方のプロパティを返す
    const blockRules = Array.from(blockDomains);
    const exceptionRules = Array.from(exceptionDomains);
    return {
        blockRules,
        exceptionRules,
        blockDomains: blockRules, // 互換性用
        exceptionDomains: exceptionRules, // 互換性用
        metadata: {
            importedAt: Date.now(),
            ruleCount: blockDomains.size + exceptionDomains.size
        }
    };
}
/**
 * uBlockフィルターのプレビュー
 * @param {string} text - フィルターテキスト
 * @returns {Object} プレビュー結果
 */
export function previewUblockFilter(text) {
    try {
        const result = parseUblockFilterListWithErrors(text);
        return {
            blockCount: result.rules.blockRules.length,
            exceptionCount: result.rules.exceptionRules.length,
            errorCount: result.errors.length,
            errorDetails: result.errors
        };
    }
    catch (error) {
        return {
            blockCount: 0,
            exceptionCount: 0,
            errorCount: 1,
            errorDetails: [{
                    lineNumber: 0,
                    line: '',
                    message: error.message
                }]
        };
    }
}
//# sourceMappingURL=rulesBuilder.js.map