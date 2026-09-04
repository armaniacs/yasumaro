/**
 * AI要約クリーニング — メインエントリーポイント
 * ルール表 (rules.ts) を走査してクレンジングを実行する
 *
 * 【モジュール構成】
 * - types.ts          - 型定義（AiSummaryCleanseOptions, AiSummaryCleanseResult）
 * - patterns.ts       - パターン定数（AD_CLASS_PATTERNS等）
 * - helpers.ts        - ヘルパー関数（buildClassIdSelectors等）
 * - rules.ts          - ルール表（単一の情報源）
 * - stripCore.ts      - コアの_strip関数
 * - stripExtended.ts  - 拡張の_strip関数
 * - index.ts          - オーケストレーター（このファイル）+ 再エクスポート
 */

import { logDebug } from '../logger.js';
import type { AiSummaryCleanseOptions, AiSummaryCleanseResult, CleansingRemovalCounts } from './types.js';
import { markBodyElements, unmarkBodyElements, DEFAULT_CLEANSE_BODY_PROTECTION_THRESHOLD } from './bodyProtection.js';
import { CLEANSING_RULES, isRuleEnabled, resolveThresholds } from './rules.js';

// 型とルール表を再エクスポート
export type { AiSummaryCleanseOptions, AiSummaryCleanseResult, CleansingRemovalCounts, RuleKey, AiSummaryCleanseRuleFlags } from './types.js';
export { CLEANSING_RULES, CLEANSING_RULE_KEYS, isRuleEnabled, resolveThresholds } from './rules.js';
export type { CleansingRule, CleansingThresholds } from './rules.js';
export { getCleansingConfigForDomain, normalizeDomain, upsertDomainOverride } from './perSiteOverride.js';
export type { DomainCleansingOverride } from './perSiteOverride.js';

/**
 * Projects the keyed removal map onto the flat `xRemoved` fields.
 *
 * The map is the source of truth. These fields exist because callers and
 * tests read them by name; nothing computes them independently, so they
 * cannot drift from the map the way the old parallel implementations did.
 */
function buildCleanseResult(
    removed: CleansingRemovalCounts,
    bytesBefore: number,
    bytesAfter: number,
): AiSummaryCleanseResult {
    const totalRemoved = Object.values(removed).reduce((sum, n) => sum + n, 0);
    const flat: Record<string, number> = {};
    for (const [key, count] of Object.entries(removed)) {
        flat[`${key}Removed`] = count;
    }

    return {
        removed,
        ...flat,
        totalRemoved,
        bytesBefore,
        bytesAfter,
    } as AiSummaryCleanseResult;
}

/**
 * DOMからAI要約に不要な要素を削除する
 * @param element - クレンジング対象のルート要素
 * @param options - クレンジングオプション
 * @returns クレンジング結果
 */
export function cleanseAISummaryContent(
    element: Element,
    options: AiSummaryCleanseOptions = {}
): AiSummaryCleanseResult {
    const { bodyProtectionEnabled = true, bodyProtectionThreshold = DEFAULT_CLEANSE_BODY_PROTECTION_THRESHOLD, measureBytes = true } = options;
    const thresholds = resolveThresholds(options);

    // Diagnostic-only: serializing outerHTML twice is wasted work on the
    // hot path, so it runs only when the caller opts in via measureBytes.
    // Measured before any work mutates the tree.
    const bytesBefore = measureBytes ? new Blob([element.outerHTML || '']).size : 0;

    // Contract: this function MUTATES the passed element in place. Callers
    // that must preserve the original (contentExtractor's extract path)
    // clone first and hand us the scratch tree.
    const target = element;

    // Step 1: 本文要素にマーキング（本文保護が有効な場合）
    if (bodyProtectionEnabled) {
        markBodyElements(target, bodyProtectionThreshold);
    }

    // Step 2: ルール表の順にクレンジングを実行
    //
    // NOTE(PBI 05): primeDeepHosts はホットパスから外した。現行ルールは
    // querySelectorAllDeep を呼ばないため事前検出は無駄な全走査になる
    // （ヘルパ自体は shadow/iframe 対応ルール追加時のために維持）。
    //
    // Disabled rules are recorded as 0 rather than omitted: callers read the
    // flat `xRemoved` fields and compare them numerically, so a missing key
    // would surface as `undefined` and break arithmetic. "Did not run" and
    // "removed nothing" are both zero removals from the caller's point of view.
    const removed: CleansingRemovalCounts = {};
    for (const rule of CLEANSING_RULES) {
        removed[rule.key] = isRuleEnabled(rule, options)
            ? rule.strip(target, thresholds)
            : 0;
    }

    // Step 3: マーカーを除去（本文保護が有効な場合）
    if (bodyProtectionEnabled) {
        unmarkBodyElements(target);
    }

    const bytesAfter = measureBytes ? new Blob([target.outerHTML || '']).size : 0;
    const result = buildCleanseResult(removed, bytesBefore, bytesAfter);

    logDebug('AI Summary Cleansing executed', {
        totalRemoved: result.totalRemoved,
        bytesBefore,
        bytesAfter,
        compressionRatio: bytesBefore > 0
            ? ((bytesBefore - bytesAfter) / bytesBefore * 100).toFixed(1) + '%'
            : '0%',
        breakdown: removed,
    }, 'aiSummaryCleaner');

    return result;
}

/**
 * DOMのAI要約クレンジング対象要素数をカウントする（削除は行わない）
 *
 * Counting runs the real strip functions over a throwaway clone rather than
 * reimplementing the matching logic. The previous hand-written counter drifted
 * from the strips it mirrored — on identical input it reported 25 where the
 * strips removed 14, because it matched on different selectors — and silently
 * ignored 15 of the 32 rules entirely.
 *
 * The clone is discarded, so the caller's DOM is untouched.
 *
 * @param element - カウント対象のルート要素
 * @param options - クレンジングオプション
 * @returns カウント結果（削除は行わない）
 */
export function countAISummaryTargets(
    element: Element,
    options: AiSummaryCleanseOptions = {}
): AiSummaryCleanseResult {
    const clone = element.cloneNode(true) as Element;
    return cleanseAISummaryContent(clone, options);
}
