# ADR: Markdown出力経路へのサニタイズ適用ルール

**日付**: 2026-07-22
**ステータス**: 承認済み
**関連**: PBI-01, PBI-02 (VulnHunter Fix Batch)

## 背景

VulnHunterセキュリティ監査（2026-07-21）で、AI生成サマリーやユーザー制御のURL/titleが
markdown出力に未サニタイズで埋め込まれる脆弱性（CWE-79）が複数の経路で発見された。

根本原因分析（5 Whys）の結果、問題の本質は「全markdown出力経路へのサニタイズ適用ルールの不在」
にあることが判明した。コードベースに `sanitizeForObsidian()` という共有ヘルパー関数が存在するにも
かかわらず、新規ファイル作成時にこの関数を適用する義務が明文化されておらず、結果として
4つの独立した出力経路（obsidianSyncService, gistSyncTarget, reviewSummaryGenerator,
exportLogsService）でサニタイズ漏れが発生した。

## 決定

以下の3層のガードレールを恒久的なルールとして確立する:

### 層1: 自動検出（lint rule）
- ESLintカスタムルール `local/require-sanitized-markdown` が全 `src/**/*.ts` ファイルに対して
  適用される
 - このルールはmarkdownテンプレートリテラル内の未サニタイズ変数を `error` レベルで検出する
- ルールは CI パイプラインで常時実行される

### 層2: レビューチェックリスト
- `.github/pull_request_template.md` に以下のチェック項目を追加:
  - "markdown出力: 新規/変更したmarkdownテンプレートには `sanitizeForObsidian()` または
    `sanitizeUrlForMarkdownTarget()` が適用されている"
- 全PRでセキュリティレビューの一部として確認を必須とする

### 層3: アーキテクチャ標準（本ADR）
- **ルール**: 全markdown出力経路（Obsidian同期、Gist同期、ローカルエクスポート、ダッシュボード表示等）は、
  `sanitizeForObsidian()` または `sanitizeUrlForMarkdownTarget()` を適用してから出力すること
- **例外**: 適用不要なケース
  - `timestamp`, `date`, `time`, `domain` など内部生成された非ユーザー制御データ
  - 既にサニタイズ済みの変数（接頭辞 `sanitized-` または `safe-` を持つ変数）
  - テストファイル（`__tests__/` 配下）

## 使用するサニタイズ関数

| 関数 | 対象 | 使用例 |
|------|------|--------|
| `sanitizeForObsidian(text)` | title, summary, digest, free-text URL | `[title](url)`, 文中のURL, 見出し |
| `sanitizeUrlForMarkdownTarget(url)` | リンクターゲット位置のURL | `[title](url)` の `(url)` 部分 |

## トレードオフ

### メリット
- 新規markdown出力経路作成時のサニタイズ漏れを防止
- 自動検出 + レビュー + 標準の3層でカバレッジを確保
- 既存パターン（`formatMarkdownStep.ts`, `obsidianFormatter.ts`, `dashboard.ts`）との一貫性

### デメリット
- 新規ファイルに import 文と関数呼び出しの追加が必要（軽微なオーバーヘッド）
- 静的解析ではすべてのケースをカバーできない（lint ruleはヒューリスティック）
 - lint rule は `error` レベルであり、CIをブロックする

## 影響を受けるコンポーネント
- 新規/変更される全 `src/**/*.ts` ファイルでmarkdown出力を行うもの
- ESLint設定（`eslint.config.js`）— カスタムルールの継続的メンテナンスが必要

## 将来の改善案
 - ~~将来的に~~ lint rule を `error` レベルに引き上げ、CIをブロックする（2026-07-22 実施済み）
- テンプレートリテラルの代わりに構造化されたmarkdownビルダー関数を導入し、
  サニタイズを義務化するアーキテクチャへの移行

## 関連ADR
- [Response Size Limit Guardrail](2026-07-22-response-size-limit-guardrail.md) — リソース枯渇対策の独立ADR

## 関連 ADR
- [Response Size Limit Guardrail](2026-07-22-response-size-limit-guardrail.md) — リソース枯渇対策の独立したガードレール
