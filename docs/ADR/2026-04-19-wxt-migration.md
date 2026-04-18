# ADR-013: Vite + crxjs から WXT への移行

## Status

**Implemented** (2026-04-19)

## Context

当プロジェクトは `@crxjs/vite-plugin` を使用して Chrome Extension をビルドしていた。このプラグインは Rollup 2.79.2 にハード依存しており、Vite 8 / Rolldown への移行において根本的な互換性の問題を抱えていた。`package.json` の `overrides` で無理やり動かす綱渡りの運用が続いており、解消が急務だった。

## Decision

**WXT (Web Extension Toolbox) v0.20.25 を導入し、ビルドツールを全面移行する。**

`vite.config.ts` と `@crxjs/vite-plugin` を廃止し、WXT の `wxt.config.ts` に置き換える。既存の `src/` コード（5000行超）は変更せず、`entrypoints/` に薄いラッパーを配置して動的インポートするパターンを採用する。

## Consequences

### Positive

- Rolldown エンジン（Vite 8）の恩恵をそのまま享受できる
- `manifest.json` の手書き管理が不要になり、`wxt.config.ts` で型安全に記述できる
- `entrypoints/` 規約によりビルド対象が明確になる
- マルチブラウザ対応（Firefox / Safari）が標準サポートされる
- crxjs 由来の ESM / IIFE 変換の複雑さが解消される

### Negative

- WXT の出力ディレクトリが `dist/chromium-mv3/` となり、旧 `dist/` と異なる
- Chrome の「Load unpacked」で指定するパスが変わる
- Node v24 で `htmlparser2` の ESM 解決に問題があり、`overrides` での v12 固定が必要

## Implementation

### 採用したアーキテクチャ

```
entrypoints/
  background/index.ts       defineBackground + dynamic import → src/background/service-worker.js
  content/index.ts          defineContentScript → src/content/loader.js
  content-extractor.ts      defineUnlistedScript → src/content/extractor.js
  popup/index.html + main.ts
  options/index.html + main.ts
  permissions/index.html + main.ts
  offscreen.html            WXT unlisted page → src/offscreen/offscreen.js

public/
  icons/       ← git mv icons/ public/icons/
  _locales/    ← git mv _locales/ public/_locales/
  data/        ← git mv data/ public/data/
  PRIVACY.md
```

### WXT 実際の出力構造

```
dist/chromium-mv3/
  manifest.json
  popup.html                ← entrypoints/popup/index.html から
  options.html              ← entrypoints/options/index.html から
  permissions.html          ← entrypoints/permissions/index.html から
  offscreen.html            ← entrypoints/offscreen.html から（unlisted page）
  background.js
  content-extractor.js      ← entrypoints/content-extractor.ts から（unlisted script）
  content-scripts/
    content.js              ← entrypoints/content/index.ts から
  chunks/
  assets/
  icons/
  _locales/
  data/
```

### 判明した WXT の挙動・制約

| 事項 | 詳細 |
|------|------|
| content script パターン | `content/index.[jt]s` または `*.content.[jt]s` のみ認識。`content/loader.ts` は不可 |
| unlisted script の出力パス | `entrypoints/foo.ts` → `dist/foo.js`（ディレクトリを挟むと無視される場合あり） |
| HTML entrypoint のパス | `entrypoints/popup/index.html` → `popup.html`（`popup/index.html` ではない） |
| `manifest_version` の設定 | `wxt.config.ts` の `manifest.manifest_version` は無視される（WARNが出る）。`manifestVersion` オプションで指定 |
| `optional_host_permissions` | `<all_urls>` を `host_permissions` と両方に設定すると Chrome が redundant 警告を出す |
| Node v24 + htmlparser2 | v10/v12 の ESM パス解決が Node v24 の `finalizeResolution` と非互換。`overrides: { htmlparser2: "^12.0.0" }` で解消 |

### 変更されたランタイムパス

| 旧パス | 新パス |
|--------|--------|
| `chrome.runtime.getURL('content/extractor.js')` | `chrome.runtime.getURL('content-extractor.js')` |
| `chrome.runtime.getURL('dashboard/dashboard.html')` | `chrome.runtime.getURL('options.html')` |
| `chrome.runtime.getURL('privacy/privacy.html')` | `chrome.runtime.getURL('permissions.html')` |
| `chrome.offscreen.createDocument({ url: 'src/offscreen/offscreen.html' })` | `url: 'offscreen.html'` |

## Related

- [WXT Documentation](https://wxt.dev/)
- ADR-012: Vitest Migration（テスト環境）
- [plans/2026-04-18-wtx.md](../../plans/2026-04-18-wtx.md)
