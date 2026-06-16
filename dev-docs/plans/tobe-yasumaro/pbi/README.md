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
| 01-08 | [archive/](./archive/) | Phase 1〜7 + DEV-78 (完了、PBI-04 記録トリガーUIは削除) | 53 | ✅ 完了済み |
| 100-108 | [archive/](./archive/) | Checking Team Review (完了) | 42 | ✅ 完了済み |
| 09-15 | [archive/](./archive/) | デザインシステム + OPFS/診断パネル拡張 (完了) | 24 | ✅ 完了済み |
| 08 (旧) | [store-release](./2026-06-09-08-feat-store-release.md) | Chrome Web Store公開準備（P1〜P4 即時着手可 / P5 は v6.0.0 後） | 5 | 🟡 **P1〜P4 着手可**（2026-06-17 ユーザー明示指示） |

**合計: 124 SP | 完了済み: 119 SP (96%) | 進行中: 5 SP**（PBI-04 記録トリガーUIは削除）

### Archive (完了済み PBI)

| # | ファイル | 概要 | SP |
|---|---------|------|-----|
| 00 | [archive/2026-06-09-00-feat-rename-to-yasumaro.md](./archive/2026-06-09-00-feat-rename-to-yasumaro.md) | リポジトリ名 yasumaro に統一 | 2 |
| 01-07 | [archive/](./archive/) | Phase 1〜7 | 53 |
| 09 | [archive/2026-06-10-09-feat-design-system.md](./archive/2026-06-10-09-feat-design-system.md) | 和モダン・デザインシステム確立 | 8 |
| 10 | [archive/2026-06-14-10-spike-opfs-vfs-feasibility.md](./archive/2026-06-14-10-spike-opfs-vfs-feasibility.md) | OPFS VFS スパイク | 3 |
| 11 | [archive/2026-06-14-11-fix-legacy-history-conversion.md](./archive/2026-06-14-11-fix-legacy-history-conversion.md) | レガシー記録→SQLite 変換改善 | — |
| 12 | [archive/2026-06-14-12-feat-opfs-vfs-implementation.md](./archive/2026-06-14-12-feat-opfs-vfs-implementation.md) | OPFS VFS 実装 | 5 |
| 13 | [archive/2026-06-14-13-feat-diagnostics-capability-matrix.md](./archive/2026-06-14-13-feat-diagnostics-capability-matrix.md) | 診断パネル | 3 |
| 14 | [archive/2026-06-16-14-feat-ym-token-migration.md](./archive/2026-06-16-14-feat-ym-token-migration.md) | 既存セレクタの `--ym-*` 移行 | 3〜5 |
| 15 | [archive/2026-06-16-15-feat-popup-wamo-theme.md](./archive/2026-06-16-15-feat-popup-wamo-theme.md) | ポップアップ和モダン化 | 3〜4 |
| 100-108 | [archive/](./archive/) | Checking Team Review | 42 |
| (plan) | [../archive/2026-06-13-002-review-fixes-design_DONE.md](../archive/2026-06-13-002-review-fixes-design_DONE.md) + [003](../archive/2026-06-13-003-review-fixes-hotfix-plan_DONE.md) + [004](../archive/2026-06-13-004-review-fixes-normal-tracks-plan_DONE.md) | Checking Team レビュー対応（Hotfix 7 + Normal 8 トラック、v5.9.3 で全件完了） | — |

## 技術スタック決定事項

| 項目 | 決定 |
|------|------|
| SQLiteライブラリ | wa-sqlite（opfs-sahpoolバックエンド） |
| Wasm実行コンテキスト | Offscreen Document（既存を拡張） |
| ダッシュボード | 全画面新規タブページ |
| アプリ名 | Yasumaro - AI Browsing Logger |
| AIプロバイダー優先度 | Gemini > OpenAI > Groq > Ollama > OpenAI互換 |
| 全文検索 | SQLite FTS5 |
