/**
 * ublockParser/transform.ts
 * uBlock Origin形式フィルターパーサーのデータ変換・構築関数
 */

import { DEFAULT_METADATA, NULL_RULE_ID } from './constants.js';
import { parseRuleOptions, OptionValues } from './options.js';

export { parseDomainList } from './options.js';

export interface UblockRule {
  id: string;
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
// ID生成
// ============================================================================

/**
 * ルールの一意IDを生成
 *
 * 31 乗多項式ローリングハッシュ（Java String.hashCode と同型）で一意性を確保する。
 * O(n) の単純なハッシュで十分な速度。セキュアなハッシュではなく識別用のみ。
 * 将来的には SHA-256 への移行可能性がある（Web Crypto API 等）。
 * @param {string} rawLine - 元のルール行
 * @returns {string} - 一意ID
 */
export function generateRuleId(rawLine: string): string {
  if (rawLine == null || typeof rawLine !== 'string') {
    return NULL_RULE_ID;
  }

  // 31 乗多項式ローリングハッシュ（Java String.hashCode と同型）。
  // FNV-1a ではない: FNV はオフセット基数と素数の乗算を使うが、この実装は
  // (hash << 5) - hash + char、すなわち hash * 31 + char を 32bit に畳むだけ。
  let hash = 0;
  for (let i = 0; i < rawLine.length; i++) {
    const char = rawLine.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 32bit整数に変換
  }

  // ハッシュ値をハイフン区切りのUUID形式に変換
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `${hex.substring(0, 8)}-${hex.substring(8, 12) || '0000'}-${hex.substring(12, 16) || '0000'}-${hex.substring(16, 20) || '0000'}-${hex.substring(20, 32) || '000000000000'}`.substring(0, 36);
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
    id: generateRuleId(trimmedLine),
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