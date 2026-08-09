/**
 * pageState.ts
 * Encapsulates content-script-scoped mutable state that was previously
 * held as module-level `let` bindings in extractor.ts. One instance is
 * created per content script injection (see extractor.ts bottom), and
 * tests create a fresh instance per case instead of resetting globals.
 */

import type { AiSummaryCleansedReason } from '../utils/commonTypes.js';
import { CLEANSING_RULES } from '../utils/aiSummaryCleaner/rules.js';

// 【設定定数】: デフォルト値の定義
const DEFAULT_MIN_VISIT_DURATION = 5; // 秒
const DEFAULT_MIN_SCROLL_DEPTH = 50;   // パーセンテージ

// 【クレンジング設定】: コンテンツクレンジングとAI要約クレンジングの設定を一括管理
export interface CleansingConfig {
    contentStripHardEnabled: boolean;
    contentStripKeywordEnabled: boolean;
    contentStripKeywords: string[];
    aiSummaryCleansingEnabled: boolean;
    aiSummaryCleansingAlt: boolean;
    aiSummaryCleansingMetadata: boolean;
    aiSummaryCleansingAds: boolean;
    aiSummaryCleansingNav: boolean;
    aiSummaryCleansingSocial: boolean;
    aiSummaryCleansingDeep: boolean;
    aiSummaryCleansingJsonLd: boolean;
    aiSummaryCleansingLazyLoad: boolean;
    aiSummaryCleansingSkipLink: boolean;
    aiSummaryCleansingCard: boolean;
    aiSummaryCleansingLinkDensity: boolean;
    aiSummaryCleansingFixed: boolean;
    aiSummaryCleansingRecommend: boolean;
    aiSummaryCleansingPagination: boolean;
    aiSummaryCleansingSnsPromo: boolean;
    aiSummaryCleansingPopup: boolean;
    aiSummaryCleansingPlatform: boolean;
    aiSummaryCleansingTextDensity: boolean;
    aiSummaryCleansingShortSeq: boolean;
    aiSummaryCleansingSymbolLine: boolean;
    aiSummaryCleansingLinkPara: boolean;
    aiSummaryCleansingEnhancedHidden: boolean;
    aiSummaryCleansingEmptyElem: boolean;
    aiSummaryCleansingJpLayout: boolean;
    aiSummaryCleansingJpNavigation: boolean;
    aiSummaryCleansingAuthor: boolean;
    aiSummaryCleansingAffiliate: boolean;
    aiSummaryCleansingSpeechBubble: boolean;
    aiSummaryCleansingNewsMedia: boolean;
    aiSummaryCleansingEcSite: boolean;
    aiSummaryCleansingQaSite: boolean;
    aiSummaryCleansingVideoSite: boolean;
    whitelistExtractionEnabled: boolean;
    aiSummaryCleansingLinkRatioThreshold: number;
    aiSummaryCleansingShortTextThreshold: number;
    aiSummaryCleansingShortSeqCount: number;
    aiSummaryCleansingLinkParaThreshold: number;
    aiSummaryCleansingCustomPatterns: string[];
    // Over-cleansed fallback thresholds
    aiSummaryCleansingFallbackRatio: number;
    aiSummaryCleansingFallbackMinBytes: number;
    contentDedupEnabled: boolean;
    contentDedupThreshold: number;
}

/**
 * Rule-flag defaults for the placeholder config used before loadSettings()
 * resolves. init() always awaits loadSettings() before anything can read
 * cleansingConfig for a real extraction, so this only needs to match
 * `defaultEnabled` (the "no value specified yet" fallback), not the
 * new-user storage default — see pbi/2026-08-09-20.
 */
const CLEANSING_RULE_PLACEHOLDER_DEFAULTS = Object.fromEntries(
    CLEANSING_RULES.map(rule => [
        `aiSummaryCleansing${rule.key.charAt(0).toUpperCase()}${rule.key.slice(1)}`,
        rule.defaultEnabled,
    ]),
) as Record<string, boolean>;

export const DEFAULT_CLEANSING_CONFIG: CleansingConfig = {
    contentStripHardEnabled: true,
    contentStripKeywordEnabled: true,
    contentStripKeywords: ['balance', 'account', 'meisai', 'login', 'card-number', 'keiyaku', 'password', 'payment', 'transaction', 'billing', 'invoice', 'receipt', 'rireki', 'torihiki', 'zandaka', 'hoken', 'address'],
    aiSummaryCleansingEnabled: true,
    whitelistExtractionEnabled: true,
    aiSummaryCleansingLinkRatioThreshold: 70,
    aiSummaryCleansingShortTextThreshold: 30,
    aiSummaryCleansingShortSeqCount: 5,
    aiSummaryCleansingLinkParaThreshold: 50,
    aiSummaryCleansingCustomPatterns: [],
    aiSummaryCleansingFallbackRatio: 0.20,
    aiSummaryCleansingFallbackMinBytes: 300,
    contentDedupEnabled: true,
    contentDedupThreshold: 0.7,
    // The 32 rule flags are derived below rather than listed individually —
    // see CLEANSING_RULE_PLACEHOLDER_DEFAULTS above. Completeness (every
    // CleansingConfig rule property present) is checked at runtime by
    // pageState.test.ts rather than statically: the derived object's type
    // is a plain Record<string, boolean>, which TypeScript cannot narrow
    // back to the named union of 32 specific keys.
    ...CLEANSING_RULE_PLACEHOLDER_DEFAULTS,
} as unknown as CleansingConfig;

export class PageState {
    // 【訪問状態】: スクロール深度や訪問時間の監視に使用
    minVisitDuration: number = DEFAULT_MIN_VISIT_DURATION;
    minScrollDepth: number = DEFAULT_MIN_SCROLL_DEPTH;
    startTime: number = Date.now();
    maxScrollPercentage: number = 0;
    isValidVisitReported: boolean = false;
    checkIntervalId: number | null = null;

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
