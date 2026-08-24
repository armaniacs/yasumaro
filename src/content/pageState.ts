/**
 * pageState.ts
 * Encapsulates content-script-scoped mutable state that was previously
 * held as module-level `let` bindings in extractor.ts. One instance is
 * created per content script injection (see extractor.ts bottom), and
 * tests create a fresh instance per case instead of resetting globals.
 */

import type { AiSummaryCleansedReason } from '../utils/commonTypes.js';
import type { RuleKey } from '../utils/aiSummaryCleaner/types.js';
import { CLEANSING_RULES, THRESHOLD_RULES } from '../utils/aiSummaryCleaner/rules.js';
import type { ThresholdProp } from '../utils/aiSummaryCleaner/rules.js';

// 【設定定数】: デフォルト値の定義
const DEFAULT_MIN_VISIT_DURATION = 5; // 秒
const DEFAULT_MIN_SCROLL_DEPTH = 50;   // パーセンテージ

// ---------------------------------------------------------------------------
// Rule-derived flags: aiSummaryCleansing${Capitalize<RuleKey>}
// ---------------------------------------------------------------------------

type CleansingConfigRuleFlags = {
    [K in RuleKey as `aiSummaryCleansing${Capitalize<K>}`]: boolean;
};

// 【クレンジング設定】: コンテンツクレンジングとAI要約クレンジングの設定を一括管理
// ThresholdProp (7 numeric thresholds) is intersected so that cfg[t.prop] is type-safe
// without unsafe casts in extractor.ts. Fixed fields exclude the 7 threshold
// props to avoid duplicate-key declarations.
export interface CleansingConfig extends CleansingConfigRuleFlags, Record<ThresholdProp, number> {
    contentStripHardEnabled: boolean;
    contentStripKeywordEnabled: boolean;
    contentStripKeywords: string[];
    aiSummaryCleansingEnabled: boolean;
    whitelistExtractionEnabled: boolean;
    aiSummaryCleansingCustomPatterns: string[];
    contentDedupEnabled: boolean;
}

/**
 * Rule-flag defaults for the placeholder config used before loadSettings()
 * resolves. init() always awaits loadSettings() before anything can read
 * cleansingConfig for a real extraction, so this only needs to match
 * `defaultEnabled` (the "no value specified yet" fallback), not the
 * new-user storage default — see pbi/2026-08-09-20.
 * Keep in sync with SettingsRepository.getCleansingConfig() (PBI-05) —
 * both derive from CLEANSING_RULES; a detector test compares the two seams.
 */
const CLEANSING_RULE_PLACEHOLDER_DEFAULTS: CleansingConfigRuleFlags = Object.fromEntries(
    CLEANSING_RULES.map(rule => [
        `aiSummaryCleansing${rule.key.charAt(0).toUpperCase()}${rule.key.slice(1)}`,
        rule.defaultEnabled,
    ]),
) as CleansingConfigRuleFlags;

// Keep in sync with SettingsRepository.getThresholds() / THRESHOLD_RULES_FACADE (PBI-05).
// Exported for detector tests that verify pageState defaults == facade defaults
// via the shared THRESHOLD_RULES source of truth.
export const THRESHOLD_CONFIG_DEFAULTS: Record<ThresholdProp, number> = Object.fromEntries(
    THRESHOLD_RULES.map(r => [r.prop, r.default]),
) as Record<ThresholdProp, number>;

// Keep THRESHOLD fields in sync with SettingsRepository.getThresholds() (PBI-05 facade).
export const DEFAULT_CLEANSING_CONFIG: CleansingConfig = {
    contentStripHardEnabled: true,
    contentStripKeywordEnabled: true,
    contentStripKeywords: ['balance', 'account', 'meisai', 'login', 'card-number', 'keiyaku', 'password', 'payment', 'transaction', 'billing', 'invoice', 'receipt', 'rireki', 'torihiki', 'zandaka', 'hoken', 'address'],
    aiSummaryCleansingEnabled: true,
    whitelistExtractionEnabled: true,
    aiSummaryCleansingLinkRatioThreshold: THRESHOLD_CONFIG_DEFAULTS.aiSummaryCleansingLinkRatioThreshold,
    aiSummaryCleansingShortTextThreshold: THRESHOLD_CONFIG_DEFAULTS.aiSummaryCleansingShortTextThreshold,
    aiSummaryCleansingShortSeqCount: THRESHOLD_CONFIG_DEFAULTS.aiSummaryCleansingShortSeqCount,
    aiSummaryCleansingLinkParaThreshold: THRESHOLD_CONFIG_DEFAULTS.aiSummaryCleansingLinkParaThreshold,
    aiSummaryCleansingCustomPatterns: [],
    aiSummaryCleansingFallbackRatio: THRESHOLD_CONFIG_DEFAULTS.aiSummaryCleansingFallbackRatio,
    aiSummaryCleansingFallbackMinBytes: THRESHOLD_CONFIG_DEFAULTS.aiSummaryCleansingFallbackMinBytes,
    contentDedupEnabled: true,
    contentDedupThreshold: THRESHOLD_CONFIG_DEFAULTS.contentDedupThreshold,
    ...CLEANSING_RULE_PLACEHOLDER_DEFAULTS,
};

export class PageState {
    // 【訪問状態】: スクロール深度や訪問時間の監視に使用
    minVisitDuration: number = DEFAULT_MIN_VISIT_DURATION;
    minScrollDepth: number = DEFAULT_MIN_SCROLL_DEPTH;
    startTime: number = Date.now();
    maxScrollPercentage: number = 0;
    isValidVisitReported: boolean = false;
    checkIntervalId: number | null = null;

    /**
     * VisitGate 注入用の thresholds を返す純粋ヘルパー。
     * extractor.init() / checkVisitConditions が VisitGate 生成時に利用する。
     */
    toVisitGateThresholds(): { minDuration: number; minScroll: number } {
        return { minDuration: this.minVisitDuration, minScroll: this.minScrollDepth };
    }

    /**
     * VisitGate.isReportable に渡す VisitState を返す純粋ヘルパー。
     */
    toVisitState(): { startTime: number; maxScrollPercentage: number; isValidVisitReported: boolean } {
        return {
            startTime: this.startTime,
            maxScrollPercentage: this.maxScrollPercentage,
            isValidVisitReported: this.isValidVisitReported,
        };
    }

    // 【クレンジング設定】: コンテンツクレンジングとAI要約クレンジングの設定を一括管理
    cleansingConfig: CleansingConfig = { ...DEFAULT_CLEANSING_CONFIG };

    // 【クレンジング情報】: 直近の抽出で適用されたクレンジング情報を保持
    lastCleansedReason: 'hard' | 'keyword' | 'both' | 'none' = 'none';
    lastCleanseStats: { hardStripRemoved: number; keywordStripRemoved: number; totalRemoved: number } = {
        hardStripRemoved: 0,
        keywordStripRemoved: 0,
        totalRemoved: 0
    };

    // 【バイト数情報】: 直近の抽出で適用されたバイト数情報を保持
    lastByteStats: { pageBytes: number; candidateBytes: number; originalBytes: number; cleansedBytes: number } = {
        pageBytes: 0,
        candidateBytes: 0,
        originalBytes: 0,
        cleansedBytes: 0
    };

    // 【AI要約クレンジング情報】: 直近の抽出で適用されたAI要約クレンジング情報を保持
    lastAiSummaryCleansedStats: {
        aiSummaryOriginalBytes: number;
        aiSummaryCleansedBytes: number;
        aiSummaryCleansedElements: number;
        aiSummaryCleansedReason: AiSummaryCleansedReason;
        aiSummaryCleansedReasons?: string[];
    } = {
        aiSummaryOriginalBytes: 0,
        aiSummaryCleansedBytes: 0,
        aiSummaryCleansedElements: 0,
        aiSummaryCleansedReason: 'none'
    };

    // 【フォールバック情報】: 直近の抽出でフォールバックが発動したかを保持
    lastFallbackTriggered: boolean = false;
}
