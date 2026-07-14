# Japanese Corporate Site "O-Sahou" Patterns — NAV Extension

**Date:** 2026-07-14
**Branch:** feat/ai-summary-cleansing
**Status:** Design

## Motivation

日本の企業サイト（コーポレートサイト）では、フッターやサイドバーに「お作法」と呼べる決まり文句・共通エリアが存在する。会社概要、お知らせ一覧、プライバシーポリシー、サイトマップなど。これらは記事本文ではなくサイトクロームであり、AI要約のノイズとなる。

既存の `NAV_CLASS_PATTERNS`（デフォルト ON）には `corp-info`、`copyright`、`terms` 等が既に含まれているが、以下のパターンが欠落している。

## Design

### 追加パターン

`NAV_CLASS_PATTERNS` に以下 7 パターンを追加する：

| パターン | 意味 | 出現箇所 |
|---------|------|---------|
| `company-info` | 会社概要ミニマップ | フッター・サイドバー |
| `news-release` | お知らせ一覧 | サイドバー |
| `topics-list` | トピックス一覧 | サイドバー |
| `sitemap` | サイトマップ | フッター |
| `site-map` | サイトマップ（ハイフン区切り） | フッター |
| `copy-right` | コピーライト表記の変種 | フッター |
| `privacy-policy` | プライバシーポリシーリンク | フッター（DEEP から移動） |

### 除外パターン

| パターン | 除外理由 |
|---------|---------|
| `copy` | 4文字。`[class*="copy"]` は `copy-button`、`copy-code`、`copy-clipboard` 等に衝突し、技術ブログのコードブロックを破壊するリスクが高い。`copyright`（9文字）で既にカバーされている |

### DEEP_CLASS_PATTERNS からの `privacy-policy` 削除

`privacy-policy` は現在 `DEEP_CLASS_PATTERNS`（デフォルト OFF）に含まれているが、`terms`、`legal`、`disclaimer` と同等のリスクプロファイルであり、NAV（デフォルト ON）に移動する。

分類原則: **サイトクローム（全ページの同じ位置に出現するナビ・フッター・サイドバー・法的定型文）は NAV。ページのメインコンテンツになり得るものは DEEP。**

`privacy-policy` がメインコンテンツのページでは body protection が高スコアで保護するため、誤検出リスクは既に緩和されている。

### 変更ファイル

| File | Change |
|------|--------|
| `src/utils/aiSummaryCleaner/patterns.ts` | `NAV_CLASS_PATTERNS` に 7 パターン追加。`DEEP_CLASS_PATTERNS` から `privacy-policy` を削除 |
| `src/utils/aiSummaryCleaner/__tests__/stripCore.test.ts` または `stripCore-r2.test.ts` | NAV パターン追加確認テスト（1件） |

### 影響

| 項目 | 内容 |
|------|------|
| ユーザー影響 | 即時（NAV はデフォルト ON）。全ユーザーの日本企業サイト閲覧時にフッター・サイドバーのお作法パターンが削除される |
| 設定画面 | 変更不要（既存の nav チェックボックスに統合） |
| 誤検出リスク | 低。全パターンが7文字以上で十分に固有。body protection がメインコンテンツ内の一致を防御 |

## Test Strategy

- 既存の NAV パターンテストに `company-info` 等の追加パターンが削除されることを確認
- `privacy-policy` が NAV 適用時に削除されることを確認（DEEP から移動後）
- `copy` 単体が追加されていないことの確認（陰性テスト）
