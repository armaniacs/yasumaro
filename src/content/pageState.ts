/**
 * pageState.ts
 * Encapsulates content-script-scoped mutable state that was previously
 * held as module-level `let` bindings in extractor.ts. One instance is
 * created per content script injection (see extractor.ts bottom), and
 * tests create a fresh instance per case instead of resetting globals.
 */

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

export const DEFAULT_CLEANSING_CONFIG: CleansingConfig = {
    contentStripHardEnabled: true,
    contentStripKeywordEnabled: true,
    contentStripKeywords: ['balance', 'account', 'meisai', 'login', 'card-number', 'keiyaku', 'password', 'payment', 'transaction', 'billing', 'invoice', 'receipt', 'rireki', 'torihiki', 'zandaka', 'hoken', 'address'],
    aiSummaryCleansingEnabled: true,
    aiSummaryCleansingAlt: true,
    aiSummaryCleansingMetadata: true,
    aiSummaryCleansingAds: true,
    aiSummaryCleansingNav: true,
    aiSummaryCleansingSocial: true,
    aiSummaryCleansingDeep: false,
    aiSummaryCleansingJsonLd: false,
    aiSummaryCleansingLazyLoad: false,
    aiSummaryCleansingSkipLink: false,
    aiSummaryCleansingCard: false,
    aiSummaryCleansingLinkDensity: false,
    aiSummaryCleansingFixed: false,
    aiSummaryCleansingRecommend: true,
    aiSummaryCleansingPagination: false,
    aiSummaryCleansingSnsPromo: false,
    aiSummaryCleansingPopup: true,
    aiSummaryCleansingPlatform: false,
    aiSummaryCleansingTextDensity: false,
    aiSummaryCleansingShortSeq: false,
    aiSummaryCleansingSymbolLine: false,
    aiSummaryCleansingLinkPara: false,
    aiSummaryCleansingEnhancedHidden: false,
    aiSummaryCleansingEmptyElem: false,
    aiSummaryCleansingJpLayout: false,
    aiSummaryCleansingJpNavigation: false,
    aiSummaryCleansingAuthor: false,
    aiSummaryCleansingAffiliate: false,
    aiSummaryCleansingSpeechBubble: false,
    aiSummaryCleansingNewsMedia: true,
    aiSummaryCleansingEcSite: true,
    aiSummaryCleansingQaSite: true,
    aiSummaryCleansingVideoSite: true,
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
};

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
        aiSummaryCleansedReason: 'alt' | 'metadata' | 'ads' | 'nav' | 'social' | 'deep' | 'multiple' | 'none';
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
