/**
 * rulesBuilder.ts
 * uBlockインポートモジュール - 変換ロジック
 */

import { parseUblockFilterListWithErrors, ParseError } from '../../utils/ublockParser.js';

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
export function rebuildRulesFromSources(sources: Source[]): RebuiltRules {
  const blockDomains = new Set<string>();
  const exceptionDomains = new Set<string>();

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
    blockDomains: blockRules,   // 互換性用
    exceptionDomains: exceptionRules,  // 互換性用
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
export function previewUblockFilter(text: string): PreviewResult {
  try {
    const result = parseUblockFilterListWithErrors(text);

    return {
      blockCount: result.rules.blockRules.length,
      exceptionCount: result.rules.exceptionRules.length,
      errorCount: result.errors.length,
      errorDetails: result.errors
    };
  } catch (error: any) {
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