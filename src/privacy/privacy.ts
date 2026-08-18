/**
 * privacy.ts
 * PRIVACY.md をフェッチしてブラウザ内でレンダリングする
 */

import { getMessage } from '../utils/i18n.js';
import { applyI18n, setHtmlLangAndDir, translatePageTitle } from '../utils/i18n-dom.js';

import { escapeHtml } from '../utils/htmlEscape.js';

export { escapeHtml };

/**
 * MarkdownテキストをHTMLに変換する
 * @param md Markdownテキスト
 * @returns HTML文字列
 */
export function renderMarkdown(md: string): string {
    const lines = md.split('\n');
    const out: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        if (line === undefined) continue;

        // Horizontal rule
        if (/^---+$/.test(line.trim())) {
            out.push('<hr>');
            i++;
            continue;
        }

        // Headings
        const hMatch = line.match(/^(#{1,5})\s+(.*)/);
        if (hMatch) {
            const level = (hMatch[1] ?? '').length;
            const headingText = hMatch[2] ?? '';
            const text = renderInline(headingText);
            const id = headingText.replace(/[^\p{L}\p{N}\s-]/gu, '').trim().toLowerCase().replace(/\s+/g, '-');
            out.push(`<h${level} id="${id}">${text}</h${level}>`);
            i++;
            continue;
        }

        // Blockquote (including > [!NOTE])
        if (line.startsWith('>')) {
            const bqLines: string[] = [];
            while (i < lines.length) {
                const bqLine = lines[i];
                if (bqLine === undefined || (!bqLine.startsWith('>') && bqLine !== '')) break;
                if (bqLine === '') break;
                bqLines.push(bqLine.replace(/^>\s?/, ''));
                i++;
            }
            const inner = renderMarkdown(bqLines.join('\n')).replace(/^\[!NOTE\]\s*/i, '');
            out.push(`<blockquote>${inner}</blockquote>`);
            continue;
        }

        // Table
        if (line.includes('|') && i + 1 < lines.length && (lines[i + 1] ?? '').includes('---')) {
            const headers = line.split('|').filter(c => c.trim() !== '').map(c => `<th>${renderInline(c.trim())}</th>`);
            out.push('<table><thead><tr>' + headers.join('') + '</tr></thead><tbody>');
            i += 2; // skip header and separator
            while (i < lines.length) {
                const tableLine = lines[i];
                if (tableLine === undefined || !tableLine.includes('|')) break;
                const cells = tableLine.split('|').filter(c => c.trim() !== '').map(c => `<td>${renderInline(c.trim())}</td>`);
                out.push('<tr>' + cells.join('') + '</tr>');
                i++;
            }
            out.push('</tbody></table>');
            continue;
        }

        // Unordered list
        if (/^(\s*)[-*]\s/.test(line)) {
            const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
            out.push('<ul>');
            while (i < lines.length && /^(\s*)[-*]\s/.test(lines[i] ?? '')) {
                const curLine = lines[i];
                if (curLine === undefined) break;
                const curIndent = curLine.match(/^(\s*)/)?.[1]?.length ?? 0;
                if (curIndent > indent) {
                    // nested — simple handling
                    out.push('<ul>');
                    while (i < lines.length && /^(\s*)[-*]\s/.test(lines[i] ?? '')) {
                        const nestedLine = lines[i];
                        if (nestedLine === undefined) break;
                        const ni = nestedLine.match(/^(\s*)/)?.[1]?.length ?? 0;
                        if (ni <= indent) break;
                        const text = nestedLine.replace(/^\s*[-*]\s/, '');
                        out.push(`<li>${renderInline(text)}</li>`);
                        i++;
                    }
                    out.push('</ul>');
                } else {
                    const text = curLine.replace(/^\s*[-*]\s/, '');
                    out.push(`<li>${renderInline(text)}</li>`);
                    i++;
                }
            }
            out.push('</ul>');
            continue;
        }

        // Ordered list
        if (/^\d+\.\s/.test(line)) {
            out.push('<ol>');
            while (i < lines.length && /^\d+\.\s/.test(lines[i] ?? '')) {
                const olLine = lines[i];
                if (olLine === undefined) break;
                const text = olLine.replace(/^\d+\.\s/, '');
                out.push(`<li>${renderInline(text)}</li>`);
                i++;
            }
            out.push('</ol>');
            continue;
        }

        // Empty line
        if (line.trim() === '') {
            i++;
            continue;
        }

        // Paragraph
        out.push(`<p>${renderInline(line)}</p>`);
        i++;
    }

    return out.join('\n');
}

/**
 * インラインMarkdown要素をHTMLに変換する
 * @param text Markdownテキスト
 * @returns HTML文字列
 */
export function renderInline(text: string): string {
    // Links [text](url) - only allow HTTPS and anchor links
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => {
        let safeUrl = u;
        if (u.startsWith('#')) {
            safeUrl = u;
        } else if (u.startsWith('https://')) {
            try {
                new URL(u); // 畸形URLの場合はエラー
                safeUrl = u;
            } catch {
                safeUrl = '#';
            }
        } else {
            safeUrl = '#';
        }
        return `<a href="${escapeHtml(safeUrl)}">${escapeHtml(t)}</a>`;
    });
    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, (_, t) => `<strong>${escapeHtml(t)}</strong>`);
    // Code
    text = text.replace(/`([^`]+)`/g, (_, t) => `<code>${escapeHtml(t)}</code>`);
    // Escape remaining < >
    text = text.replace(/(?<!<[^>]*)(?<!&(?:[a-z]+|#\d+);)(?<![<>])([^<>&"'`*[\]()]+)/g, m => m);
    return text;
}

/**
 * プライバシーポリシーをフェッチしてDOMに描画する
 * @param containerId コンテナ要素のID（デフォルト: 'content'）
 */
export async function loadPrivacyPolicy(containerId: string = 'content'): Promise<void> {
    const content = document.getElementById(containerId);
    if (!content) return;

    try {
        const res = await fetch('../PRIVACY.md');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const contentLength = res.headers.get('content-length');
        const maxSize = 1024 * 1024; // 1MB limit for privacy policy
        if (contentLength && parseInt(contentLength, 10) > maxSize) {
            throw new Error('Privacy policy file exceeds size limit');
        }
        const md = await res.text();
        content.innerHTML = renderMarkdown(md);
    } catch (_e) {
        content.innerHTML = `<p class="error">${getMessage('privacyPolicyLoadError') || 'Failed to load the privacy policy.'}</p>`;
    }
}

// Initialize i18n and load the policy when the DOM is ready.
document.addEventListener('DOMContentLoaded', () => {
    setHtmlLangAndDir();
    applyI18n();
    translatePageTitle('privacyPolicyTitle');
    loadPrivacyPolicy().catch(console.error);
});
