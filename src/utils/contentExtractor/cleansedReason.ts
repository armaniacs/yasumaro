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
