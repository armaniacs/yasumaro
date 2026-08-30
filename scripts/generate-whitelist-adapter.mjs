#!/usr/bin/env node
/**
 * generate-whitelist-adapter.mjs — ホワイトリストアダプタ雛形を生成するヘルパー
 *
 * 使い方:
 *   node scripts/generate-whitelist-adapter.mjs https://example.com
 *   node scripts/generate-whitelist-adapter.mjs https://example.com --html "<html>..."
 *   node scripts/generate-whitelist-adapter.mjs https://example.com --html-file ./page.html
 *   node scripts/generate-whitelist-adapter.mjs --help
 *
 * 出力:
 *   dev-docs/whitelist-adapter-draft.json  — 推定結果 JSON（手動レビュー後に whitelistAdapters.ts へ反映）
 *   dev-docs/whitelist-adapter-prompt.md   — LLM に投げるプロンプトテンプレート
 *
 * 本スクリプトは既存 whitelistAdapters.ts の手動定義を壊さず、fetch はオプショナル。
 * fetch 失敗時はサンプル HTML でフォールバックする。
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const CANDIDATE_SELECTORS = [
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

const SAMPLE_HTML = `<!DOCTYPE html><html><body>
<article><p>This is the main article content. It contains enough text to be considered the primary content of the page. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p><p>Second paragraph with more content to increase text length significantly.</p></article>
<div class="sidebar">sidebar ads</div>
</body></html>`;

function printHelp() {
  console.log(`
Usage: node scripts/generate-whitelist-adapter.mjs [URL] [options]

Arguments:
  URL                          対象ページの URL (例: https://example.com)

Options:
  --help, -h                   このヘルプを表示
  --html <string>              HTML を直接渡す（fetch せずに解析）
  --html-file <path>           HTML ファイルのパスを渡す
  --out <path>                 draft JSON の出力先 (default: dev-docs/whitelist-adapter-draft.json)
  --prompt-out <path>          プロンプト出力先 (default: dev-docs/whitelist-adapter-prompt.md)
  --no-prompt                  プロンプトファイルを生成しない
  --stdout                     JSON をファイルではなく stdout に出力

Examples:
  node scripts/generate-whitelist-adapter.mjs https://example.com
  node scripts/generate-whitelist-adapter.mjs https://example.com --html "<html>..."
  node scripts/generate-whitelist-adapter.mjs example.com --html-file ./page.html --out ./draft.json

Flow:
  1. HTML を取得（--html / --html-file / fetch の優先順）
  2. 候補セレクタごとにテキスト量を計測し、最もテキストが多い要素を推定
  3. dev-docs/whitelist-adapter-draft.json に雛形を出力
  4. dev-docs/whitelist-adapter-prompt.md に LLM プロンプトを出力
  5. 手動レビュー後に src/utils/contentExtractor/whitelistAdapters.ts に反映
`.trim());
}

function parseArgs(argv) {
  const args = { url: null, html: null, htmlFile: null, out: null, promptOut: null, noPrompt: false, stdout: false, help: false };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--html') args.html = argv[++i] ?? null;
    else if (a === '--html-file') args.htmlFile = argv[++i] ?? null;
    else if (a === '--out') args.out = argv[++i] ?? null;
    else if (a === '--prompt-out') args.promptOut = argv[++i] ?? null;
    else if (a === '--no-prompt') args.noPrompt = true;
    else if (a === '--stdout') args.stdout = true;
    else if (a.startsWith('--')) {
      console.error(`Unknown option: ${a}`);
      args.help = true;
    } else {
      positional.push(a);
    }
  }
  if (positional.length > 0) args.url = positional[0];
  return args;
}

function toHostname(urlOrHost) {
  try {
    const u = new URL(urlOrHost);
    return u.hostname;
  } catch {
    return urlOrHost.replace(/^https?:\/\//, '').split('/')[0] || urlOrHost;
  }
}

function toAdapterName(hostname) {
  return hostname.replace(/^www\./, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom';
}

async function getHtml(args) {
  if (args.html) return { html: args.html, source: 'arg --html' };
  if (args.htmlFile) {
    const p = resolve(args.htmlFile);
    try {
      const html = readFileSync(p, 'utf8');
      return { html, source: `file ${p}` };
    } catch (e) {
      console.error(`[generate-whitelist-adapter] Failed to read --html-file ${p}: ${e.message}`);
      process.exit(1);
    }
  }
  if (args.url) {
    const url = args.url.startsWith('http') ? args.url : `https://${args.url}`;
    try {
      console.log(`[generate-whitelist-adapter] Fetching ${url} ...`);
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'yasumaro-whitelist-generator/1.0' } });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const html = await res.text();
      console.log(`[generate-whitelist-adapter] Fetched ${html.length} chars from ${url}`);
      return { html, source: url };
    } catch (e) {
      console.warn(`[generate-whitelist-adapter] Fetch failed (${e.message}), falling back to sample HTML`);
      return { html: SAMPLE_HTML, source: `${url} (fallback sample)` };
    }
  }
  console.warn('[generate-whitelist-adapter] No URL or HTML provided, using sample HTML');
  return { html: SAMPLE_HTML, source: 'sample' };
}

// Separate function for regex fallback (also used when jsdom unavailable)
function estimateSelectorsRegex(html) {
  const scores = [];
  const patterns = {
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
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(html)) !== null) {
      const inner = (m[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      total += inner.length;
      count++;
    }
    if (count > 0 && total > 0) scores.push({ selector: sel, textLength: total, elementCount: count });
  }
  scores.sort((a, b) => b.textLength - a.textLength);
  return scores;
}

async function estimateSelectors(html) {
  // Try to use jsdom via dynamic import (ESM). If not available, fallback.
  try {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const scores = [];
    for (const sel of CANDIDATE_SELECTORS) {
      try {
        const els = doc.querySelectorAll(sel);
        if (els.length === 0) continue;
        let total = 0;
        els.forEach((el) => {
          const t = (el.textContent || '').trim();
          total += t.length;
        });
        if (total > 0) scores.push({ selector: sel, textLength: total, elementCount: els.length });
      } catch {}
    }
    scores.sort((a, b) => b.textLength - a.textLength);
    if (scores.length > 0) return scores;
  } catch {
    // jsdom not available or failed
  }
  return estimateSelectorsRegex(html);
}

function buildLlmPrompt(html, hostname) {
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

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const sourceUrl = args.url ?? 'https://example.com';
  const { html, source } = await getHtml(args);
  const hostname = toHostname(sourceUrl);
  const candidates = await estimateSelectors(html);

  // Determine contentSelectors: top 1-2 with >=30% of top's length
  const top = candidates[0];
  const detectSelector = top?.selector ?? 'article';
  const contentSelectors = [];
  if (top) {
    contentSelectors.push(top.selector);
    for (let i = 1; i < candidates.length && contentSelectors.length < 2; i++) {
      const c = candidates[i];
      if (c.textLength >= top.textLength * 0.3 && !contentSelectors.includes(c.selector)) {
        contentSelectors.push(c.selector);
      }
    }
  } else {
    contentSelectors.push('article');
  }

  const draft = {
    hostname,
    name: toAdapterName(hostname),
    detectSelector,
    contentSelectors,
    excludeSelectors: [],
    metadataPatterns: [],
    candidates,
    generatedAt: new Date().toISOString(),
    sourceUrl: args.url ?? sourceUrl,
    source,
    // Template for whitelistAdapters.ts
    adapterTemplate: `{
        name: '${toAdapterName(hostname)}',
        domains: ['${hostname}'],
        detectSelector: '${detectSelector}',
        contentSelectors: [${contentSelectors.map((s) => `'${s}'`).join(', ')}],
    },`,
    notes: '手動レビュー後に src/utils/contentExtractor/whitelistAdapters.ts の WHITELIST_ADAPTERS に追加してください。candidates はテキスト量順。',
  };

  const outPath = resolve(args.out ?? resolve(projectRoot, 'dev-docs/whitelist-adapter-draft.json'));
  const promptOutPath = resolve(args.promptOut ?? resolve(projectRoot, 'dev-docs/whitelist-adapter-prompt.md'));

  if (args.stdout) {
    console.log(JSON.stringify(draft, null, 2));
  } else {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(draft, null, 2) + '\n', 'utf8');
    console.log(`[generate-whitelist-adapter] Draft written to ${outPath}`);
    console.log(`[generate-whitelist-adapter] Host: ${hostname}, detect: ${detectSelector}, content: ${contentSelectors.join(', ')}`);
    if (candidates.length > 0) {
      console.log('[generate-whitelist-adapter] Candidates (textLength desc):');
      candidates.slice(0, 5).forEach((c) => console.log(`  - ${c.selector}: ${c.textLength} chars (${c.elementCount} elements)`));
    } else {
      console.log('[generate-whitelist-adapter] No candidates matched — defaulting to article');
    }
    console.log(`[generate-whitelist-adapter] Adapter template:\n${draft.adapterTemplate}`);
  }

  if (!args.noPrompt) {
    const prompt = buildLlmPrompt(html, hostname);
    if (!args.stdout) {
      mkdirSync(dirname(promptOutPath), { recursive: true });
      writeFileSync(promptOutPath, prompt, 'utf8');
      console.log(`[generate-whitelist-adapter] Prompt written to ${promptOutPath}`);
    } else {
      console.log('\n--- LLM Prompt ---\n' + prompt);
    }
  }
}

await main();
