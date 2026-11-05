/**
 * rulesBuilder.ts
 * uBlockインポートモジュール - 変換ロジック
 */

import { parseUblockFilterListWithErrors, ParseError } from '../../../utils/ublockParser/index.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { deriveUblockRulesFromSources } from '../../../utils/derivedUblockRules.js';

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
 * 導出式の単一実装は `src/utils/derivedUblockRules.ts` にあり、
 * ここでは旧来の返却形状 (blockRules 別名つき) を保つ薄い層である。
 * @param {Array} sources - ソースリスト
 * @returns {Object} 軽量なルールデータ
 */
export function rebuildRulesFromSources(sources: Source[]): RebuiltRules {
  // null/undefined の場合、空の結果を返す
  if (!sources || !Array.isArray(sources)) {
    sources = [];
  }

  const derived = deriveUblockRulesFromSources(sources);

  // ストレージには配列のみ保存（オブジェクトは保存しない）
  // 互換性のため blockRules/blockDomains 両方のプロパティを返す
  return {
    blockRules: derived.blockDomains,
    exceptionRules: derived.exceptionDomains,
    blockDomains: derived.blockDomains,   // 互換性用
    exceptionDomains: derived.exceptionDomains,  // 互換性用
    metadata: derived.metadata
  };
}

/**
 * uBlockフィルターのプレビュー
 * @param {string} text - フィルターテキスト
 * @returns {Object} プレビュー結果
 */
export function previewUblockFilter(text: string): PreviewResult {
  try {
    const result = parseUblockFilterListWithErrors(text);

    return {
      blockCount: result.rules.blockRules.length,
      exceptionCount: result.rules.exceptionRules.length,
      errorCount: result.errors.length,
      errorDetails: result.errors
    };
  } catch (error: unknown) {
    return {
      blockCount: 0,
      exceptionCount: 0,
      errorCount: 1,
      errorDetails: [{
        lineNumber: 0,
        line: '',
        message: errorMessage(error)
      }]
    };
  }
}