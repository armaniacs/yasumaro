# yasumaro PBI インデックス

作成日: 2026-06-09 | 目標: 3ヶ月でChrome Web Store公開

## フェーズ依存関係

```
Phase 1 (SQLiteコア) ─→ Phase 2 (データ移行)
                    ─→ Phase 3 (ダッシュボードUI)
                    ─→ Phase 4 (記録トリガー設定)
                    ─→ Phase 5 (エクスポート)
                    ─→ Phase 6 (Obsidian連携)
Phase 7 (プライバシー) ── 独立して並行可
Phase 8 (Store公開) ─── Phase 1〜7 全完了後
Phase 9 (デザインシステム) ── 独立して着手可、Store公開前に完了推奨
```

## PBI一覧

| # | ファイル | 概要 | SP | 状態 |
|---|---------|------|-----|------|
| 01-08 | [archive/](./archive/) | Phase 1〜7 + DEV-78 (完了) | 53 | ✅ 完了済み、archive/ に移動 |
| 100-107 | [archive/](./archive/) | Checking Team Review 2026-06-11 (完了) | 42 | ✅ 完了済み、archive/ に移動 |
| 09 | [design-system](./2026-06-10-09-feat-design-system.md) | 和モダン・精緻デザインシステム確立 | 8 | 🔜 次に着手 |
| 08 (旧) | [store-release](./2026-06-09-08-feat-store-release.md) | Chrome Web Store公開準備 | 5 | ⛔ **明示指示待ち**（v6.0.0 リリース直前のみ着手） |

**合計: 108ストーリーポイント | 完了済み: 137 SP (93%) | 未着手: 8 SP (7%)**

### Archive (完了済み PBI)

| # | ファイル | 概要 | SP |
|---|---------|------|-----|
| 00 | [archive/2026-06-09-00-feat-rename-to-yasumaro.md](./archive/2026-06-09-00-feat-rename-to-yasumaro.md) | リポジトリ名 yasumaro に統一 | 2 |
| 01 | [archive/2026-06-09-01-feat-sqlite-core.md](./archive/2026-06-09-01-feat-sqlite-core.md) | wa-sqlite + OPFS + FTS5基盤 | 8 |
| 02 | [archive/2026-06-09-02-feat-data-migration.md](./archive/2026-06-09-02-feat-data-migration.md) | 既存データ自動マイグレーション | 5 |
| 03 | [archive/2026-06-09-03-feat-dashboard-ui.md](./archive/2026-06-09-03-feat-dashboard-ui.md) | カレンダー+タイムライン+全文検索UI | 13 |
| 04 | [archive/2026-06-09-04-feat-recording-triggers.md](./archive/2026-06-09-04-feat-recording-triggers.md) | 記録トリガー複数選択設定UI | 8 |
| 05 | [archive/2026-06-09-05-feat-export.md](./archive/2026-06-09-05-feat-export.md) | JSON / Markdown / CSVエクスポート | 8 |
| 06 | [archive/2026-06-09-06-feat-obsidian-integration.md](./archive/2026-06-09-06-feat-obsidian-integration.md) | Obsidian連携ハイブリッド動作維持 | 5 |
| 07 | [archive/2026-06-09-07-feat-privacy.md](./archive/2026-06-09-07-feat-privacy.md) | PIIマスキング継続 + consent UI再設計 | 5 |
| 100 | [archive/2026-06-11-100-index-review-fixes.md](./archive/2026-06-11-100-index-review-fixes.md) | Checking Team Review インデックス | 0 |
| 101 | [archive/2026-06-11-101-fix-sqlite-data-integrity.md](./archive/2026-06-11-101-fix-sqlite-data-integrity.md) | SQLite データ整合性強化 | 8 |
| 102 | [archive/2026-06-11-102-fix-gdpr-compliance.md](./archive/2026-06-11-102-fix-gdpr-compliance.md) | GDPR 完全準拠 | 5 |
| 103 | [archive/2026-06-11-103-fix-documentation-i18n.md](./archive/2026-06-11-103-fix-documentation-i18n.md) | ドキュメント刷新 & i18n | 5 |
| 104 | [archive/2026-06-11-104-fix-service-worker-modularization.md](./archive/2026-06-11-104-fix-service-worker-modularization.md) | Service Worker モジュラー化 | 8 |
| 105 | [archive/2026-06-11-105-fix-sqlite-client-dry.md](./archive/2026-06-11-105-fix-sqlite-client-dry.md) | SqliteClient DRY 違反解消 | 3 |
| 106 | [archive/2026-06-11-106-fix-mobile-opfs-fallback.md](./archive/2026-06-11-106-fix-mobile-opfs-fallback.md) | モバイル OPFS フォールバック | 8 |
| 107 | [archive/2026-06-11-107-fix-ai-provider-supply-chain.md](./archive/2026-06-11-107-fix-ai-provider-supply-chain.md) | AI プロバイダー最適化 & サプライチェーン | 5 |
| 108 | [archive/2026-06-11-108-fix-gh-pages-redirect.md](./archive/2026-06-11-108-fix-gh-pages-redirect.md) | DEV-78: 旧GitHub Pagesリダイレクト復旧 | 1 |

## 技術スタック決定事項

| 項目 | 決定 |
|------|------|
| SQLiteライブラリ | wa-sqlite（opfs-sahpoolバックエンド） |
| Wasm実行コンテキスト | Offscreen Document（既存を拡張） |
| ダッシュボード | 全画面新規タブページ |
| アプリ名 | Yasumaro - AI Browsing Logger |
| AIプロバイダー優先度 | Gemini > OpenAI > Groq > Ollama > OpenAI互換 |
| 全文検索 | SQLite FTS5 |
