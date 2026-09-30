/**
 * commonTypes.ts
 * 共通型定義
 * 複数のモジュールで使用される型定義を集約
 */

// Type-only: erased at compile time, so this creates no runtime edge
// (messaging/types.ts imports from this module in turn).
import type { ContentResponse } from '../messaging/types.js';

/**
 * 記録方式
 * - auto: 自動記録（訪問条件を満たして自動的に記録）
 * - manual: 手動記録（「今すぐ記録」ボタンで記録）
 */
export type RecordType = 'auto' | 'manual';

/**
 * AI要約クレンジング実行理由
 *
 * One value per cleansing rule (see CLEANSING_RULES in
 * utils/aiSummaryCleaner/rules.ts), plus 'multiple' and 'none'.
 *
 * This union previously listed only the original six rules while the cleanser
 * had grown to 32, so values such as 'jsonLd' were already being written to
 * storage through a cast. Historical records may therefore contain any of
 * these; readers fall back to the raw key when no label exists.
 */
export type AiSummaryCleansedReason =
    | 'alt' | 'metadata' | 'ads' | 'nav' | 'social' | 'deep'
    | 'jsonLd' | 'lazyLoad' | 'skipLink' | 'card' | 'linkDensity'
    | 'fixed' | 'recommend' | 'pagination' | 'snsPromo' | 'popup' | 'platform'
    | 'textDensity' | 'shortSeq' | 'symbolLine' | 'linkPara'
    | 'enhancedHidden' | 'emptyElem' | 'jpLayout' | 'jpNavigation' | 'author'
    | 'affiliate' | 'speechBubble'
    | 'newsMedia' | 'ecSite' | 'qaSite' | 'videoSite'
    | 'multiple' | 'none';

/**
 * AI要約クレンジングが除去した要素の統計
 *
 * BYTE totals and reason LABELS, never removal counts — kept in their own
 * field so a count and a byte size can never be read as the same unit.
 */
export interface AiSummaryRemovedStats {
    /** 単一的理由（reasons 配列が無い場合の主たる理由） */
    reason: AiSummaryCleansedReason;
    /** 複数理由（'multiple' のときに詳細を持つ） */
    reasons?: string[];
    elements: number;
    originalBytes: number;
    cleansedBytes: number;
}

/**
 * 除去件数の構造化された表現
 *
 * WHY two fields instead of one map: the popup used to merge the per-rule
 * counts of `cleanseStats` with the byte totals and reason labels of
 * `aiSummaryCleansedStats` into a single `Record<string, number>` through an
 * `as unknown as` cast, so the dashboard's Reason column printed byte counts
 * as if they were removal counts (`aiSummaryOriginalBytes:31204`).
 */
export interface RemovedCounts {
    byReason: Record<string, number>;
    aiSummary?: AiSummaryRemovedStats;
}

function toCount(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toCleansedReason(value: unknown): AiSummaryCleansedReason {
    return typeof value === 'string' && value.length > 0
        ? (value as AiSummaryCleansedReason)
        : 'none';
}

function toReasonList(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const reasons = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
    return reasons.length > 0 ? reasons : undefined;
}

/**
 * GET_CONTENT の応答から除去件数を合成する（純粋関数）
 *
 * The two response fields carry different units, so they land in different
 * fields: nothing can overwrite anything, and the caller can store only the
 * count side without dragging byte sizes along.
 */
export function buildRemovedCounts(
    cleanseStats?: ContentResponse['cleanseStats'],
    aiSummaryCleansedStats?: ContentResponse['aiSummaryCleansedStats'],
): RemovedCounts {
    const counts: RemovedCounts = { byReason: cleanseStats ? { ...cleanseStats } : {} };
    if (aiSummaryCleansedStats) {
        const reasons = aiSummaryCleansedStats.aiSummaryCleansedReasons
            ? [...aiSummaryCleansedStats.aiSummaryCleansedReasons]
            : undefined;
        counts.aiSummary = {
            reason: aiSummaryCleansedStats.aiSummaryCleansedReason,
            ...(reasons ? { reasons } : {}),
            elements: aiSummaryCleansedStats.aiSummaryCleansedElements,
            originalBytes: aiSummaryCleansedStats.aiSummaryOriginalBytes,
            cleansedBytes: aiSummaryCleansedStats.aiSummaryCleansedBytes,
        };
    }
    return counts;
}

/**
 * 保存済みの wire エントリ（`removedByReason: Record<string, number>`）を
 * `RemovedCounts` に読み戻す
 *
 * WHY: entries saved before the split carry `aiSummary*` byte totals, a reason
 * string and a reason array inside the number map. The wire shape is fixed, so
 * the routing has to happen on read — here, not in the view, so the knowledge
 * of which keys are counts stays in one place.
 */
export function readRemovedCounts(removedByReason: Readonly<Record<string, unknown>>): RemovedCounts {
    const byReason: Record<string, number> = {};
    const aiSummary: AiSummaryRemovedStats = {
        reason: 'none',
        elements: 0,
        originalBytes: 0,
        cleansedBytes: 0,
    };
    let hasAiSummary = false;

    for (const [key, value] of Object.entries(removedByReason)) {
        switch (key) {
            case 'aiSummaryOriginalBytes':
                aiSummary.originalBytes = toCount(value);
                hasAiSummary = true;
                break;
            case 'aiSummaryCleansedBytes':
                aiSummary.cleansedBytes = toCount(value);
                hasAiSummary = true;
                break;
            case 'aiSummaryCleansedElements':
                aiSummary.elements = toCount(value);
                hasAiSummary = true;
                break;
            case 'aiSummaryCleansedReason':
                aiSummary.reason = toCleansedReason(value);
                hasAiSummary = true;
                break;
            case 'aiSummaryCleansedReasons': {
                const reasons = toReasonList(value);
                if (reasons) aiSummary.reasons = reasons;
                hasAiSummary = true;
                break;
            }
            default:
                if (typeof value === 'number' && Number.isFinite(value)) byReason[key] = value;
        }
    }

    return hasAiSummary ? { byReason, aiSummary } : { byReason };
}