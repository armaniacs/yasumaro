/**
 * AI要約クレンジングパターン定義
 * 広告・ナビゲーション・ソーシャル等のクラス/ID/テキスト検出パターン
 */

/**
 * 広告関連のクラス名パターン
 */
export const AD_CLASS_PATTERNS = [
    'ad-',
    'advertisement',
    'sponsor',
    'sponsored',
    'promo',
    'promotion',
    'banner-ad',
    'ad-banner',
    'ad-container',
    'ad-wrapper',
    'ad-slot',
    'ad-unit'
];

/**
 * ソーシャルメディア関連のクラス名パターン
 */
export const SOCIAL_CLASS_PATTERNS = [
    'facebook',
    'twitter',
    'x-',
    'linkedin',
    'instagram',
    'youtube',
    'tiktok',
    'pinterest',
    'share',
    'social',
    'social-share',
    'share-buttons',
    'fb-',
    'tw-',
    'ig-'
];

/**
 * ナビゲーション関連のクラス名パターン
 */
export const NAV_CLASS_PATTERNS = [
    'breadcrumb',
    'menu',
    'nav',
    'navigation',
    'footer',
    'header',
    'sidebar',
    'topbar',
    'bottombar',
    // 法的・著作権テキスト（deepEnabled不要でデフォルト削除）
    'copyright',
    'legal',
    'disclaimer',
    'terms',
    'license',
    'site-info',
    'common-footer',
    // 汎用フッターパターン
    'l-footer',
    'entry-footer',
    'post-footer',
    'article-footer',
    // 日本語サイト
    'corp-info',
    'site-footer',
    'global-footer',
];

/**
 * 法的テキストパターン（著作権・免責事項等）
 * テキストコンテンツベースで要素を削除する（クラス名に依存しない）
 */
export const LEGAL_TEXT_PATTERNS: RegExp[] = [
    /©\s*\d{4}/,
    /copyright\s+\d{4}/i,
    /all rights reserved/i,
    /無断転載禁止/,
    /著作権.*株式会社/,
    /著作権.*有限会社/,
];

/**
 * Gutenberg 構造ブロック — 削除すると記事本文の意味が変わる破壊的なブロック
 * deepEnabled (デフォルト OFF) でのみ削除
 */
export const GUTENBERG_STRUCTURAL_PATTERNS = [
    'wp-block-group',
    'wp-block-columns',
    'wp-block-table',
    'wp-block-gallery',
    'wp-block-embed',
    'wp-block-cover',
];

/**
 * ディープクレンジング対象のクラス/IDパターン
 */
export const DEEP_CLASS_PATTERNS = [
    // クッキー・同意バナー
    'cookie', 'consent', 'gdpr', 'privacy-notice',
    // ポップアップ・モーダル・オーバーレイ
    'popup', 'modal', 'overlay', 'dialog', 'lightbox',
    // 通知・トースト・リボン
    'toast', 'notification', 'ribbon', 'alert', 'snackbar',
    // 関連記事・レコメンド
    'related', 'recommend', 'ranking', 'popular', 'trending', 'pickup',
    // ページネーション
    'pagination', 'pager', 'page-nav',
    // 目次
    'toc', 'table-of-contents',
    // タグ・カテゴリ
    'tag-list', 'category-list', 'label-list',
    // 著者情報
    'author', 'byline', 'profile-card',
    // メルマガ・購読
    'subscribe', 'newsletter', 'signup-form',
    // CTA・プロモーション
    'cta', 'call-to-action', 'promo-box',
    // ウィジェット
    'widget', 'sidebar-widget',
    // 固定・フローティング要素
    'sticky', 'fixed-bar', 'floating',
    // SNS埋め込み
    'embed', 'twitter-tweet', 'instagram-media',
    // 日本語サイト
    'kanren', 'osusume', 'rankinglist', 'newlist',
    // 法的・ポリシー
    'copyright', 'terms', 'privacy-policy', 'license', 'disclaimer', 'legal', 'site-info',
    // ナビゲーション強化
    'breadcrumb', 'topic-path', 'search-form', 'site-search', 'global-nav', 'utility-nav', 'menu-button', 'hamburger',
    // ソーシャル・コミュニティ
    'reaction', 'clap', 'like-button', 'share-box', 'sns-follow', 'comment-list', 'thread', 'response',
    // 著者・メタ情報
    'author-profile', 'writer-bio', 'post-date', 'update-date', 'post-meta', 'entry-footer', 'article-tag',
    // マーケティング
    'offer', 'campaign', 'lead-capture', 'download-link', 'banner-area', 'promotion', 'ad-slot',
    // 日本語BEM系
    'l-footer', 'l-header', 'l-sidebar', 'p-entry__footer', 'p-entry__header', 'c-button', 'c-label', 'common-footer', 'sub-column',
    // Gutenberg 構造ブロック（Category A-5 structural）
    ...GUTENBERG_STRUCTURAL_PATTERNS
];

/**
 * ディープクレンジング対象のrole属性
 */
export const DEEP_ROLES = [
    'banner',
    'complementary',
    'contentinfo',
    'search',
    'toolbar'
];

/**
 * B-1: ニュースメディア固有パターン
 * コメント欄・関連記事カード・記者クレジット・速報タイムライン
 */
export const NEWS_MEDIA_PATTERNS = [
    // コメント欄・リアクション欄
    'disqus', 'yahoo-comment', 'comment-count',
    // 関連記事カード群
    'related-article-card', 'article-ranking', 'read-also',
    // 記者・配信元クレジット表記
    'article-credit', 'byline-source', 'delivery-source',
    // 速報・更新タイムライン表示
    'live-timestamp', 'update-timeline', 'breaking-badge',
];

/**
 * B-2: EC・通販固有パターン
 * レビュー・バリエーション選択・関連購入・送料バッジ
 */
export const EC_SITE_PATTERNS = [
    // レビュー・星評価欄
    'review-list', 'star-rating', 'review-count', 'rating-star',
    // バリエーション選択UI（色・サイズ・数量）
    'variation-selector', 'color-swatch', 'size-selector', 'quantity-selector',
    // 一緒に買われている商品
    'frequently-bought', 'also-bought', 'bought-together',
    // 送料・在庫・ポイント情報バッジ
    'shipping-badge', 'stock-badge', 'point-badge', 'free-shipping',
];

/**
 * B-3: Q&A・知恵袋固有パターン
 * ベストアンサー・関連質問・回答者プロフィール・いいねボタン
 */
export const QA_SITE_PATTERNS = [
    // ベストアンサー・解決済みマーク
    'best-answer-badge', 'resolved-mark', 'solved-badge',
    // 関連質問一覧
    'related-question-list', 'similar-question',
    // 回答者プロフィール・ランクバッジ
    'answerer-profile', 'answerer-rank', 'responder-badge',
    // 覚えておき・いいね数ボタン
    'helpful-count', 'good-answer-button',
];

/**
 * B-4: 動画プラットフォーム固有パターン
 * コメント弾幕・タグクラウド・関連動画・再生数バッジ
 */
export const VIDEO_SITE_PATTERNS = [
    // コメント弾幕・実況テキスト
    'nico-comment', 'danmaku', 'comment-flow',
    // タグクラウド・フォルダータグ
    'tag-cloud', 'folder-tag', 'video-tag-list',
    // 関連動画・次の動画カード一覧
    'related-video-card', 'next-video-list',
    // 再生回数・マイリスト登録数・会員限定バッジ
    'view-count-badge', 'mylist-count', 'member-only-badge',
];