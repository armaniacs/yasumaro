/**
 * ublockParser/transform.ts
 * uBlock Origin形式フィルターパーサーのデータ変換・構築関数
 */

import { DEFAULT_METADATA } from './constants.js';
import { parseRuleOptions, OptionValues } from './options.js';

export { parseDomainList } from './options.js';

export interface UblockRule {
  rawLine: string;
  type: string;
  domain: string;
  pattern: string;
  options: OptionValues;
  originalLine?: string; // hosts形式の場合のみ
}

/**
 * パーサ中間形式のルールセット（`parseUblockFilterList` の返り値）。
 * ストレージ保存用の軽量形式（`src/utils/types.ts` の `UblockRules`）とは
 * 別物であり、同名衝突を避けるため `ParsedUblockRuleset` と命名する。
 */
export interface ParsedUblockRuleset {
  blockRules: UblockRule[];
  exceptionRules: UblockRule[];
  metadata: {
    source: string;
    importedAt: number;
    lineCount: number;
    ruleCount: number;
  }
}

// ============================================================================
// ドメインリストパース
// ============================================================================

// 注意: parseDomainList は options.js で定義されています
// これは parseOptions 関数から内部的に使用されるため

// ============================================================================
// ルールオブジェクト構築
// ============================================================================

/**
 * ルールオブジェクトを構築するヘルパー関数。
 * オブジェクト構築ロジックを分離して可読性を保つ。
 * @param {string} trimmedLine - トリムされた元の行
 * @param {string} type - ルールタイプ
 * @param {string} domain - ドメイン
 * @returns {UblockRule} - UblockRuleオブジェクト
 */
export function buildRuleObject(trimmedLine: string, type: string, domain: string): UblockRule {
  const pattern = domain;

  return {
    rawLine: trimmedLine,
    type,
    domain,
    pattern,
    options: parseRuleOptions(trimmedLine)
  };
}

// ============================================================================
// ルールセット生成
// ============================================================================

/**
 * 空のルールセットを生成するヘルパー関数。
 * parseUblockFilterList の初期化とエラー時の返却で共通利用する。
 * @returns {ParsedUblockRuleset} - 空のParsedUblockRulesetオブジェクト
 */
export function createEmptyRuleset(): ParsedUblockRuleset {
  return {
    blockRules: [],
    exceptionRules: [],
    metadata: {
      source: DEFAULT_METADATA.SOURCE,
      importedAt: Date.now(),
      lineCount: 0,
      ruleCount: 0
    }
  };
}