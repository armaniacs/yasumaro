/**
 * extractor.ts
 * 【機能概要】: Webページのコンテンツを抽出し、スクロール深度や訪問時間を監視するコンテントスクリプト
 * 【設計方針】: ページの読み込み後に設定を取得し、条件を満たした場合に自動記録を実行
 * 【監視対象】:
 *   - 最小訪問時間（デフォルト: 5秒）
 *   - 最小スクロール深度（デフォルト: 50%）
 * 🟢
 */

import { createSender } from '../utils/retryHelper.js';
import { reasonToStatusCode, statusCodeToMessageKey } from '../utils/privacyStatusCodes.js';
import { extractMainContent } from '../utils/contentExtractor.js';
import { logInfo, logWarn, logError, logDebug, ErrorCode } from '../utils/logger.js';

// StorageKeys（content script で使用するもののみ）
const CONTENT_STRIP_HARD_ENABLED = 'content_strip_hard_enabled';
const CONTENT_STRIP_KEYWORD_ENABLED = 'content_strip_keyword_enabled';
const CONTENT_STRIP_KEYWORDS = 'content_strip_keywords';
const AI_SUMMARY_CLEANSING_ENABLED = 'ai_summary_cleansing_enabled';
const AI_SUMMARY_CLEANSING_ALT = 'ai_summary_cleansing_alt';
const AI_SUMMARY_CLEANSING_METADATA = 'ai_summary_cleansing_metadata';
const AI_SUMMARY_CLEANSING_ADS = 'ai_summary_cleansing_ads';
const AI_SUMMARY_CLEANSING_NAV = 'ai_summary_cleansing_nav';
const AI_SUMMARY_CLEANSING_SOCIAL = 'ai_summary_cleansing_social';
const AI_SUMMARY_CLEANSING_DEEP = 'ai_summary_cleansing_deep';
const AI_SUMMARY_CLEANSING_JSON_LD = 'ai_summary_cleansing_json_ld';
const AI_SUMMARY_CLEANSING_LAZY_LOAD = 'ai_summary_cleansing_lazy_load';
const AI_SUMMARY_CLEANSING_SKIP_LINK = 'ai_summary_cleansing_skip_link';
const AI_SUMMARY_CLEANSING_CARD = 'ai_summary_cleansing_card';
const AI_SUMMARY_CLEANSING_LINK_DENSITY = 'ai_summary_cleansing_link_density';
// NEW: 6つの新しいストレージキー
const AI_SUMMARY_CLEANSING_FIXED = 'ai_summary_cleansing_fixed';
const AI_SUMMARY_CLEANSING_RECOMMEND = 'ai_summary_cleansing_recommend';
const AI_SUMMARY_CLEANSING_PAGINATION = 'ai_summary_cleansing_pagination';
const AI_SUMMARY_CLEANSING_SNS_PROMO = 'ai_summary_cleansing_sns_promo';
const AI_SUMMARY_CLEANSING_POPUP = 'ai_summary_cleansing_popup';
const AI_SUMMARY_CLEANSING_PLATFORM = 'ai_summary_cleansing_platform';
// NEW: 9つの追加ストレージキー
const AI_SUMMARY_CLEANSING_TEXT_DENSITY = 'ai_summary_cleansing_text_density';
const AI_SUMMARY_CLEANSING_SHORT_SEQ = 'ai_summary_cleansing_short_seq';
const AI_SUMMARY_CLEANSING_SYMBOL_LINE = 'ai_summary_cleansing_symbol_line';
const AI_SUMMARY_CLEANSING_LINK_PARA = 'ai_summary_cleansing_link_para';
const AI_SUMMARY_CLEANSING_ENHANCED_HIDDEN = 'ai_summary_cleansing_enhanced_hidden';
const AI_SUMMARY_CLEANSING_EMPTY_ELEM = 'ai_summary_cleansing_empty_elem';
const AI_SUMMARY_CLEANSING_JP_LAYOUT = 'ai_summary_cleansing_jp_layout';
const AI_SUMMARY_CLEANSING_JP_NAVIGATION = 'ai_summary_cleansing_jp_navigation';
const AI_SUMMARY_CLEANSING_AUTHOR = 'ai_summary_cleansing_author';
// Threshold settings
const AI_SUMMARY_CLEANSING_LINK_RATIO_THRESHOLD = 'ai_summary_cleansing_link_ratio_threshold';
const AI_SUMMARY_CLEANSING_SHORT_TEXT_THRESHOLD = 'ai_summary_cleansing_short_text_threshold';
const AI_SUMMARY_CLEANSING_SHORT_SEQ_COUNT = 'ai_summary_cleansing_short_seq_count';
const AI_SUMMARY_CLEANSING_LINK_PARA_THRESHOLD = 'ai_summary_cleansing_link_para_threshold';
// Custom patterns
const AI_SUMMARY_CLEANSING_CUSTOM_PATTERNS = 'ai_summary_cleansing_custom_patterns';
const CONTENT_DEDUP_ENABLED = 'content_dedup_enabled';
const CONTENT_DEDUP_THRESHOLD = 'content_dedup_threshold';

// 【設定定数】: デフォルト値の定義
const DEFAULT_MIN_VISIT_DURATION = 5; // 秒
const DEFAULT_MIN_SCROLL_DEPTH = 50;   // パーセンテージ

// 【状態管理】: スクリプトの実行状態を管理
let minVisitDuration = DEFAULT_MIN_VISIT_DURATION;
let minScrollDepth = DEFAULT_MIN_SCROLL_DEPTH;
let startTime = Date.now();
let maxScrollPercentage = 0;
let isValidVisitReported = false;
let checkIntervalId: number | NodeJS.Timeout | null = null; // 【パフォーマンス向上】: 定期実行のIDを管理し、条件満了後に停止

// 【クレンジング設定】: コンテンツクレンジングの有効化状態を管理
let contentStripHardEnabled = true;
let contentStripKeywordEnabled = true;
let contentStripKeywords: string[] = ['balance', 'account', 'meisai', 'login', 'card-number', 'keiyaku', 'password', 'payment', 'transaction', 'billing', 'invoice', 'receipt', 'rireki', 'torihiki', 'zandaka', 'hoken', 'address'];

// 【AI要約クレンジング設定】: AI要約クレンジングの有効化状態を管理
let aiSummaryCleansingEnabled = true;
let aiSummaryCleansingAlt = true;
let aiSummaryCleansingMetadata = true;
let aiSummaryCleansingAds = true;
let aiSummaryCleansingNav = true;
let aiSummaryCleansingSocial = true;
let aiSummaryCleansingDeep = false;
let aiSummaryCleansingJsonLd = false;
let aiSummaryCleansingLazyLoad = false;
let aiSummaryCleansingSkipLink = false;
let aiSummaryCleansingCard = false;
let aiSummaryCleansingLinkDensity = false;
// NEW: 6つの新しいクレンジングオプション
let aiSummaryCleansingFixed = false;
let aiSummaryCleansingRecommend = true;
let aiSummaryCleansingPagination = false;
let aiSummaryCleansingSnsPromo = false;
let aiSummaryCleansingPopup = true;
let aiSummaryCleansingPlatform = false;
// NEW: 9つの追加クレンジングオプション
let aiSummaryCleansingTextDensity = false;
let aiSummaryCleansingShortSeq = false;
let aiSummaryCleansingSymbolLine = false;
let aiSummaryCleansingLinkPara = false;
let aiSummaryCleansingEnhancedHidden = false;
let aiSummaryCleansingEmptyElem = false;
let aiSummaryCleansingJpLayout = false;
let aiSummaryCleansingJpNavigation = false;
let aiSummaryCleansingAuthor = false;
// Threshold settings
let aiSummaryCleansingLinkRatioThreshold = 70;
let aiSummaryCleansingShortTextThreshold = 30;
let aiSummaryCleansingShortSeqCount = 5;
let aiSummaryCleansingLinkParaThreshold = 50;
// Custom patterns
let aiSummaryCleansingCustomPatterns: string[] = [];

// 【テキスト品質設定】: 冗長除去の有効化状態
let contentDedupEnabled = true;
let contentDedupThreshold = 0.7;

// 【クレンジング情報】: 直近の抽出で適用されたクレンジング情報を保持
export let lastCleansedReason: 'hard' | 'keyword' | 'both' | 'none' = 'none';
export let lastCleanseStats: { hardStripRemoved: number; keywordStripRemoved: number; totalRemoved: number } = {
    hardStripRemoved: 0,
    keywordStripRemoved: 0,
    totalRemoved: 0
};
// 【バイト数情報】: 直近の抽出で適用されたバイト数情報を保持
export let lastByteStats: { pageBytes: number; candidateBytes: number; originalBytes: number; cleansedBytes: number } = {
    pageBytes: 0,
    candidateBytes: 0,
    originalBytes: 0,
    cleansedBytes: 0
};
// 【AI要約クレンジング情報】: 直近の抽出で適用されたAI要約クレンジング情報を保持
export let lastAiSummaryCleansedStats: { aiSummaryOriginalBytes: number; aiSummaryCleansedBytes: number; aiSummaryCleansedElements: number; aiSummaryCleansedReason: 'alt' | 'metadata' | 'ads' | 'nav' | 'social' | 'deep' | 'multiple' | 'none'; aiSummaryCleansedReasons?: string[] } = {
    aiSummaryOriginalBytes: 0,
    aiSummaryCleansedBytes: 0,
    aiSummaryCleansedElements: 0,
    aiSummaryCleansedReason: 'none'
};

// モジュールレベルでリトライ付き送信者を作成
const messageSender = createSender({ maxRetries: 2, initialDelay: 50 });

/**
 * コンテンツを抽出する共通関数
 * 【機能概要】: ページの本文テキスト（メインコンテンツ）を抽出し、空白文字を正規化する
 * 【抽出範囲】: メインコンテンツ（ナビゲーション、ヘッダー等除外、最大10,000文字）
 * 【処理内容】:
 *   1. メインコンテンツ（article/mainタグ等優先）を抽出
 *   2. 連続する空白文字を単一のスペースに置換
 *   3. 前後の空白を削除
 *   4. 最大10,000文字で切り詰め
 * 【改善点】: Readabilityアルゴリズムでナビゲーション等のノイズを除外
 * 【クレンジング】: 設定に従って機密情報を含む要素を削除
 * 🟢
 * @returns {string} - 抽出されたコンテンツ（最大10,000文字）
 */
function extractPageContent(): string {
    const cleanseOptions = {
        cleanseEnabled: contentStripHardEnabled || contentStripKeywordEnabled,
        hardStripEnabled: contentStripHardEnabled,
        keywordStripEnabled: contentStripKeywordEnabled,
        keywords: contentStripKeywords,
        returnInfo: true
    };
    // AI要約クレンジングオプション（ストレージから取得）
    const aiSummaryCleanseOptions = {
        aiSummaryCleanseEnabled: aiSummaryCleansingEnabled,
        altEnabled: aiSummaryCleansingAlt,
        metadataEnabled: aiSummaryCleansingMetadata,
        adsEnabled: aiSummaryCleansingAds,
        navEnabled: aiSummaryCleansingNav,
        socialEnabled: aiSummaryCleansingSocial,
        deepEnabled: aiSummaryCleansingDeep,
        jsonLdEnabled: aiSummaryCleansingJsonLd,
        lazyLoadEnabled: aiSummaryCleansingLazyLoad,
        skipLinkEnabled: aiSummaryCleansingSkipLink,
        cardEnabled: aiSummaryCleansingCard,
        linkDensityEnabled: aiSummaryCleansingLinkDensity,
        // NEW: 6つの新しいクレンジングオプション
        fixedEnabled: aiSummaryCleansingFixed,
        recommendEnabled: aiSummaryCleansingRecommend,
        paginationEnabled: aiSummaryCleansingPagination,
        snsPromoEnabled: aiSummaryCleansingSnsPromo,
        popupEnabled: aiSummaryCleansingPopup,
        platformEnabled: aiSummaryCleansingPlatform,
        // NEW: 9つの追加クレンジングオプション
        textDensityEnabled: aiSummaryCleansingTextDensity,
        shortSeqEnabled: aiSummaryCleansingShortSeq,
        symbolLineEnabled: aiSummaryCleansingSymbolLine,
        linkParaEnabled: aiSummaryCleansingLinkPara,
        enhancedHiddenEnabled: aiSummaryCleansingEnhancedHidden,
        emptyElemEnabled: aiSummaryCleansingEmptyElem,
        jpLayoutEnabled: aiSummaryCleansingJpLayout,
        jpNavigationEnabled: aiSummaryCleansingJpNavigation,
        authorEnabled: aiSummaryCleansingAuthor,
        // Threshold settings
        linkRatioThreshold: aiSummaryCleansingLinkRatioThreshold,
        shortTextThreshold: aiSummaryCleansingShortTextThreshold,
        shortSeqCount: aiSummaryCleansingShortSeqCount,
        linkParaThreshold: aiSummaryCleansingLinkParaThreshold,
        // Custom patterns
        customPatterns: aiSummaryCleansingCustomPatterns
    };
    // テキスト品質設定（冗長除去）
    const dedupOptions = {
        dedupEnabled: contentDedupEnabled,
        dedupThreshold: contentDedupThreshold
    };
    const result = extractMainContent(10000, cleanseOptions, aiSummaryCleanseOptions, dedupOptions);
    // クレンジング情報を保存
    if (typeof result === 'object' && 'cleansedReason' in result) {
        lastCleansedReason = result.cleansedReason || 'none';
        lastCleanseStats = {
            hardStripRemoved: result.hardStripRemoved ?? 0,
            keywordStripRemoved: result.keywordStripRemoved ?? 0,
            totalRemoved: result.totalRemoved ?? 0
        };
        // バイト数情報を保存
        lastByteStats = {
            pageBytes: result.pageBytes ?? 0,
            candidateBytes: result.candidateBytes ?? 0,
            originalBytes: result.originalBytes ?? 0,
            cleansedBytes: result.cleansedBytes ?? 0
        };
        // AI要約クレンジング情報を保存
        lastAiSummaryCleansedStats = {
            aiSummaryOriginalBytes: result.aiSummaryOriginalBytes ?? 0,
            aiSummaryCleansedBytes: result.aiSummaryCleansedBytes ?? 0,
            aiSummaryCleansedElements: result.aiSummaryCleansedElements ?? 0,
            aiSummaryCleansedReason: result.aiSummaryCleansedReason ?? 'none',
            aiSummaryCleansedReasons: result.aiSummaryCleansedReasons
        };
    }
    return typeof result === 'string' ? result : result.content;
}

/**
 * 設定をロードする
 * 【機能概要】: chrome.storage.localから設定を読み込む
 * 【読み込みタイミング】: スクリプト読み込み時（Chrome拡張のコンテントスクリプト読み込み時）
 * 【デフォルト値】: MIN_VISIT_DURATION=5秒, MIN_SCROLL_DEPTH=50%
 * 【マイグレーション対応】: settingsキー下から値を取得（マイグレーション後の構造に対応）
 * 🟢
 */
function loadSettings(): Promise<void> {
    return new Promise((resolve) => {
        // 新方式（settings オブジェクト）と旧方式（フラットキー）の両方を取得
        chrome.storage.local.get([
            'settings',
            'settings_migrated',
            'min_visit_duration',
            'min_scroll_depth',
            CONTENT_STRIP_HARD_ENABLED,
            CONTENT_STRIP_KEYWORD_ENABLED,
            CONTENT_STRIP_KEYWORDS,
            AI_SUMMARY_CLEANSING_ENABLED,
            AI_SUMMARY_CLEANSING_ALT,
            AI_SUMMARY_CLEANSING_METADATA,
            AI_SUMMARY_CLEANSING_ADS,
            AI_SUMMARY_CLEANSING_NAV,
            AI_SUMMARY_CLEANSING_SOCIAL,
            AI_SUMMARY_CLEANSING_DEEP,
            AI_SUMMARY_CLEANSING_JSON_LD,
            AI_SUMMARY_CLEANSING_LAZY_LOAD,
            AI_SUMMARY_CLEANSING_SKIP_LINK,
            AI_SUMMARY_CLEANSING_CARD,
            AI_SUMMARY_CLEANSING_LINK_DENSITY,
            CONTENT_DEDUP_ENABLED,
            CONTENT_DEDUP_THRESHOLD
        ], (result: { [key: string]: any }) => {
            // 新方式: settings オブジェクトが存在する場合はそちらを優先
            const s: { [key: string]: any } = (result.settings_migrated && result.settings)
                ? { ...result.settings, ...result }
                : result;

            if (s.min_visit_duration !== undefined) {
                minVisitDuration = parseInt(String(s.min_visit_duration), 10);
            }
            if (s.min_scroll_depth !== undefined) {
                minScrollDepth = parseInt(String(s.min_scroll_depth), 10);
            }
            // クレンジング設定を取得
            if (s[CONTENT_STRIP_HARD_ENABLED] !== undefined) {
                contentStripHardEnabled = s[CONTENT_STRIP_HARD_ENABLED];
            }
            if (s[CONTENT_STRIP_KEYWORD_ENABLED] !== undefined) {
                contentStripKeywordEnabled = s[CONTENT_STRIP_KEYWORD_ENABLED];
            }
            if (s[CONTENT_STRIP_KEYWORDS] !== undefined && Array.isArray(s[CONTENT_STRIP_KEYWORDS])) {
                contentStripKeywords = s[CONTENT_STRIP_KEYWORDS];
            }
            // AI要約クレンジング設定を取得
            if (s[AI_SUMMARY_CLEANSING_ENABLED] !== undefined) {
                aiSummaryCleansingEnabled = s[AI_SUMMARY_CLEANSING_ENABLED];
            }
            if (s[AI_SUMMARY_CLEANSING_ALT] !== undefined) {
                aiSummaryCleansingAlt = s[AI_SUMMARY_CLEANSING_ALT];
            }
            if (s[AI_SUMMARY_CLEANSING_METADATA] !== undefined) {
                aiSummaryCleansingMetadata = s[AI_SUMMARY_CLEANSING_METADATA];
            }
            if (s[AI_SUMMARY_CLEANSING_ADS] !== undefined) {
                aiSummaryCleansingAds = s[AI_SUMMARY_CLEANSING_ADS];
            }
            if (s[AI_SUMMARY_CLEANSING_NAV] !== undefined) {
                aiSummaryCleansingNav = s[AI_SUMMARY_CLEANSING_NAV];
            }
            if (s[AI_SUMMARY_CLEANSING_SOCIAL] !== undefined) {
                aiSummaryCleansingSocial = s[AI_SUMMARY_CLEANSING_SOCIAL];
            }
            if (s[AI_SUMMARY_CLEANSING_DEEP] !== undefined) {
                aiSummaryCleansingDeep = s[AI_SUMMARY_CLEANSING_DEEP];
            }
            if (s[AI_SUMMARY_CLEANSING_JSON_LD] !== undefined) {
                aiSummaryCleansingJsonLd = s[AI_SUMMARY_CLEANSING_JSON_LD];
            }
            if (s[AI_SUMMARY_CLEANSING_LAZY_LOAD] !== undefined) {
                aiSummaryCleansingLazyLoad = s[AI_SUMMARY_CLEANSING_LAZY_LOAD];
            }
            if (s[AI_SUMMARY_CLEANSING_SKIP_LINK] !== undefined) {
                aiSummaryCleansingSkipLink = s[AI_SUMMARY_CLEANSING_SKIP_LINK];
            }
            if (s[AI_SUMMARY_CLEANSING_CARD] !== undefined) {
                aiSummaryCleansingCard = s[AI_SUMMARY_CLEANSING_CARD];
            }
            if (s[AI_SUMMARY_CLEANSING_LINK_DENSITY] !== undefined) {
                aiSummaryCleansingLinkDensity = s[AI_SUMMARY_CLEANSING_LINK_DENSITY];
            }
            // NEW: 6つの新しいクレンジングオプション
            if (s[AI_SUMMARY_CLEANSING_FIXED] !== undefined) {
                aiSummaryCleansingFixed = s[AI_SUMMARY_CLEANSING_FIXED];
            }
            if (s[AI_SUMMARY_CLEANSING_RECOMMEND] !== undefined) {
                aiSummaryCleansingRecommend = s[AI_SUMMARY_CLEANSING_RECOMMEND];
            }
            if (s[AI_SUMMARY_CLEANSING_PAGINATION] !== undefined) {
                aiSummaryCleansingPagination = s[AI_SUMMARY_CLEANSING_PAGINATION];
            }
            if (s[AI_SUMMARY_CLEANSING_SNS_PROMO] !== undefined) {
                aiSummaryCleansingSnsPromo = s[AI_SUMMARY_CLEANSING_SNS_PROMO];
            }
            if (s[AI_SUMMARY_CLEANSING_POPUP] !== undefined) {
                aiSummaryCleansingPopup = s[AI_SUMMARY_CLEANSING_POPUP];
            }
            if (s[AI_SUMMARY_CLEANSING_PLATFORM] !== undefined) {
                aiSummaryCleansingPlatform = s[AI_SUMMARY_CLEANSING_PLATFORM];
            }
            // NEW: 9つの追加クレンジングオプション
            if (s[AI_SUMMARY_CLEANSING_TEXT_DENSITY] !== undefined) {
                aiSummaryCleansingTextDensity = s[AI_SUMMARY_CLEANSING_TEXT_DENSITY];
            }
            if (s[AI_SUMMARY_CLEANSING_SHORT_SEQ] !== undefined) {
                aiSummaryCleansingShortSeq = s[AI_SUMMARY_CLEANSING_SHORT_SEQ];
            }
            if (s[AI_SUMMARY_CLEANSING_SYMBOL_LINE] !== undefined) {
                aiSummaryCleansingSymbolLine = s[AI_SUMMARY_CLEANSING_SYMBOL_LINE];
            }
            if (s[AI_SUMMARY_CLEANSING_LINK_PARA] !== undefined) {
                aiSummaryCleansingLinkPara = s[AI_SUMMARY_CLEANSING_LINK_PARA];
            }
            if (s[AI_SUMMARY_CLEANSING_ENHANCED_HIDDEN] !== undefined) {
                aiSummaryCleansingEnhancedHidden = s[AI_SUMMARY_CLEANSING_ENHANCED_HIDDEN];
            }
            if (s[AI_SUMMARY_CLEANSING_EMPTY_ELEM] !== undefined) {
                aiSummaryCleansingEmptyElem = s[AI_SUMMARY_CLEANSING_EMPTY_ELEM];
            }
            if (s[AI_SUMMARY_CLEANSING_JP_LAYOUT] !== undefined) {
                aiSummaryCleansingJpLayout = s[AI_SUMMARY_CLEANSING_JP_LAYOUT];
            }
            if (s[AI_SUMMARY_CLEANSING_JP_NAVIGATION] !== undefined) {
                aiSummaryCleansingJpNavigation = s[AI_SUMMARY_CLEANSING_JP_NAVIGATION];
            }
            if (s[AI_SUMMARY_CLEANSING_AUTHOR] !== undefined) {
                aiSummaryCleansingAuthor = s[AI_SUMMARY_CLEANSING_AUTHOR];
            }
            // Threshold settings (with bounds validation)
            if (s[AI_SUMMARY_CLEANSING_LINK_RATIO_THRESHOLD] !== undefined) {
                aiSummaryCleansingLinkRatioThreshold = Math.max(0, Math.min(100, Number(s[AI_SUMMARY_CLEANSING_LINK_RATIO_THRESHOLD]) || 70));
            }
            if (s[AI_SUMMARY_CLEANSING_SHORT_TEXT_THRESHOLD] !== undefined) {
                aiSummaryCleansingShortTextThreshold = Math.max(1, Math.min(200, Number(s[AI_SUMMARY_CLEANSING_SHORT_TEXT_THRESHOLD]) || 30));
            }
            if (s[AI_SUMMARY_CLEANSING_SHORT_SEQ_COUNT] !== undefined) {
                aiSummaryCleansingShortSeqCount = Math.max(1, Math.min(20, Number(s[AI_SUMMARY_CLEANSING_SHORT_SEQ_COUNT]) || 5));
            }
            if (s[AI_SUMMARY_CLEANSING_LINK_PARA_THRESHOLD] !== undefined) {
                aiSummaryCleansingLinkParaThreshold = Math.max(10, Math.min(200, Number(s[AI_SUMMARY_CLEANSING_LINK_PARA_THRESHOLD]) || 50));
            }
            // Custom patterns
            if (s[AI_SUMMARY_CLEANSING_CUSTOM_PATTERNS] !== undefined) {
                aiSummaryCleansingCustomPatterns = Array.isArray(s[AI_SUMMARY_CLEANSING_CUSTOM_PATTERNS]) 
                    ? s[AI_SUMMARY_CLEANSING_CUSTOM_PATTERNS] as string[] 
                    : [];
            }
            // テキスト品質設定を取得
            if (s[CONTENT_DEDUP_ENABLED] !== undefined) {
                contentDedupEnabled = s[CONTENT_DEDUP_ENABLED];
            }
            if (s[CONTENT_DEDUP_THRESHOLD] !== undefined) {
                contentDedupThreshold = parseFloat(String(s[CONTENT_DEDUP_THRESHOLD]));
            }
            logInfo('Settings loaded', {
                minVisitDuration,
                minScrollDepth,
                aiSummaryCleansingEnabled,
                aiSummaryCleansingAlt,
                aiSummaryCleansingMetadata,
                aiSummaryCleansingAds,
                aiSummaryCleansingNav,
                aiSummaryCleansingSocial
            }, 'extractor').catch(() => { /* non-critical logging failure */ });
            resolve();
        });
    });
}

/**
 * 有効な訪問の条件を判定する（テスト可能な純粋関数）
 * @param duration - 訪問時間（秒）
 * @param scrollPercent - 最大スクロール深度（%）
 * @returns 条件を満たす場合true
 */
export function shouldRecordVisit(duration: number, scrollPercent: number): boolean {
    return duration >= minVisitDuration && scrollPercent >= minScrollDepth;
}

/**
 * 有効な訪問条件をチェックする
 * 【機能概要】: 現在の訪問が条件を満たしているかを確認し、条件を満たした場合は記録を実行
 * 【判定条件】:
 *   - 未報告であること（isValidVisitReported == false）
 *   - 訪問時間 >= 最小訪問時間
 *   - 最大スクロール深度 >= 最小スクロール深度
 * 【タイミング】: スクロール時および1秒ごとに定期実行
 * 【パフォーマンス】: 条件満了後に定期実行を停止して不要な処理を回避
 * 🟢
 */
function checkVisitConditions(): void {
    if (isValidVisitReported) return;

    const duration = (Date.now() - startTime) / 1000;

    // DEBUG LOG: 状態のデバッグログ（fire-and-forget）
    void logDebug('Visit status', { duration, maxScrollPercentage, minVisitDuration, minScrollDepth }, 'extractor');

    // E2Eテスト用フック: data-ow-e2e-test 属性が設定されている場合のみ有効
    // （ページスクリプトと Content Script は別 JS コンテキストのため DOM 経由で通信）
    if (document.documentElement.hasAttribute('data-ow-e2e-test')) {
        const state = {
            maxScrollPercentage,
            isValidVisitReported,
            startTime,
            minVisitDuration,
            minScrollDepth,
            duration,
        };
        (window as any).__OW_TEST_STATE = state;
        document.documentElement.setAttribute('data-ow-test-state', JSON.stringify(state));
    }

    // 【条件判定】: 時間とスクロール深度の両方の条件を満たす場合に記録を実行
    if (shouldRecordVisit(duration, maxScrollPercentage)) {
        reportValidVisit();
        // E2Eテスト用フック: 報告後に状態を更新
        if (document.documentElement.hasAttribute('data-ow-e2e-test')) {
            (window as any).__OW_TEST_STATE.isValidVisitReported = true;
            document.documentElement.setAttribute('data-ow-test-state',
                JSON.stringify((window as any).__OW_TEST_STATE));
        }
        // 【パフォーマンス向上】: 条件満了後に定期実行を停止
        if (checkIntervalId) {
            clearInterval(checkIntervalId);
            checkIntervalId = null;
        }
    }
}

/**
 * Throttle function using requestAnimationFrame
 * 【機能概要】: 関数呼び出しをフレーム単位で抑制し、高速スクロール時の負荷を軽減
 * @param fn - Throttle対象の関数
 * @returns Throttle化された関数
 */
function throttle<T extends (...args: any[]) => void>(fn: T): T {
    let lastCall = 0;
    let rafId: number | null = null;
    let lastArgs: Parameters<T> | null = null;

    return ((...args: Parameters<T>) => {
        lastArgs = args;
        const now = performance.now();

        // Cancel existing RAF before scheduling a new one to prevent memory leak
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }

        // 前回の呼び出しから十分時間が経過しているか確認
        const timeSinceLastCall = now - lastCall;
        const THROTTLE_DELAY = 100; // 100ms

        rafId = requestAnimationFrame(() => {
            rafId = null;
            const callNow = performance.now() - lastCall >= THROTTLE_DELAY;
            if (callNow && lastArgs) {
                lastCall = performance.now();
                fn(...lastArgs);
            } else if (lastArgs) {
                // ディレイ未満の場合は追加のチェック
                if (performance.now() - lastCall >= THROTTLE_DELAY) {
                    lastCall = performance.now();
                    fn(...lastArgs);
                }
            }
        });
    }) as T;

    window.addEventListener('beforeunload', () => {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
    });
}

/**
 * 最大スクロール深度を更新する
 * 【機能概要】: 現在のスクロール位置からスクロール深度（%）を計算し、最大値を更新
 * 【計算式】: (scrollY / (scrollHeight - innerHeight)) * 100
 * 【エラーハンドリング】: 分母が0以下の場合は計算をスキップ（ページが空の場合など）
 * 🟢
 */
function updateMaxScroll(): void {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;

    // 【ゼロ除算防止】: ドキュメントの高さが0以下の場合は処理をスキップ
    if (docHeight <= 0) return;

    const scrollPercentage = (scrollTop / docHeight) * 100;

    // 【最大値更新】: 新しい最大スクロール深度を記録
    if (scrollPercentage > maxScrollPercentage) {
        maxScrollPercentage = scrollPercentage;
        // console.log(`New Max Scroll: ${maxScrollPercentage.toFixed(1)}%`);
    }

    checkVisitConditions();
}

/**
 * 有効な訪問を報告する
 * 【機能概要】: 条件を満たした訪問をバックグラウンドスクリプトに報告し、記録処理を実行
 * 【送信内容】: コンテンツテキスト（max 10,000文字）
 * 【エラーハンドリング】:
 *   - Service Worker未対応: リトライヘルパーにより自動リトライ
 *   - その他エラー: コンソールにエラーログを出力
 * 🟢
 */
async function reportValidVisit(): Promise<void> {
    isValidVisitReported = true;
    void logInfo('Sending VALID_VISIT', {}, 'extractor');

    const content = extractPageContent();

    try {
        const response: any = await messageSender.sendMessageWithRetry({
            type: 'VALID_VISIT',
            payload: {
                content: content,
                pageBytes: lastByteStats.pageBytes || undefined,
                candidateBytes: lastByteStats.candidateBytes || undefined,
                originalBytes: lastByteStats.originalBytes || undefined,
                cleansedBytes: lastByteStats.cleansedBytes || undefined,
                aiSummaryOriginalBytes: lastAiSummaryCleansedStats.aiSummaryOriginalBytes || undefined,
                aiSummaryCleansedBytes: lastAiSummaryCleansedStats.aiSummaryCleansedBytes || undefined,
                aiSummaryCleansedElements: lastAiSummaryCleansedStats.aiSummaryCleansedElements || undefined,
                aiSummaryCleansedReason: lastAiSummaryCleansedStats.aiSummaryCleansedReason !== 'none' ? lastAiSummaryCleansedStats.aiSummaryCleansedReason : undefined,
                aiSummaryCleansedReasons: lastAiSummaryCleansedStats.aiSummaryCleansedReasons
            }
        });
        void logDebug('VALID_VISIT response', { response }, 'extractor');

        // レスポンスの成功フラグをチェック
        if (response && !response.success) {
            if (response.error === 'DOMAIN_BLOCKED') {
                // 正常な動作: このドメインはブロック対象のため記録しない
                return;
            }

            // PRIVATE_PAGE_DETECTED エラーの処理
            if (response.error === 'PRIVATE_PAGE_DETECTED') {
                // confirmationRequired=true の場合のみダイアログを表示
                // （skip モードでは confirmationRequired が返らないのでダイアログ不要）
                if (!response.confirmationRequired) {
                    return;
                }

                const statusCode = reasonToStatusCode(response.reason);
                const messageKey = statusCodeToMessageKey(statusCode);
                const reasonLabel = chrome.i18n.getMessage(messageKey)
                    || chrome.i18n.getMessage(`privatePageReason_${(response.reason || '').replace('-', '')}`)
                    || response.reason || 'unknown';

                const userConfirmed = await showPrivacyConfirmDialog(statusCode, reasonLabel);

                if (userConfirmed) {
                    // force flagを立てて再送信
                    try {
                        await messageSender.sendMessageWithRetry({
                            type: 'VALID_VISIT',
                            payload: {
                                content: content,
                                force: true
                            }
                        });
                    } catch (retryError: any) {
                        await logError('Failed to force save private page', { error: retryError.message }, ErrorCode.INTERNAL_ERROR, 'extractor');
                    }
                }
                return;
            }

            await logError('Background worker error', { error: response.error }, ErrorCode.INTERNAL_ERROR, 'extractor');
        }
    } catch (error: any) {
        // 全てのリトライが失敗した場合
        if (error.message && (error.message.includes('Extension context invalidated') || error.message.includes('sendMessage'))) {
            // 拡張機能がリロードされた場合は、定期チェックを停止してページリフレッシュを推奨
            if (checkIntervalId) {
                clearInterval(checkIntervalId);
                checkIntervalId = null;
            }
            await logInfo('Extension reloaded - page refresh needed', {}, 'extractor');
        } else {
            await logWarn('Failed to report valid visit', { error: error.message }, ErrorCode.API_REQUEST_FAILURE, 'extractor');
        }
    }
}

/**
 * プライバシー懸念ページの確認ダイアログをページ上に表示する。
 * ブラウザ標準の confirm() を使わず Shadow DOM でロゴ・ステータスコード付きの
 * カスタムダイアログを表示する。
 */
function showPrivacyConfirmDialog(statusCode: string, reasonLabel: string): Promise<boolean> {
    return new Promise((resolve) => {
        const iconUrl = chrome.runtime.getURL('icons/icon48.png');
        const title = chrome.i18n.getMessage('notifyPrivacyConfirmTitle') || 'Obsidian Weave';
        const bodyText = chrome.i18n.getMessage('privacyDialogBody', [reasonLabel])
            || `このページにはプライバシー懸念があります（${reasonLabel}）。それでも保存しますか？`;
        const saveLabel = chrome.i18n.getMessage('notifyPrivacyConfirmSave') || '保存する';
        const cancelLabel = chrome.i18n.getMessage('cancel') || 'キャンセル';
        const statusLabel = chrome.i18n.getMessage('privacyDialogStatusLabel') || '検出コード';

        // ホスト要素
        const host = document.createElement('div');
        host.id = 'osh-privacy-confirm-host';
        host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0; width: 100%; height: 100%;';
        const shadow = host.attachShadow({ mode: 'closed' });

        // Constructable Stylesheets を使用（CSP style-src 'self' に準拠）
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(`
            .overlay {
                position: fixed; inset: 0;
                background: rgba(0,0,0,0.45);
                display: flex; align-items: center; justify-content: center;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            }
            .dialog {
                background: #fff;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.22);
                padding: 24px 28px 20px;
                max-width: 380px;
                width: 90vw;
                box-sizing: border-box;
            }
            .header {
                display: flex; align-items: center; gap: 10px;
                margin-bottom: 14px;
            }
            .header img { width: 28px; height: 28px; flex-shrink: 0; }
            .header span {
                font-size: 15px; font-weight: 700; color: #1a1a1a;
            }
            .body { font-size: 14px; color: #333; line-height: 1.6; margin-bottom: 14px; }
            .status {
                display: inline-flex; align-items: center; gap: 6px;
                background: #f3f4f6; border-radius: 6px;
                padding: 4px 10px; font-size: 12px; color: #555;
                margin-bottom: 18px;
            }
            .status-code { font-family: monospace; font-weight: 700; color: #d97706; }
            .buttons { display: flex; gap: 10px; justify-content: flex-end; }
            .btn {
                padding: 8px 18px; border-radius: 7px; font-size: 14px;
                cursor: pointer; border: none; font-weight: 600;
            }
            .btn-cancel { background: #f3f4f6; color: #555; }
            .btn-cancel:hover { background: #e5e7eb; }
            .btn-save { background: #4f46e5; color: #fff; }
            .btn-save:hover { background: #4338ca; }
        `);
        shadow.adoptedStyleSheets = [sheet];

        // HTMLはスタイルなしで構築（XSS対策: テキストはtextContentで設定）
        shadow.innerHTML = `
            <div class="overlay">
                <div class="dialog" role="dialog" aria-modal="true">
                    <div class="header">
                        <img src="${iconUrl}" alt="">
                        <span id="osh-title"></span>
                    </div>
                    <div class="body" id="osh-body"></div>
                    <div class="status">
                        <span id="osh-status-label"></span>
                        <span class="status-code" id="osh-status-code"></span>
                        <span id="osh-reason"></span>
                    </div>
                    <div class="buttons">
                        <button class="btn btn-cancel" id="osh-cancel"></button>
                        <button class="btn btn-save" id="osh-save"></button>
                    </div>
                </div>
            </div>
        `;

        // テキストはtextContentで安全に設定
        const setText = (id: string, text: string) => {
            const el = shadow.getElementById(id);
            if (el) el.textContent = text;
        };
        setText('osh-title', title);
        setText('osh-body', bodyText);
        setText('osh-status-label', `${statusLabel}:`);
        setText('osh-status-code', statusCode);
        setText('osh-reason', `— ${reasonLabel}`);
        setText('osh-cancel', cancelLabel);
        setText('osh-save', saveLabel);

        const cleanup = (result: boolean) => {
            host.remove();
            resolve(result);
        };

        shadow.getElementById('osh-save')?.addEventListener('click', () => cleanup(true));
        shadow.getElementById('osh-cancel')?.addEventListener('click', () => cleanup(false));
        // オーバーレイクリックでキャンセル
        shadow.querySelector('.overlay')?.addEventListener('click', (e) => {
            if (e.target === shadow.querySelector('.overlay')) cleanup(false);
        });

        document.body.appendChild(host);
        // フォーカスをキャンセルボタンへ
        setTimeout(() => (shadow.getElementById('osh-cancel') as HTMLElement)?.focus(), 0);
    });
}

/**
 * 定期実行を開始する
 * 【機能概要】: 1秒ごとに条件チェックを実行するタイマーを開始する
 * 【パフォーマンス】: 条件満了後にタイマーが停止されるため、不要なCPU使用を回避
 * 🟢
 */
function startPeriodicCheck(): void {
    if (checkIntervalId) {
        clearInterval(checkIntervalId);
    }
    checkIntervalId = setInterval(checkVisitConditions, 1000);
}

/**
 * 定期実行を停止する
 * 【機能概要】: 条件チェックのタイマーを停止する
 * 【用途】:
 *   - 条件満了時の自動停止
 *   - ページ離脱時のクリーンアップ
 * 🟢
 */
function stopPeriodicCheck(): void {
    if (checkIntervalId) {
        clearInterval(checkIntervalId);
        checkIntervalId = null;
    }
}

/**
 * 初期化処理
 * 【機能概要】: 設定の読み込みとイベントリスナーの登録
 * 🟢
 */
async function init(): Promise<void> {
    // 設定をロード（非同期で待機）
    await loadSettings();

    // 【イベントリスナー登録】: スクロールイベントを監視（throttle化でパフォーマンス向上）
    const throttledUpdateMaxScroll = throttle(updateMaxScroll);
    window.addEventListener('scroll', throttledUpdateMaxScroll);

    // 【定期実行】: 1秒ごとに条件をチェック
    startPeriodicCheck();

    // 【クリーンアップ】: ページ離脱時に定期実行を停止
    window.addEventListener('beforeunload', stopPeriodicCheck);

    // 【パフォーマンス最適化】: タブが非表示の場合は定期実行を停止
    // Page Visibility APIを使用して、バックグラウンドタブでの不要な処理を回避
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopPeriodicCheck();
        } else if (!isValidVisitReported) {
            // タブが表示され、まだ記録が行われていない場合は再開
            startPeriodicCheck();
        }
    });

    // E2Eテスト用: 初期化完了を data-ow-test-state 属性で通知
    if (document.documentElement.hasAttribute('data-ow-e2e-test')) {
        document.documentElement.setAttribute('data-ow-test-state', JSON.stringify({
            maxScrollPercentage,
            isValidVisitReported,
            startTime,
            minVisitDuration,
            minScrollDepth,
            duration: 0,
        }));
    }
}

// 【ポップアップからのメッセージハンドラ】: 手動コンテンツ取得要求に応答
chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    if (message.type === 'GET_CONTENT') {
        const content = extractPageContent();
        sendResponse({
            content,
            cleansedReason: lastCleansedReason,
            cleanseStats: lastCleanseStats,
            byteStats: {
                pageBytes: lastByteStats.pageBytes || undefined,
                candidateBytes: lastByteStats.candidateBytes || undefined,
                originalBytes: lastByteStats.originalBytes || undefined,
                cleansedBytes: lastByteStats.cleansedBytes || undefined,
            },
            aiSummaryCleansedStats: {
                aiSummaryOriginalBytes: lastAiSummaryCleansedStats.aiSummaryOriginalBytes || undefined,
                aiSummaryCleansedBytes: lastAiSummaryCleansedStats.aiSummaryCleansedBytes || undefined,
                aiSummaryCleansedElements: lastAiSummaryCleansedStats.aiSummaryCleansedElements || undefined,
                aiSummaryCleansedReason: lastAiSummaryCleansedStats.aiSummaryCleansedReason !== 'none' ? lastAiSummaryCleansedStats.aiSummaryCleansedReason : undefined,
                aiSummaryCleansedReasons: lastAiSummaryCleansedStats.aiSummaryCleansedReasons
            }
        });
    }
    return true;
});

// 【初期化実行】
void init();