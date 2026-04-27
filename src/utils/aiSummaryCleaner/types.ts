/**
 * AI要約クレンジング型定義
 * cleanseAISummaryContent / countAISummaryTargets のオプションと結果
 */

/**
 * AI要約クレンジングオプション
 */
export interface AiSummaryCleanseOptions {
    altEnabled?: boolean;           // 画像alt属性削除（デフォルト: true）
    metadataEnabled?: boolean;      // メタデータ削除（デフォルト: true）
    adsEnabled?: boolean;           // 広告関連要素削除（デフォルト: true）
    navEnabled?: boolean;          // ナビゲーション・フッター削除（デフォルト: true）
    socialEnabled?: boolean;       // コメント・ソーシャルウィジェット削除（デフォルト: true）
    deepEnabled?: boolean;         // ディープクレンジング（aside/form/cookie/関連記事等）（デフォルト: false）
    jsonLdEnabled?: boolean;       // JSON-LD構造化データ削除（デフォルト: false）
    lazyLoadEnabled?: boolean;     // 遅延読み込みコンテンツ削除（デフォルト: false）
    skipLinkEnabled?: boolean;     // スキップリンク削除（デフォルト: false）
    cardEnabled?: boolean;         // 記事カード・リストアイテム削除（デフォルト: false）
    linkDensityEnabled?: boolean;  // リンク密度の高いブロック削除（デフォルト: false）
    // NEW: 6つの新しいオプション
    fixedEnabled?: boolean;        // 固定要素削除（デフォルト: false）
    recommendEnabled?: boolean;    // 推薦セクション削除（デフォルト: true）
    paginationEnabled?: boolean;   // ページネーション削除（デフォルト: false）
    snsPromoEnabled?: boolean;     // SNSプロモ削除（デフォルト: false）
    popupEnabled?: boolean;        // ポップアップ削除（デフォルト: true）
    platformEnabled?: boolean;     // プラットフォームノイズ削除（デフォルト: false）
    // NEW: 9つの追加オプション
    textDensityEnabled?: boolean;      // テキスト密度フィルタリング（デフォルト: false）
    shortSeqEnabled?: boolean;        // 短文要素の連続削除（デフォルト: false）
    symbolLineEnabled?: boolean;      // 特殊記号行の削除（デフォルト: false）
    linkParaEnabled?: boolean;        // リンクのみ段落の削除（デフォルト: false）
    linkParaThreshold?: number;       // リンクのみ段落閾値（デフォルト: 50）
    enhancedHiddenEnabled?: boolean;  // 非表示要素強化削除（デフォルト: true）
    emptyElemEnabled?: boolean;       // 空要素の削除（デフォルト: true）
    jpLayoutEnabled?: boolean;        // JP BEM系レイアウトパターン（デフォルト: false）
    jpNavigationEnabled?: boolean;     // JP ナビ頻出語（デフォルト: false）
    authorEnabled?: boolean;         // 執筆者・メタ情報（デフォルト: false）
    // Body protection options
    bodyProtectionEnabled?: boolean;   // 本文保護機能（デフォルト: true）
    bodyProtectionThreshold?: number;  // 本文スコア閾値（デフォルト: 200）
    // Threshold settings
    linkRatioThreshold?: number;      // リンク密度閾値（デフォルト: 70）
    shortTextThreshold?: number;       // 短文閾値文字数（デフォルト: 30）
    shortSeqCount?: number;           // 短文連続数閾値（デフォルト: 5）
    // Custom patterns
    customPatterns?: string[];        // カスタムパターン列表
}

/**
 * AI要約クレンジング結果
 */
export interface AiSummaryCleanseResult {
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
    totalRemoved: number;           // 合計削除数
    bytesBefore: number;            // クレンジング前のバイト数
    bytesAfter: number;             // クレンジング後のバイト数
}