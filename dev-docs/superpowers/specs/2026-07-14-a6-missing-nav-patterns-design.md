# A-6 Missing Japanese Nav/Auxiliary Patterns

**Date:** 2026-07-14
**Branch:** feat/ai-summary-cleansing
**Status:** Design

## Motivation

Category A-6（日本ブログ UI コンポーネント）の実装時に、以下の 5 パターンが漏れていた。すべて `stripJPLayoutPatterns`（jpLayout ゲート配下、新規ユーザーデフォルト ON）に追加する。

## Design

### 追加パターン

| パターン | カテゴリ | 意味 |
|---------|---------|------|
| `go-to-top` | ページトップへ戻る | `go-top` の別表記 |
| `hamburger-menu` | スマホ用メニュー | `hamburger` の補完（-menu 付き） |
| `side-column` | サブ情報 | サイドカラム |
| `widget-area` | サブ情報 | ウィジェットエリア |
| `p-toc` | 目次 | SANGO/JIN 系の目次プレフィックス |

### 変更ファイル

| File | Change |
|------|--------|
| `src/utils/aiSummaryCleaner/stripExtended.ts` | `stripJPLayoutPatterns` のパターン配列に 5 パターン追加 |
| `src/utils/aiSummaryCleaner/countTargets.ts` | `jpLayoutPatterns` 配列に同 5 パターン追加 |

### 影響

| 項目 | 内容 |
|------|------|
| ユーザー影響 | `jpLayoutEnabled` のゲートに従う（新規ユーザーはデフォルト ON、既存ユーザーはマイグレーションで OFF）。設定画面の変更不要 |
| 誤検出リスク | 低。全パターンが 7 文字以上で十分に固有 |
| テスト | 既存の Category A stripExtended テストに 1-2 件追記 |
