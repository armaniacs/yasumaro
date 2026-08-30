/**
 * Whitelist adapter auto-generation helpers — pure functions for estimating
 * content selectors from HTML. Used by `scripts/generate-whitelist-adapter.mjs`
 * and unit-tested independently.
 */

export const CANDIDATE_SELECTORS: readonly string[] = [
    'article',
    'main',
    '.post-content',
    '.entry-content',
    '#content',
    '.article-body',
    '#article-body',
    '.post',
    '.entry',
    '.content',
    '#main',
    '.main-content',
    '[role="main"]',
    '.markdown-body',
    '.prose',
    '#novel_honbun',
    '.znc-Either',
];

export const SAMPLE_HTML = `<!DOCTYPE html><html><body>
<article><p>This is the main article content. It contains enough text to be considered the primary content of the page. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p><p>Second paragraph with more content to increase text length significantly.</p></article>
<div class="sidebar">sidebar ads</div>
</body></html>`;

export interface SelectorScore {
    selector: string;
    textLength: number;
    elementCount: number;
}

export interface AdapterDraft {
    hostname: string;
    name: string;
    detectSelector: string;
    contentSelectors: string[];
    excludeSelectors: string[];
    metadataPatterns: string[];
    candidates: SelectorScore[];
    generatedAt: string;
    sourceUrl: string;
}

/**
 * Estimate content selectors by measuring text length of each candidate.
 * Pure function: creates a JSDOM-like environment via DOMParser if available,
 * otherwise falls back to regex heuristic.
 */
export function estimateSelectors(html: string): SelectorScore[] {
    // Prefer DOM-based scoring when DOMParser / document is available (jsdom / browser)
    // For Node without global document, try to use regex fallback unless caller
    // provides document via globalThis
    const doc = getDocument(html);
    if (doc) {
        const scores: SelectorScore[] = [];
        for (const sel of CANDIDATE_SELECTORS) {
            try {
                const els = doc.querySelectorAll(sel);
                if (els.length === 0) continue;
                let total = 0;
                els.forEach((el: Element) => {
                    const t = (el.textContent || '').trim();
                    total += t.length;
                });
                if (total > 0) {
                    scores.push({ selector: sel, textLength: total, elementCount: els.length });
                }
            } catch {
                // invalid selector — skip
            }
        }
        scores.sort((a, b) => b.textLength - a.textLength);
        return scores;
    }
    // Regex fallback: very coarse — counts text inside matched tags/classes
    return estimateSelectorsRegex(html);
}

function getDocument(html: string): Document | null {
    // Use global DOMParser if available (browser / jsdom setup)
    const g: unknown = globalThis as unknown as Record<string, unknown>;
    const gDoc = (g as Record<string, unknown>)['document'] as Document | undefined;
    // If global document exists and can parse, use it via creating new doc with DOMParser
    try {
        if (typeof (globalThis as unknown as Record<string, unknown>)['DOMParser'] !== 'undefined') {
            const Parser = (globalThis as unknown as { DOMParser: typeof DOMParser }).DOMParser;
            const parser = new Parser();
            const parsed = parser.parseFromString(html, 'text/html');
            if (parsed && parsed.body) return parsed;
        }
        // Fallback: if global document exists, create element
        if (gDoc && typeof gDoc.createElement === 'function') {
            // Use JSDOM via dynamic check — caller may have set up jsdom globals
            // Create temporary container
            const template = gDoc.createElement('template') as HTMLTemplateElement;
            template.innerHTML = html;
            // Not a full document, but we can use template.content as root — approximate
            // Instead, return gDoc after injecting html into a div
            // Simpler: create new div and use querySelectorAll on it
            // But to keep interface, we just try to use gDoc
            // If we reach here, we likely have jsdom globals set; create doc via innerHTML
            // Create a standalone document using createElement approach
            const container = gDoc.createElement('div');
            container.innerHTML = html;
            // Wrap in a fake document-like object with querySelectorAll
            // We return container as document-like if it supports querySelectorAll
            return container as unknown as Document;
        }
    } catch {
        return null;
    }
    return null;
}

function estimateSelectorsRegex(html: string): SelectorScore[] {
    const scores: SelectorScore[] = [];
    // Map candidate to regex pattern
    const patterns: Record<string, RegExp> = {
        article: /<article[^>]*>([\s\S]*?)<\/article>/gi,
        main: /<main[^>]*>([\s\S]*?)<\/main>/gi,
        '.post-content': /class="[^"]*post-content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
        '.entry-content': /class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
        '#content': /id="content"[^>]*>([\s\S]*?)<\/div>/gi,
        '.article-body': /class="[^"]*article-body[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
        '#article-body': /id="article-body"[^>]*>([\s\S]*?)<\/div>/gi,
        '.post': /class="[^"]*\bpost\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
        '.entry': /class="[^"]*\bentry\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
        '.content': /class="[^"]*\bcontent\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
        '#main': /id="main"[^>]*>([\s\S]*?)<\/div>/gi,
        '.main-content': /class="[^"]*main-content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    };
    for (const sel of CANDIDATE_SELECTORS) {
        const re = patterns[sel];
        if (!re) continue;
        let total = 0;
        let count = 0;
        let m: RegExpExecArray | null;
        // Reset lastIndex
        re.lastIndex = 0;
        while ((m = re.exec(html)) !== null) {
            const inner = (m[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            total += inner.length;
            count++;
        }
        if (count > 0 && total > 0) {
            scores.push({ selector: sel, textLength: total, elementCount: count });
        }
    }
    scores.sort((a, b) => b.textLength - a.textLength);
    return scores;
}

export function toHostname(urlOrHost: string): string {
    try {
        const u = new URL(urlOrHost);
        return u.hostname;
    } catch {
        // Assume bare hostname
        return urlOrHost.replace(/^https?:\/\//, '').split('/')[0] || urlOrHost;
    }
}

export function toAdapterName(hostname: string): string {
    return hostname.replace(/^www\./, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom';
}

export function generateAdapterDraft(sourceUrl: string, html: string): AdapterDraft {
    const hostname = toHostname(sourceUrl);
    const candidates = estimateSelectors(html);
    const top = candidates[0];
    const detectSelector = top?.selector ?? 'article';
    // Pick top 1-2 selectors with significant text (>= 30% of top)
    const contentSelectors: string[] = [];
    if (top) {
        contentSelectors.push(top.selector);
        for (let i = 1; i < candidates.length && contentSelectors.length < 2; i++) {
            const c = candidates[i]!;
            if (c.textLength >= top.textLength * 0.3) {
                // Avoid duplicates like 'article' and '#article-body' both containing same text — keep distinct
                if (!contentSelectors.includes(c.selector)) contentSelectors.push(c.selector);
            }
        }
    } else {
        contentSelectors.push('article');
    }
    return {
        hostname,
        name: toAdapterName(hostname),
        detectSelector,
        contentSelectors,
        excludeSelectors: [],
        metadataPatterns: [],
        candidates,
        generatedAt: new Date().toISOString(),
        sourceUrl,
    };
}

export function buildLlmPrompt(html: string, hostname: string): string {
    const truncated = html.length > 8000 ? html.slice(0, 8000) + '\n...[truncated]' : html;
    const fewShot = `既存アダプタ例:
- togetter.com -> detect: .tweet_body, content: [.tweet_body, .item_text]
- wikipedia.org -> detect: #mw-content-text, content: [div.mw-parser-output], exclude: [.mw-editsection, .reflist, .navbox]
- zenn.dev -> detect: .znc-Either, content: [.znc-Either]`;

    return `# ホワイトリストアダプタ生成プロンプト

対象ホスト: ${hostname}

${fewShot}

以下のHTMLから本文セレクタを推論せよ。

## 制約
- 本文を最も多く含む要素の CSS セレクタを 1〜3 個提案すること
- 広告・ナビ・サイドバー・コメント欄は除外すること
- \`article\`, \`main\`, \`.post-content\`, \`.entry-content\`, \`#content\` 等の汎用セレクタを優先して検討すること
- 広すぎるセレクタ (\`body\`, \`div\`, \`*\`) は提案しないこと
- 回答は JSON 形式で: \`{"detectSelector": "...", "contentSelectors": ["..."], "excludeSelectors": ["..."], "reason": "..."}\`

## HTML

\`\`\`html
${truncated}
\`\`\`

## 回答

上記 JSON のみを出力せよ。
`;
}
