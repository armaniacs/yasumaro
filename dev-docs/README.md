# dev-docs/

開発者内部ドキュメントの格納場所です。GitHub Pages には公開されません。

## 目次

| ディレクトリ/ファイル | 概要 |
|----------------------|------|
| `ADR/` | アーキテクチャ意思決定記録 (Architecture Decision Records) |
| `DESIGN_SPECIFICATIONS.md` | 設計仕様 |
| `API_ENDPOINTS.md` | API エンドポイント定義 |
| `DESIGN_TOKENS.md` | デザイントークン定義 |
| `ARCHITECTURE_MAP.md` | コンポーネント構成と機能配置マップ |
| `ERROR_CODES.md` | エラーコード定義 |
| `TESTING_GUIDE.md` | テストガイド（手動テスト・シナリオ・制限） |
| `DEBUGGING_GUIDE.md` | デバッグガイド（問題領域・手順） |
| `SECURITY_REVIEW_GUIDE.md` | セキュリティレビューガイド |
| `DOCUMENTATION_GUIDE.md` | ドキュメント整備ガイド（i18n 形式含む） |
| `NAMING_GUIDELINES.md` | 命名規約 |
| `PERFORMANCE_GUIDE.md` | パフォーマンスガイド |
| `CODE_REVIEW_SCORING.md` | Checking Team コードレビュー基準 |
| `TEST_COVERAGE_ANALYSIS.md` | テストカバレッジ分析 |
| `TEST_COVERAGE_IMPROVEMENTS.md` | テストカバレッジ改善レポート |
| `refactor-phase-report.md` | リファクタリングフェーズレポート |
| `LM_STUDIO_TESTING.md` | LM Studio テストガイド |
| `TASK2_PLAN.md` | タスク2実装計画 |
| `CHANGELOG_before_3.md` | v3.0.0 以前の変更履歴 |
| `Makefile` | ビルド補助コマンド（npm scripts のラッパー + 追加ユーティリティ） |
| `plans/` | 開発計画・ロードマップ |
| `manual-tests/` | 手動テスト手順 |
| `testing/` | テスト関連ドキュメント |
| `features/` | 機能ドキュメント |
| `implements/` | 実装ドキュメント |
| `superpowers/` | Superpowers 関連ドキュメント |
| `blog-*/` | ブログ原稿（gitignore済み） |

## API ドキュメントについて

TypeDoc は TypeScript 7 の peer 非対応（`5.0.x〜6.0.x` で上限、TS7 では実行時にクラッシュ）で、
アプリ本体のツールチェーン更新（TS7 / ネイティブ tsgo）を阻むため撤去した。yasumaro は
Chrome 拡張（アプリ）で外部 API 消費者を持たないため、内部モジュールの自動生成 API リファレンスの
価値は限定的である。人間が管理する `ARCHITECTURE_MAP.md` / `DESIGN_SPECIFICATIONS.md` / `ADR/` と
型付きソースが実質のドキュメントとなる。GitHub Pages の利用者向け Markdown ガイド（`docs/*.md`）の
デプロイは継続し、typedoc には依存しない。
