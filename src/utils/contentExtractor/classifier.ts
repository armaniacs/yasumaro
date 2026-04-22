/**
 * contentExtractor 分類器
 * 要素の除外判定・アジアコンテンツ判定に使用する定数と述語関数
 */

/**
 * 除外するセクメンタルコンテンツのロール属性
 * HTMLテキスト抽出の際、ナビゲーションやバナー等の補助的UI要素を除外するために使用
 */
export const EXCLUDED_ROLES = new Set([
    'navigation',    // ナビゲーションメニュー
    'banner',        // ヘッダー/バナー
    'contentinfo',   // フッター
    'complementary', // サイドバー
    'doc-credit',    // 著者情報等
    'doc-endnotes',  // 注釈
    'doc-footnotes'  // 脚注
]);

/**
 * 除外するタグ名
 */
export const EXCLUDED_TAGS = new Set([
    'nav',
    'aside',
    'footer',
    'header'
]);

/**
 * 除外するクラス名パターン（大文字小文字を区別しない）
 */
export const EXCLUDED_CLASS_PATTERNS = [
    'sidebar',
    'nav',
    'navigation',
    'menu',
    'breadcrumb',
    'cookie',
    'ad',
    'advertisement',
    'banner',
    'footer',
    'header'
];

/**
 * アジア圏のWebサイトでよく使用されるコンテンツを示すクラス名パターン
 * 東アジアの网站（ウェブサイト）で使用される主要なコンテンツ識別子
 */
export const ASIA_CONTENT_CLASS_PATTERNS = [
    // 日本語・中国語・韓国語共通
    'content',
    'article',
    'post',
    'entry',
    'article-body',
    'article-content',
    'post-content',
    'entry-content',
    'main-content',
    'story',
    'text',
    // 中国語固有
    'article_main',
    'trs_editor',
    'nr-col',
    // 韓国語固有
    'article_view',
    'article_body',
    'view_content',
    // 共通
    'blog-content',
    'news-content',
    'product-detail',
    'description'
];

/**
 * アジア圏のWebサイトでよく使用されるIDパターン
 */
export const ASIA_CONTENT_ID_PATTERNS = [
    'content',
    'article',
    'post',
    'entry',
    'main',
    'article-content',
    'article-body',
    'post-content',
    'main-content',
    'text',
    'article_view',
    'article_main'
];

/**
 * 要素が除外対象かどうかを判定
 * @internal テスト用にエクスポート
 */
export function isExcludedElement(element: Element): boolean {
    // タグ名で除外
    if (EXCLUDED_TAGS.has(element.tagName.toLowerCase())) {
        return true;
    }

    // role属性で除外
    const role = element.getAttribute('role');
    if (role && EXCLUDED_ROLES.has(role.toLowerCase())) {
        return true;
    }

    // aria-hiddenで除外
    if (element.getAttribute('aria-hidden') === 'true') {
        return true;
    }

    // クラス名パターンで除外
    const classes = element.className.toLowerCase();
    for (const pattern of EXCLUDED_CLASS_PATTERNS) {
        if (classes.includes(pattern)) {
            return true;
        }
    }

    return false;
}

/**
 * Check if an element is an Asian content structure
 * @param element - Element to check
 * @returns true if it's an Asian content structure
 */
export function isAsianContentElement(element: Element): boolean {
    // Check if DOM is available (for Node.js/test environments)
    if (typeof document === 'undefined') return false;
    
    const classes = (element.className || '').toLowerCase();
    const id = (element.id || '').toLowerCase();

    // Check by class name
    for (const pattern of ASIA_CONTENT_CLASS_PATTERNS) {
        if (classes.includes(pattern)) {
            return true;
        }
    }

    // Check by ID (exact match, or prefix/suffix match)
    for (const pattern of ASIA_CONTENT_ID_PATTERNS) {
        // Exact match, or content- prefix or -content suffix
        if (id === pattern || id.startsWith('content-') || id.endsWith('-content')) {
            return true;
        }
    }

    return false;
}