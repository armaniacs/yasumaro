/**
 * derivedUblockRules.ts
 * uBlock 導出キャッシュの単一実装 (PBI 2026-11-06-01)。
 *
 * `ublock_rules` は `ublock_sources` の純粋関数であり、正本は sources 側
 * (URL・取得時刻・ドメイン実体を持つ) である。ランタイム依存のない
 * leaf モジュールとして置き、`rulesBuilder` (dashboard 層) と
 * `domainUtils` (utils 層) の両方から使うことで、層をまたぐ import 循環を
 * 作らずに導出式を一箇所に保つ。
 */

import type { Source, UblockRules } from './types.js';

/** A source-shaped value carrying parsed domains (arrays may be absent in legacy rows). */
export interface UblockSourceView {
  blockDomains?: string[];
  exceptionDomains?: string[];
}

/**
 * deriveUblockRulesFromSources の返却型。`UblockRules.metadata` は任意だが、
 * この導出は必ず付与するため、呼び出し側 (必須 metadata を持つ旧形状への
 * 適合など) が `undefined` 検査を強いられないよう絞り込んである。
 */
export interface DerivedUblockRules extends UblockRules {
  metadata: { importedAt: number; ruleCount: number };
}

/**
 * ソース一覧からマージ済みルールを導出する。入力は変更せず、毎回新しい
 * 配列・オブジェクトを返す。nullish・配列なし要素は空として扱う。
 */
export function deriveUblockRulesFromSources(
  sources: readonly UblockSourceView[] | null | undefined,
): DerivedUblockRules {
  const blockDomains = new Set<string>();
  const exceptionDomains = new Set<string>();

  if (Array.isArray(sources)) {
    for (const source of sources) {
      if (source && Array.isArray(source.blockDomains)) {
        for (const domain of source.blockDomains) blockDomains.add(domain);
      }
      if (source && Array.isArray(source.exceptionDomains)) {
        for (const domain of source.exceptionDomains) exceptionDomains.add(domain);
      }
    }
  }

  return {
    blockDomains: Array.from(blockDomains),
    exceptionDomains: Array.from(exceptionDomains),
    metadata: {
      importedAt: Date.now(),
      ruleCount: blockDomains.size + exceptionDomains.size,
    },
  };
}

/** 永続化する正規の空形。毎回新しいオブジェクトを返す (共有ミュータブルなし)。 */
export function emptyUblockRules(): UblockRules {
  return {
    blockDomains: [],
    exceptionDomains: [],
    metadata: { importedAt: 0, ruleCount: 0 },
  };
}

/**
 * 読み側正規化: sources がドメイン実体を持つ場合は格納済み rules を
 * 空の正規形に畳む (導出キャッシュの二重保持を解消)。sources が空の
 * 場合のみ格納済み rules をそのまま返す (rules-only の旧形式ペイロード
 * の読み込み互換)。入力は変更しない。
 */
export function dropDerivedUblockRules(sources: Source[] | undefined, rules: UblockRules | undefined): UblockRules {
  if (Array.isArray(sources) && sources.length > 0) {
    return emptyUblockRules();
  }
  return rules ?? emptyUblockRules();
}
