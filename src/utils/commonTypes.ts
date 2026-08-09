/**
 * commonTypes.ts
 * 共通型定義
 * 複数のモジュールで使用される型定義を集約
 */

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