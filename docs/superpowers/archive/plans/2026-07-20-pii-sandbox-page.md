# PII サンドボックスページ実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `src/utils/piiSanitizer.ts` のマスキングロジックを GitHub Pages 上で動作するサンドボックスページとして公開し、ユーザーがブラウザ上で PII マスキングを検証できるようにする。

**Architecture:** `sanitizeRegex()` を `esbuild` で IIFE バンドルし、`docs/assets/pii-sandbox.js` として出力。HTML から `PiiSandbox.sanitize()` を呼び出して結果を描画。ハイライト表示のため `includeIndices` オプションを `piiSanitizer.ts` に追加する。

**Tech Stack:** TypeScript, esbuild, GitHub Pages, vanilla JS + HTML/CSS

---

## ファイル構成 / File Structure

| ファイル | 責任 |
|----------|------|
| `src/utils/piiSanitizer.ts` | `includeIndices` オプションを追加（既存機能は変更なし） |
| `src/utils/__tests__/piiSanitizer.test.ts` | `includeIndices` のテストを追加 |
| `docs-src/pii-sandbox.ts` | バンドルエントリーポイント。`sanitizeRegex()` をラップしてグローバルに公開 |
| `docs/pii-sandbox.html` | サンドボックスページ本体 |
| `docs/index.html` | ナビゲーションに PII Sandbox リンクを追加 |
| `docs/PII_FEATURE_GUIDE.md` | PII 検出セクションに Sandbox リンクを追加 |
| `package.json` | `build:docs-pii` スクリプトと `esbuild` devDependency を追加 |
| `package-lock.json` | 依存更新 |
| `.github/workflows/pages.yml` | デプロイ前に `npm run build:docs-pii` を実行 |

---

## Task 1: `piiSanitizer.ts` に `includeIndices` オプションを追加

**Files:**
- Modify: `src/utils/piiSanitizer.ts:159-168`, `src/utils/piiSanitizer.ts:198-205`, `src/utils/piiSanitizer.ts:320-326`
- Test: `src/utils/__tests__/piiSanitizer.test.ts`

- [ ] **Step 1: `SanitizeOptions` に `includeIndices` を追加**

```typescript
export interface SanitizeOptions {
    timeout?: number;
    skipSizeLimit?: boolean;
    includeIndices?: boolean;
}
```

- [ ] **Step 2: `sanitizeRegex()` のデストラクチャに `includeIndices` を追加**

```typescript
const { timeout = DEFAULT_TIMEOUT, skipSizeLimit = false, includeIndices = false } = options;
```

- [ ] **Step 3: 返り値の `maskedItems` 生成時に `index` を含める条件を追加**

既存の処理：

```typescript
finalMaskedItems.push({ type: r.type, original: r.original, index: r.index });
```

`resultItems` 生成部分を以下に変更：

```typescript
const resultItems = finalMaskedItems.map(item =>
    includeIndices
        ? { type: item.type, original: item.original, index: item.index }
        : { type: item.type, original: item.original }
);
```

- [ ] **Step 4: 既存テストを確認し、`index` が含まれないことを検証**

```bash
npm test -- src/utils/__tests__/piiSanitizer.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 5: `includeIndices` のテストを追加**

`src/utils/__tests__/piiSanitizer.test.ts` の末尾または既存 describe ブロックに追加：

```typescript
    test('includeIndices オプションでマスク位置を取得できる', async () => {
      const text = 'メール: user@example.com';
      const result = await sanitizeRegex(text, { includeIndices: true }) as SanitizeResult;

      expect(result.text).toBe('メール: [MASKED:email]');
      expect(result.maskedItems).toHaveLength(1);
      expect(result.maskedItems[0]).toMatchObject({
        type: 'email',
        original: 'user@example.com',
        index: 5,
      });
    });

    test('includeIndices=false のとき index は含まれない', async () => {
      const text = 'メール: user@example.com';
      const result = await sanitizeRegex(text) as SanitizeResult;

      expect(result.maskedItems[0]).not.toHaveProperty('index');
    });
```

- [ ] **Step 6: テストを実行**

```bash
npm test -- src/utils/__tests__/piiSanitizer.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/utils/piiSanitizer.ts src/utils/__tests__/piiSanitizer.test.ts
git commit -m "feat(pii): sanitizeRegex に includeIndices オプションを追加"
```

---

## Task 2: `esbuild` を依存に追加

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: `esbuild` を devDependencies に追加**

```bash
npm install --save-dev esbuild
```

- [ ] **Step 2: `package-lock.json` が更新されたことを確認**

```bash
git diff package.json package-lock.json
```

Expected: `esbuild` が `devDependencies` に追加されている

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): esbuild を devDependencies に追加"
```

---

## Task 3: `docs-src/pii-sandbox.ts` を作成

**Files:**
- Create: `docs-src/pii-sandbox.ts`

- [ ] **Step 1: ファイルを作成**

```typescript
import { sanitizeRegex, MAX_INPUT_SIZE } from '../src/utils/piiSanitizer.js';
import type { SanitizeResult } from '../src/utils/piiSanitizer.js';

export interface SandboxResult extends SanitizeResult {
  durationMs: number;
}

export async function sanitize(text: string): Promise<SandboxResult> {
  const start = performance.now();
  const result = await sanitizeRegex(text, { includeIndices: true });
  const durationMs = Math.round(performance.now() - start);
  return { ...result, durationMs };
}

export { MAX_INPUT_SIZE };
```

- [ ] **Step 2: ビルドして型チェックを兼ねる**

```bash
npm run build:docs-pii
```

Expected: エラーなし。`docs/assets/pii-sandbox.js` が生成される。

- [ ] **Step 3: Commit**

```bash
git add docs-src/pii-sandbox.ts
git commit -m "feat(docs): PII sandbox エントリーポイントを追加"
```

---

## Task 4: バンドルスクリプトを追加し、ビルドを確認

**Files:**
- Modify: `package.json`
- Create: `docs/assets/pii-sandbox.js`（ビルド成果物）

- [ ] **Step 1: `package.json` の scripts に `build:docs-pii` を追加**

```json
"build:docs-pii": "esbuild docs-src/pii-sandbox.ts --bundle --outfile=docs/assets/pii-sandbox.js --format=iife --global-name=PiiSandbox"
```

- [ ] **Step 2: ビルド実行**

```bash
npm run build:docs-pii
```

Expected: `docs/assets/pii-sandbox.js` が生成される

- [ ] **Step 3: 生成物がグローバル `PiiSandbox` を公開していることを確認**

```bash
grep -n "var PiiSandbox" docs/assets/pii-sandbox.js | head -5
```

Expected: `var PiiSandbox =` または同様の IIFE ヘッダーが含まれる

- [ ] **Step 4: Commit**

```bash
git add package.json docs/assets/pii-sandbox.js
git commit -m "chore(docs): PII sandbox バンドルスクリプトを追加"
```

---

## Task 5: `docs/pii-sandbox.html` を作成

**Files:**
- Create: `docs/pii-sandbox.html`

- [ ] **Step 1: ページを作成**

以下の完全な HTML を `docs/pii-sandbox.html` として作成する。スタイルは既存 `docs/index.html` のダークテーマと整合させる。

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PII Sandbox — Yasumaro</title>
  <meta name="description" content="Yasumaro の PII マスキング動作をブラウザで確認できるサンドボックス。">
  <link rel="icon" href="https://github.com/armaniacs/yasumaro/raw/main/public/icons/icon128.png">
  <style>
    :root {
      --purple: #7c3aed;
      --purple-light: #a78bfa;
      --purple-dark: #5b21b6;
      --obsidian: #1e1e2e;
      --obsidian-mid: #2a2a3e;
      --obsidian-light: #313244;
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --green: #34d399;
      --red: #f87171;
      --radius: 12px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      background: var(--obsidian);
      color: var(--text);
      line-height: 1.7;
    }
    a { color: var(--purple-light); text-decoration: none; }
    a:hover { text-decoration: underline; }
    nav {
      position: sticky; top: 0; z-index: 100;
      background: rgba(30, 30, 46, 0.92);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--obsidian-light);
      padding: 0 2rem;
      display: flex; align-items: center; justify-content: space-between;
      height: 60px; gap: 1rem;
    }
    .nav-logo { font-weight: 700; font-size: 1.1rem; color: var(--text); display: flex; align-items: center; gap: 0.5rem; }
    .nav-center { display: flex; gap: 1.5rem; font-size: 0.9rem; }
    .nav-center a { color: var(--text-muted); }
    .nav-center a:hover { color: var(--text); text-decoration: none; }
    .lang-toggle { display: flex; background: var(--obsidian-light); border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); }
    .lang-btn { background: none; border: none; color: var(--text-muted); font-size: 0.78rem; font-weight: 600; padding: 0.3rem 0.6rem; cursor: pointer; }
    .lang-btn.active { background: var(--purple); color: #fff; }
    main { max-width: 900px; margin: 0 auto; padding: 3rem 1.5rem 6rem; }
    h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    .subtitle { color: var(--text-muted); margin-bottom: 2rem; }
    .section { background: var(--obsidian-mid); border: 1px solid var(--obsidian-light); border-radius: var(--radius); padding: 1.5rem; margin-bottom: 1.5rem; }
    .section h2 { font-size: 1.1rem; margin-bottom: 1rem; color: var(--text); }
    .preset-grid { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem; }
    .preset-btn { background: var(--obsidian-light); color: var(--text); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 0.4rem 0.8rem; cursor: pointer; font-size: 0.85rem; }
    .preset-btn:hover { background: var(--purple-dark); }
    textarea, .output-box {
      width: 100%; background: var(--obsidian); color: var(--text);
      border: 1px solid var(--obsidian-light); border-radius: 8px;
      padding: 1rem; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.95rem; line-height: 1.6; resize: vertical;
    }
    textarea { min-height: 140px; }
    .primary-btn {
      background: var(--purple); color: #fff; border: none; border-radius: 8px;
      padding: 0.75rem 1.5rem; font-weight: 600; cursor: pointer; margin-top: 1rem;
    }
    .primary-btn:hover { background: var(--purple-dark); }
    .highlight { background: rgba(248, 113, 113, 0.25); padding: 0 2px; border-radius: 3px; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.75rem; margin-top: 1rem; }
    .summary-card { background: var(--obsidian); border: 1px solid var(--obsidian-light); border-radius: 8px; padding: 0.75rem; }
    .summary-card .type { font-size: 0.75rem; color: var(--text-muted); }
    .summary-card .count { font-size: 1.25rem; font-weight: 700; color: var(--green); }
    .detail-table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.9rem; }
    .detail-table th, .detail-table td { text-align: left; padding: 0.5rem; border-bottom: 1px solid var(--obsidian-light); }
    .detail-table th { color: var(--text-muted); font-weight: 600; }
    .meta { color: var(--text-muted); font-size: 0.85rem; margin-top: 0.5rem; }
    .empty { color: var(--text-muted); font-style: italic; }
    [data-i18n] { display: block; }
  </style>
</head>
<body>
  <nav>
    <a class="nav-logo" href="index.html">
      <img src="https://github.com/armaniacs/yasumaro/raw/main/public/icons/icon128.png" alt="" width="28" height="28">
      Yasumaro
    </a>
    <div class="nav-center">
      <a href="index.html">Home</a>
      <a href="pii-sandbox.html">PII Sandbox</a>
    </div>
    <div class="lang-toggle">
      <button class="lang-btn active" data-lang="ja">JA</button>
      <button class="lang-btn" data-lang="en">EN</button>
    </div>
  </nav>

  <main>
    <h1 data-i18n="title">PII マスキングサンドボックス</h1>
    <p class="subtitle" data-i18n="subtitle">Yasumaro と同じロジックで、個人情報がどのようにマスクされるかを確認できます。</p>

    <div class="section">
      <h2 data-i18n="presets">プリセット例</h2>
      <div class="preset-grid" id="presetButtons"></div>
    </div>

    <div class="section">
      <h2 data-i18n="input">入力テキスト</h2>
      <textarea id="inputText" placeholder="ここにテキストを貼り付けてください"></textarea>
      <button class="primary-btn" id="runButton" data-i18n="run">マスクを実行</button>
      <p class="meta" id="inputMeta"></p>
    </div>

    <div class="section" id="outputSection" style="display:none;">
      <h2 data-i18n="output">マスク結果</h2>
      <pre class="output-box" id="maskedOutput"></pre>

      <h2 data-i18n="highlight">元テキストでの検出箇所</h2>
      <div class="output-box" id="highlightOutput"></div>

      <h2 data-i18n="summary">サマリー</h2>
      <div class="summary-grid" id="summaryOutput"></div>

      <h2 data-i18n="details">個別マスク一覧</h2>
      <table class="detail-table">
        <thead>
          <tr><th data-i18n="detailType">タイプ</th><th data-i18n="detailOriginal">元の値</th></tr>
        </thead>
        <tbody id="detailOutput"></tbody>
      </table>
      <p class="meta" id="durationMeta"></p>
    </div>
  </main>

  <script src="assets/pii-sandbox.js"></script>
  <script>
    const i18n = {
      ja: {
        title: 'PII マスキングサンドボックス',
        subtitle: 'Yasumaro と同じロジックで、個人情報がどのようにマスクされるかを確認できます。',
        presets: 'プリセット例',
        input: '入力テキスト',
        run: 'マスクを実行',
        output: 'マスク結果',
        highlight: '元テキストでの検出箇所',
        summary: 'サマリー',
        details: '個別マスク一覧',
        detailType: 'タイプ',
        detailOriginal: '元の値',
        noMask: 'マスク対象は検出されませんでした',
        chars: '文字',
        duration: '処理時間',
        ms: 'ms',
      },
      en: {
        title: 'PII Masking Sandbox',
        subtitle: 'See how Yasumaro masks personal information using the same logic as the extension.',
        presets: 'Preset examples',
        input: 'Input text',
        run: 'Run masking',
        output: 'Masked output',
        highlight: 'Detected positions in original text',
        summary: 'Summary',
        details: 'Masked items',
        detailType: 'Type',
        detailOriginal: 'Original value',
        noMask: 'No PII was detected',
        chars: 'characters',
        duration: 'Processing time',
        ms: 'ms',
      }
    };

    const presets = [
      { label: 'email', text: 'contact: user@example.com' },
      { label: 'creditCard', text: 'Card: 4111-1111-1111-1111' },
      { label: 'phoneJp', text: 'TEL: 090-1234-5678' },
      { label: 'myNumber', text: 'MyNumber: 1234-5678-9012' },
      { label: 'iban', text: 'IBAN: DE89370400440532013000' },
      { label: 'deTaxId', text: 'Steuer-ID: 12345678901' },
      { label: 'frInsee', text: 'INSEE: 123456789012345' },
      { label: 'itCodiceFiscale', text: 'CF: RSSMRA85T10A562S' },
      { label: 'esDni', text: 'DNI: 12345678A' },
      { label: 'esNie', text: 'NIE: X1234567A' },
    ];

    let currentLang = 'ja';

    function setLang(lang) {
      currentLang = lang;
      document.documentElement.lang = lang;
      document.querySelectorAll('.lang-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.lang === lang));
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (i18n[lang][key]) el.textContent = i18n[lang][key];
      });
      document.querySelector('#inputText').placeholder = lang === 'ja'
        ? 'ここにテキストを貼り付けてください'
        : 'Paste text here';
    }

    function escapeHtml(str) {
      return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }

    function renderHighlights(original, items) {
      if (!items.length) return `<span class="empty">${i18n[currentLang].noMask}</span>`;
      const sorted = [...items].sort((a, b) => (b.index ?? 0) - (a.index ?? 0));
      let html = escapeHtml(original);
      for (const item of sorted) {
        const idx = item.index ?? 0;
        const before = html.slice(0, idx);
        const target = html.slice(idx, idx + item.original.length);
        const after = html.slice(idx + item.original.length);
        html = before + `<span class="highlight" title="${escapeHtml(item.type)}">${target}</span>` + after;
      }
      return html;
    }

    async function run() {
      const text = document.querySelector('#inputText').value;
      const result = await PiiSandbox.sanitize(text);

      document.querySelector('#maskedOutput').textContent = result.text;
      document.querySelector('#highlightOutput').innerHTML = renderHighlights(text, result.maskedItems);
      document.querySelector('#inputMeta').textContent = `${text.length} ${i18n[currentLang].chars}`;

      const counts = {};
      result.maskedItems.forEach(item => { counts[item.type] = (counts[item.type] || 0) + 1; });
      document.querySelector('#summaryOutput').innerHTML = Object.entries(counts)
        .map(([type, count]) => `<div class="summary-card"><div class="type">${escapeHtml(type)}</div><div class="count">${count}</div></div>`)
        .join('') || `<span class="empty">${i18n[currentLang].noMask}</span>`;

      document.querySelector('#detailOutput').innerHTML = result.maskedItems
        .map(item => `<tr><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.original)}</td></tr>`)
        .join('') || `<tr><td colspan="2" class="empty">${i18n[currentLang].noMask}</td></tr>`;

      document.querySelector('#durationMeta').textContent = `${i18n[currentLang].duration}: ${result.durationMs}${i18n[currentLang].ms}`;
      document.querySelector('#outputSection').style.display = 'block';
    }

    function init() {
      const presetContainer = document.querySelector('#presetButtons');
      presets.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'preset-btn';
        btn.textContent = p.label;
        btn.addEventListener('click', () => { document.querySelector('#inputText').value = p.text; });
        presetContainer.appendChild(btn);
      });

      document.querySelector('#runButton').addEventListener('click', run);
      document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.addEventListener('click', () => setLang(btn.dataset.lang));
      });
      setLang('ja');
    }

    init();
  </script>
</body>
</html>
```

- [ ] **Step 2: ローカルで開いて動作確認**

```bash
open docs/pii-sandbox.html
```

または `npx serve docs` でサーバーを立ち上げブラウザで開く。

確認項目：
- プリセットボタンをクリックするとサンプルテキストが入力される
- 「マスクを実行」で `[MASKED:*]` 形式の出力が表示される
- サマリーにタイプ別件数が表示される
- 元テキストのマスク箇所がハイライトされる

- [ ] **Step 3: Commit**

```bash
git add docs/pii-sandbox.html
git commit -m "feat(docs): PII sandbox ページを追加"
```

---

## Task 6: 既存ページに導線を追加

**Files:**
- Modify: `docs/index.html`
- Modify: `docs/PII_FEATURE_GUIDE.md`

- [ ] **Step 1: `docs/index.html` のナビゲーションにリンク追加**

```html
<a href="pii-sandbox.html">PII Sandbox</a>
```

- [ ] **Step 2: `docs/PII_FEATURE_GUIDE.md` にリンク追加**

日本語セクションの「PII検出 (Regex)」の直後に追加：

```markdown
実際に試すには [PII Sandbox](pii-sandbox.html) を開いてください。
```

英語セクションの対応箇所にも同様に追加：

```markdown
Try it at [PII Sandbox](pii-sandbox.html).
```

- [ ] **Step 3: Commit**

```bash
git add docs/index.html docs/PII_FEATURE_GUIDE.md
git commit -m "docs(docs): PII Sandbox ページへの導線を追加"
```

---

## Task 7: GitHub Pages ワークフローを更新

**Files:**
- Modify: `.github/workflows/pages.yml`

- [ ] **Step 1: ビルドステップを追加**

`Generate API docs (typedoc)` ステップの直後に追加：

```yaml
      - name: Build PII sandbox bundle
        run: npm run build:docs-pii
```

- [ ] **Step 2: paths トリガーに `docs-src/**` を追加**

```yaml
on:
  push:
    branches: [main]
    paths:
      - "docs/**"
      - "docs-src/**"
      - "src/**/*.ts"
      - "typedoc.json"
      - "dev-docs/typedoc.json"
      - ".github/workflows/pages.yml"
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pages.yml
git commit -m "ci(pages): PII sandbox バンドルをデプロイ前にビルド"
```

---

## Task 8: 最終検証

- [ ] **Step 1: `npm run type-check`**

```bash
npm run type-check
```

Expected: エラーなし

- [ ] **Step 2: `npm test`**

```bash
npm test -- --no-coverage
```

Expected: 全テスト PASS

- [ ] **Step 3: `npm run build:docs-pii`**

```bash
npm run build:docs-pii
```

Expected: `docs/assets/pii-sandbox.js` が最新状態で生成される

- [ ] **Step 4: ローカルサーバーでページ全体を確認**

```bash
npx serve docs
```

ブラウザで `http://localhost:3000/pii-sandbox.html` を開き、各 PII パターンのマスクを確認。

- [ ] **Step 5: Commit 生成物（最新のバンドル）**

```bash
git add docs/assets/pii-sandbox.js
git commit -m "chore(docs): PII sandbox バンドルを再生成"
```

---

## セルフレビュー / Self-Review

### Spec カバレッジ
- [x] 全 PII パターンをカバー → Task 5 のプリセット例と自由入力で対応
- [x] `sanitizeRegex()` をそのままバンドル → Task 3, 4
- [x] `includeIndices` オプション → Task 1
- [x] 日英バイリンガル → Task 5 の HTML と Task 6 のドキュメント
- [x] 既存ページへの導線 → Task 6
- [x] GitHub Pages ワークフロー → Task 7

### Placeholder チェック
- 計画内に "TBD" / "TODO" / "あとで実装" は含まれていない
- すべてのステップに具体的なファイルパスとコマンドがある

### 型一貫性
- `SanitizeOptions.includeIndices?: boolean`
- `SandboxResult` は `SanitizeResult` を拡張
- HTML からは `PiiSandbox.sanitize(text)` を呼び出し

---

## 実行方式の選択 / Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-20-pii-sandbox-page.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
