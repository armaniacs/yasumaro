/**
 * markdownSanitizer.ts
 * Markdown特殊文字のサニタイズ処理
 * 
 * 【目的】:
 * Webページから抽出したテキストにMarkdownリンク形式が含まれている場合、
 * Obsidianで表示すると意図しないリンクが表示される問題を防ぐ
 * 
 * 【Code Review P1】: XSS対策 - Markdownリンクのサニタイズ
 */

/**
 * Markdownリンク形式をエスケープする
 * 
 * 【対象パターン】:
 * - [text](url) 形式のMarkdownリンク
 * - [text] 形式のリンクテキスト（URLの直後にあるもの）
 * 
 * 【処理内容】:
 * - [text](url) パターンを検出し、角括弧と丸括弧をエスケープ
 * - 例: [悪意あるリンク](https://malicious.com) → \[悪意あるリンク\]\(https://malicious.com\)
 * 
 * @param {string} text - サニタイズするテキスト
 * @returns {string} サニタイズされたテキスト
 */
export function sanitizeMarkdownLinks(text: string): string {
    if (!text || typeof text !== 'string') {
        return text;
    }

    // Markdownリンクパターン: [text](url)
    // URLとして妥当な形式（http:// または https:// で始まる）のみを対象
    const markdownLinkPattern = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/gi;

    // リンク形式をエスケープ: [text](url) → \[text\]\(url\)
    return text.replace(markdownLinkPattern, '\\[$1\\]\\($2\\)');
}

/**
 * より包括的なMarkdown特殊文字のエスケープ
 * 
 * 【注意】:
 * この関数は全てのMarkdownリンク形式をエスケープします。
 * 通常のテキスト内の角括弧も影響を受ける可能性があるため、
 * 使用箇所を限定してください。
 * 
 * @param {string} text - サニタイズするテキスト
 * @returns {string} サニタイズされたテキスト
 */
export function sanitizeAllMarkdownLinks(text: string): string {
    if (!text || typeof text !== 'string') {
        return text;
    }

    // All [text](url) and ![alt](url) patterns regardless of URL scheme (VULN-006)
    const allMarkdownLinkPattern = /(!?)\[([^\]]*)\]\(([^)]+)\)/gi;

    return text.replace(allMarkdownLinkPattern, '$1\\[$2\\]\\($3\\)');
}

/**
 * Escape Obsidian wikilink/embed syntax
 *
 * Targets [[wikilink]] and ![[embed]] patterns so they are rendered
 * as literal text instead of being interpreted by Obsidian.
 *
 * @param text - text to escape
 * @returns text with wikilink syntax escaped
 */
export function escapeObsidianWikilinks(text: string): string {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/(!?)\[\[([^\]]*)\]\]/g, (_m, bang, inner) => `${bang}\\[\\[${inner}\\]\\]`);
}

/**
 * Sanitize URL for embedding inside a Markdown link target `(url)`
 *
 * Percent-encodes characters that can break out of a Markdown link:
 * `)`, `(`, `[`, `]`, `!`
 * This preserves normal URL readability while preventing injection.
 *
 * @param url - raw URL string
 * @returns URL safe for embedding in `[title](url)`
 */
export function sanitizeUrlForMarkdownTarget(url: string): string {
    if (!url || typeof url !== 'string') return url;
    // Only allow http/https URLs; reject dangerous schemes like javascript:, data:
    if (!/^https?:\/\//i.test(url)) {
        return 'about:blank';
    }
    // Encode characters dangerous for Markdown link syntax
    return url
        .replace(/\)/g, '%29')
        .replace(/\(/g, '%28')
        .replace(/\[/g, '%5B')
        .replace(/\]/g, '%5D')
        .replace(/!/g, '%21');
}

/**
 * Obsidian保存用のコンテンツをサニタイズする
 *
 * 【処理内容】:
 * 1. スキーム非依存のMarkdownリンクエスケープ（sanitizeAllMarkdownLinks）
 * 2. Obsidian wikilink/embed 構文のエスケープ（escapeObsidianWikilinks）
 *
 * @param {string} content - サニタイズするコンテンツ
 * @returns {string} サニタイズされたコンテンツ
 */
export function sanitizeForObsidian(content: string): string {
    if (!content || typeof content !== 'string') {
        return content;
    }

    // Escape all Markdown links regardless of URL scheme (VULN-002/005 fix)
    let sanitized = sanitizeAllMarkdownLinks(content);

    // Escape Obsidian wikilink/embed syntax (VULN-002/005 fix)
    sanitized = escapeObsidianWikilinks(sanitized);

    return sanitized;
}
