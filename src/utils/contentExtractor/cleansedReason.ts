/**
 * AI要約クレンジングの「理由」導出
 *
 * Derives which rules actually removed something, from the keyed removal map
 * produced by the cleanser. This replaces two hand-unrolled `if` chains that
 * had drifted apart: one listed 6 rules, the other 26, against a rule set of
 * 32. Fifteen of the 26 could never fire because the count path never
 * produced their counts, and six rules that *were* counted had no `if` at
 * all, so they could never become a reason.
 *
 * Iterating the map means a new rule needs no edit here.
 */

import type { AiSummaryCleanseResult } from '../aiSummaryCleaner/index.js';
import type { ExtractResult } from './types.js';

export interface CleansedReasonResult {
    reason: ExtractResult['aiSummaryCleansedReason'];
    reasons: string[];
}

/**
 * Incrementally records a removal for a given reason into a Map.
 * 30-14: 観測性ファネルで `removedByReason` を構築するために使用。
 * @param map - 集計先の Map (undefined なら新規作成して返す)
 * @param reason - 削除理由キー (RuleKey 等)
 * @param count - 加算する件数 (デフォルト 1)
 * @returns 更新後の Map
 */
export function recordRemoval(
    map: Map<string, number> | undefined,
    reason: string,
    count = 1,
): Map<string, number> {
    const m = map ?? new Map<string, number>();
    m.set(reason, (m.get(reason) ?? 0) + count);
    return m;
}

/**
 * AiSummaryCleanseResult.removed (Record) から Map<string, number> への変換ヘルパ。
 */
export function removedRecordToMap(
    removed?: Record<string, number> | Map<string, number>,
): Map<string, number> | undefined {
    if (!removed) return undefined;
    if (removed instanceof Map) return new Map(removed);
    const entries = Object.entries(removed).filter(([, v]) => v > 0);
    if (entries.length === 0) return new Map();
    return new Map(entries);
}

/**
 * Returns the rule keys that removed at least one element, and the reason
 * value derived from them: the single key when exactly one rule fired,
 * `'multiple'` when several did, `'none'` when nothing was removed.
 */
export function deriveCleansedReason(result: AiSummaryCleanseResult): CleansedReasonResult {
    if (result.totalRemoved <= 0) {
        return { reason: 'none', reasons: [] };
    }

    const removedTypes = Object.entries(result.removed ?? {})
        .filter(([, count]) => count > 0)
        .map(([key]) => key);

    if (removedTypes.length === 1) {
        return {
            reason: removedTypes[0] as ExtractResult['aiSummaryCleansedReason'],
            reasons: [],
        };
    }
    if (removedTypes.length > 1) {
        return { reason: 'multiple', reasons: removedTypes };
    }
    return { reason: 'none', reasons: [] };
}
