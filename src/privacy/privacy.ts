/**
 * privacy.ts
 * PRIVACY.md をフェッチしてブラウザ内でレンダリングする
 */

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function renderMarkdown(md: string): string {
    const lines = md.split('\n');
    const out: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Horizontal rule
        if (/^---+$/.test(line.trim())) {
            out.push('<hr>');
            i++;
            continue;
        }

        // Headings
        const hMatch = line.match(/^(#{1,5})\s+(.*)/);
        if (hMatch) {
            const level = hMatch[1].length;
            const text = renderInline(hMatch[2]);
            // anchor from raw text
            const id = hMatch[2].replace(/[^\p{L}\p{N}\s-]/gu, '').trim().toLowerCase().replace(/\s+/g, '-');
            out.push(`<h${level} id="${id}">${text}</h${level}>`);
            i++;
            continue;
        }

        // Blockquote (including > [!NOTE])
        if (line.startsWith('>')) {
            const bqLines: string[] = [];
            while (i < lines.length && (lines[i].startsWith('>') || lines[i] === '')) {
                if (lines[i] === '') break;
                bqLines.push(lines[i].replace(/^>\s?/, ''));
                i++;
            }
            const inner = renderMarkdown(bqLines.join('\n')).replace(/^\[!NOTE\]\s*/i, '');
            out.push(`<blockquote>${inner}</blockquote>`);
            continue;
        }

        // Table
        if (line.includes('|') && i + 1 < lines.length && lines[i + 1].includes('---')) {
            const headers = line.split('|').filter(c => c.trim() !== '').map(c => `<th>${renderInline(c.trim())}</th>`);
            out.push('<table><thead><tr>' + headers.join('') + '</tr></thead><tbody>');
            i += 2; // skip header and separator
            while (i < lines.length && lines[i].includes('|')) {
                const cells = lines[i].split('|').filter(c => c.trim() !== '').map(c => `<td>${renderInline(c.trim())}</td>`);
                out.push('<tr>' + cells.join('') + '</tr>');
                i++;
            }
            out.push('</tbody></table>');
            continue;
        }

        // Unordered list
        if (/^(\s*)[-*]\s/.test(line)) {
            const indent = (line.match(/^(\s*)/) || ['', ''])[1].length;
            out.push('<ul>');
            while (i < lines.length && /^(\s*)[-*]\s/.test(lines[i])) {
                const curIndent = (lines[i].match(/^(\s*)/) || ['', ''])[1].length;
                if (curIndent > indent) {
                    // nested — simple handling
                    out.push('<ul>');
                    while (i < lines.length && /^(\s*)[-*]\s/.test(lines[i])) {
                        const ni = (lines[i].match(/^(\s*)/) || ['', ''])[1].length;
                        if (ni <= indent) break;
                        const text = lines[i].replace(/^\s*[-*]\s/, '');
                        out.push(`<li>${renderInline(text)}</li>`);
                        i++;
                    }
                    out.push('</ul>');
                } else {
                    const text = lines[i].replace(/^\s*[-*]\s/, '');
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
            while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
                const text = lines[i].replace(/^\d+\.\s/, '');
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

function renderInline(text: string): string {
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

async function loadPrivacyPolicy(): Promise<void> {
    const content = document.getElementById('content');
    if (!content) return;

    try {
        const res = await fetch('../PRIVACY.md');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const md = await res.text();
        content.innerHTML = renderMarkdown(md);
    } catch (e) {
        content.innerHTML = '<p class="error">プライバシーポリシーの読み込みに失敗しました。</p>';
    }
}

document.addEventListener('DOMContentLoaded', loadPrivacyPolicy);
