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
    'l-footer', 'l-header', 'l-sidebar', 'p-entry__footer', 'p-entry__header', 'c-button', 'c-label', 'common-footer', 'sub-column'
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