/**
 * AI要約クレンジング型定義
 * cleanseAISummaryContent / countAISummaryTargets のオプションと結果
 */

// ---------------------------------------------------------------------------
// RuleKey: CLEANSING_RULES の各ルールキーの共用型。
// ルールを追加・削除したときはここを更新する。型チェックが漏れを検出する。
// ---------------------------------------------------------------------------

export type RuleKey =
    | 'alt' | 'metadata' | 'ads' | 'nav' | 'social' | 'deep'
    | 'jsonLd' | 'lazyLoad' | 'skipLink' | 'card' | 'linkDensity'
    | 'fixed' | 'recommend' | 'pagination' | 'snsPromo' | 'popup' | 'cookie'
    | 'platform' | 'textDensity' | 'shortSeq' | 'symbolLine' | 'linkPara'
    | 'enhancedHidden' | 'emptyElem' | 'jpLayout' | 'jpNavigation'
    | 'author' | 'affiliate' | 'speechBubble'
    | 'newsMedia' | 'ecSite' | 'qaSite' | 'videoSite';

/**
 * CLEANSING_RULES から派生したルールフラグ（${key}Enabled）。
 * ルールを追加すると自動的に型が拡張される。
 */
export type AiSummaryCleanseRuleFlags = {
    [K in RuleKey as `${K}Enabled`]?: boolean;
};

/**
 * AI要約クレンジングオプション
 *
 * ルールフラグは RuleKey から導出。閾値・bodyProtection は明示的フィールド。
 */
export interface AiSummaryCleanseOptions extends AiSummaryCleanseRuleFlags {
    // Body protection options
    bodyProtectionEnabled?: boolean;   // 本文保護機能（デフォルト: true）
    bodyProtectionThreshold?: number;  // 本文スコア閾値（デフォルト: 200）
    // Threshold settings
    linkRatioThreshold?: number;      // リンク密度閾値（デフォルト: 70）
    shortTextThreshold?: number;       // 短文閾値文字数（デフォルト: 30）
    shortSeqCount?: number;           // 短文連続数閾値（デフォルト: 5）
    linkParaThreshold?: number;       // リンクのみ段落閾値（デフォルト: 50）
    // Custom patterns
    customPatterns?: string[];        // カスタムパターン列表
    // Over-cleansed fallback thresholds
    fallbackRatio?: number;           // 過剰削減フォールバック比率閾値（デフォルト: 0.20）
    fallbackMinBytes?: number;        // 過剰削減フォールバック絶対量閾値（デフォルト: 300）
}

/**
 * ルールごとの削除数。キーは CLEANSING_RULES の `key`。
 *
 * Every rule that ran has an entry, so "absent" means "did not run" rather
 * than being indistinguishable from "removed nothing". The flat `xRemoved`
 * fields below are derived from this map and kept for existing readers.
 */
export type CleansingRemovalCounts = Record<string, number>;

/**
 * AI要約クレンジング結果
 *
 * `removed` is the source of truth; the individual `xRemoved` fields are
 * projections of it. They stay because callers and tests read them by name,
 * but nothing writes them independently — see buildCleanseResult().
 */
export interface AiSummaryCleanseResult {
    /** ルールキー → 削除数。実行したルールのみを含む。 */
    removed: CleansingRemovalCounts;
    altRemoved: number;             // 画像alt属性削除数
    metadataRemoved: number;        // メタデータ削除数
    adsRemoved: number;             // 広告関連要素削除数
    navRemoved: number;             // ナビゲーション・フッター削除数
    socialRemoved: number;          // ソーシャルウィジェット削除数
    deepRemoved: number;            // ディープクレンジング削除数
    jsonLdRemoved?: number;         // JSON-LD構造化データ削除数
    lazyLoadRemoved?: number;       // 遅延読み込みコンテンツ削除数
    skipLinkRemoved?: number;       // スキップリンク削除数
    cardRemoved?: number;          // 記事カード・リストアイテム削除数
    linkDensityRemoved?: number;    // リンク密度ブロック削除数
    // NEW: 6つの新しいオプション
    fixedRemoved?: number;         // 固定要素削除数
    recommendRemoved?: number;     // 推薦セクション削除数
    paginationRemoved?: number;     // ページネーション削除数
    snsPromoRemoved?: number;       // SNSプロモ削除数
    popupRemoved?: number;          // ポップアップ削除数
    cookieRemoved?: number;         // Cookie同意バナー削除数
    platformRemoved?: number;       // プラットフォームノイズ削除数
    // NEW: 9つの追加オプション
    textDensityRemoved?: number;        // テキスト密度削除数
    shortSeqRemoved?: number;            // 短文連続削除数
    symbolLineRemoved?: number;          // 特殊記号行削除数
    linkParaRemoved?: number;            // リンクのみ段落削除数
    linkParaThreshold?: number;          // リンクのみ段落閾値
    enhancedHiddenRemoved?: number;     // 非表示要素強化削除数
    emptyElemRemoved?: number;           // 空要素削除数
    jpLayoutRemoved?: number;            // JP BEMレイアウト削除数
    jpNavigationRemoved?: number;       // JP ナビ削除数
    authorRemoved?: number;              // 執筆者・メタ削除数
    // Category A: WordPress Theme Specific Patterns
    affiliateRemoved?: number;           // アフィリエイト要素処理数
    speechBubbleRemoved?: number;        // 吹き出し要素処理数
    // Category B: Site-Type Specific Patterns (News/EC/QA/Video)
    newsMediaRemoved?: number;        // ニュースメディア固有パターン削除数
    ecSiteRemoved?: number;           // EC・通販固有パターン削除数
    qaSiteRemoved?: number;           // Q&A・知恵袋固有パターン削除数
    videoSiteRemoved?: number;        // 動画プラットフォーム固有パターン削除数
    totalRemoved: number;           // 合計削除数
    bytesBefore: number;            // クレンジング前のバイト数
    bytesAfter: number;             // クレンジング後のバイト数
}