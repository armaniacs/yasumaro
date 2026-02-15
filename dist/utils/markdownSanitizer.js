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
export function sanitizeMarkdownLinks(text) {
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
export function sanitizeAllMarkdownLinks(text) {
    if (!text || typeof text !== 'string') {
        return text;
    }
    // 全ての [text](url) パターンをエスケープ（URL形式に関わらず）
    const allMarkdownLinkPattern = /\[([^\]]*)\]\(([^)]+)\)/gi;
    return text.replace(allMarkdownLinkPattern, '\\[$1\\]\\($2\\)');
}
/**
 * Obsidian保存用のコンテンツをサニタイズする
 *
 * 【処理内容】:
 * 1. Markdownリンク形式のエスケープ
 * 2. その他必要なサニタイズ処理があれば追加
 *
 * @param {string} content - サニタイズするコンテンツ
 * @returns {string} サニタイズされたコンテンツ
 */
export function sanitizeForObsidian(content) {
    if (!content || typeof content !== 'string') {
        return content;
    }
    // Markdownリンクをエスケープ
    let sanitized = sanitizeMarkdownLinks(content);
    return sanitized;
}
//# sourceMappingURL=markdownSanitizer.js.map