# dev-docs/

開発者内部ドキュメントの格納場所です。GitHub Pages には公開されません。

## 目次

| ディレクトリ/ファイル | 概要 |
|----------------------|------|
| `ADR/` | アーキテクチャ意思決定記録 (Architecture Decision Records) |
| `DESIGN_SPECIFICATIONS.md` | 設計仕様 |
| `ERROR_CODES.md` | エラーコード定義 |
| `CODE_REVIEW_SCORING.md` | Checking Team コードレビュー基準 |
| `TEST_COVERAGE_ANALYSIS.md` | テストカバレッジ分析 |
| `TEST_COVERAGE_IMPROVEMENTS.md` | テストカバレッジ改善レポート |
| `refactor-phase-report.md` | リファクタリングフェーズレポート |
| `LM_STUDIO_TESTING.md` | LM Studio テストガイド |
| `TASK2_PLAN.md` | タスク2実装計画 |
| `CHANGELOG_before_3.md` | v3.0.0 以前の変更履歴 |
| `Makefile` | ビルド補助コマンド（npm scripts のラッパー + 追加ユーティリティ） |
| `typedoc.json` | TypeDoc API ドキュメント生成設定 |
| `plans/` | 開発計画・ロードマップ |
| `manual-tests/` | 手動テスト手順 |
| `testing/` | テスト関連ドキュメント |
| `features/` | 機能ドキュメント |
| `implements/` | 実装ドキュメント |
| `superpowers/` | Superpowers 関連ドキュメント |
| `blog-*/` | ブログ原稿（gitignore済み） |

## Typedoc API リファレンスの生成

`dev-docs/typedoc/` は `typedoc` コマンドで自動生成されます。git にコミットされません。

### ビルド方法

```bash
# API ドキュメントを生成
npm run docs

# 監視モードで生成（ファイル変更時に自動更新）
npm run docs:watch
```

### 設定ファイル

`typedoc.json` で設定を管理しています。

| 項目 | 設定値 | 説明 |
|------|--------|------|
| `entryPoints` | `src/` 配下の主要モジュール | API ドキュメント対象のソースファイル |
| `entryPointStrategy` | `expand` | エントリポイントを展開して処理 |
| `out` | `dev-docs/typedoc` | 出力ディレクトリ |
| `name` | `Yasumaro API` | API ドキュメントのタイトル |
| `excludePrivate` | `false` | プライベートメンバーを含める |
| `excludeProtected` | `false` | プロテクトメンバーを含める |
| `excludeExternals` | `true` | 外部ライブラリを除外 |

### エントリポイント一覧

主な対象モジュール：

- `src/background/aiClient.ts` — AI クライアント
- `src/background/obsidianClient.ts` — Obsidian REST API クライアント
- `src/background/privacyPipeline.ts` — プライバシーパイプライン
- `src/background/pipeline/RecordingPipeline.ts` — 録画パイプライン
- `src/background/recordingLogic.ts` — 録画ロジック
- `src/background/localAiClient.ts` — ローカル AI クライアント
- `src/background/Mutex.ts` — Mutex
- `src/messaging/types.ts` — メッセージング型定義
- `src/utils/storage/types.ts` — ストレージ型定義
- `src/privacy/privacy.ts` — PII サニタイザ

新しいモジュールを追加する場合、`typedoc.json` の `entryPoints` にパスを追加してください。

### GitHub Pages との関係

- `docs/` — GitHub Pages デプロイ対象（公開ドキュメント）
- `dev-docs/` — 開発者内部ドキュメント

**typedoc の公開フロー:**

```
push (main) → GitHub Actions → npm run docs → dev-docs/typedoc/ → docs/typedoc/ にコピー → GitHub Pages デプロイ
```

1. `main` ブランチに push すると `pages.yml` が起動
2. `npm run docs` で `dev-docs/typedoc/` に生成
3. `docs/typedoc/` にコピー
4. `docs/` 全体を GitHub Pages にデプロイ

公開先: `https://armaniacs.github.io/yasumaro/api/`

**トリガー条件:**
- `docs/**` の変更
- `src/**/*.ts` の変更（ソース変更で API ドキュメントが更新されるため）
- `typedoc.json` の変更
- 手動実行（workflow_dispatch）
