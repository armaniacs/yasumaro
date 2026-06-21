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
| 08 (旧) | [store-release](./archive/2026-06-09-08-feat-store-release.md) | Chrome Web Store公開準備 | 5 | ✅ 完了済み（v6.0.0 公開） |
| 09 | [sqlite-retention-settings](./archive/2026-06-18-09-feat-sqlite-retention-settings.md) | SQLite 閲覧履歴の保持ポリシー設定 | 3 | ✅ 完了済み（v6.0.0） |
| 19 | [onboarding-wizard](./archive/2026-06-20-19-feat-onboarding-wizard.md) | 対話型設定ウィザード | 5 | ✅ 完了済み（v6.1.0） |
| 20 | [manual-record-visibility](./archive/2026-06-20-20-feat-manual-record-visibility.md) | 手動実行ボタンの視認性向上 | 3 | ✅ 完了済み（v6.1.0） |
| 21 | [markdown-copy](./archive/2026-06-20-21-feat-markdown-copy.md) | Markdown 1クリックコピー | 3 | ✅ 完了済み（v6.1.0） |
| 22 | [store-landing-refresh](./archive/2026-06-20-22-feat-store-landing-refresh.md) | Chrome Web Store ランディングページ刷新 | 3 | ✅ 完了済み（v6.1.0） |

**合計: 156 SP | 完了済み: 156 SP (100%) | 未着手: 18 SP**（v6.3.x 以降）

### v6.3.x 候補 PBI

| # | ファイル | 概要 | SP | 優先度 | 状態 |
|---|---------|------|-----|--------|------|
| 23 | [2026-06-21-23-fix-privacy-consent-version-migration.md](./2026-06-21-23-fix-privacy-consent-version-migration.md) | プライバシー同意バージョン移行 | 3 | P0 | ✅ コミット済み |
| 24 | [2026-06-21-24-feat-db-export-import.md](./2026-06-21-24-feat-db-export-import.md) | `.db` バイナリエクスポート・インポート | 5 | P0 | ✅ コミット済み |
| 25 | [2026-06-21-25-feat-opfs-recovery-migration.md](./2026-06-21-25-feat-opfs-recovery-migration.md) | OPFS 復旧時の自動マイグレーション | 5 | P1 | ✅ コミット済み |
| 26 | [2026-06-21-26-refactor-sw-modularization-round2.md](./2026-06-21-26-refactor-sw-modularization-round2.md) | Service Worker モジュール分割（第 2 ラウンド） | 3 | P1 | 未着手 |
| 27 | [2026-06-21-27-fix-vitest-config-root-discovery.md](./2026-06-21-27-fix-vitest-config-root-discovery.md) | vitest 設定ファイルの自動発見問題修正 | 2 | P0 | 未着手 |

### Archive (完了済み PBI)

| # | ファイル | 概要 | SP |
|---|---------|------|-----|
| 00 | [archive/2026-06-09-00-feat-rename-to-yasumaro.md](./archive/2026-06-09-00-feat-rename-to-yasumaro.md) | リポジトリ名 yasumaro に統一 | 2 |
| 01-07 | [archive/](./archive/) | Phase 1〜7 | 53 |
| 08 | [archive/2026-06-09-08-feat-store-release.md](./archive/2026-06-09-08-feat-store-release.md) | Chrome Web Store 公開準備 | 5 |
| 09 | [archive/2026-06-18-09-feat-sqlite-retention-settings.md](./archive/2026-06-18-09-feat-sqlite-retention-settings.md) | SQLite 保持ポリシー設定 | 3 |
| 10 | [archive/2026-06-14-10-spike-opfs-vfs-feasibility.md](./archive/2026-06-14-10-spike-opfs-vfs-feasibility.md) | OPFS VFS スパイク | 3 |
| 11 | [archive/2026-06-14-11-fix-legacy-history-conversion.md](./archive/2026-06-14-11-fix-legacy-history-conversion.md) | レガシー記録→SQLite 変換改善 | — |
| 12 | [archive/2026-06-14-12-feat-opfs-vfs-implementation.md](./archive/2026-06-14-12-feat-opfs-vfs-implementation.md) | OPFS VFS 実装 | 5 |
| 13 | [archive/2026-06-14-13-feat-diagnostics-capability-matrix.md](./archive/2026-06-14-13-feat-diagnostics-capability-matrix.md) | 診断パネル | 3 |
| 14 | [archive/2026-06-16-14-feat-ym-token-migration.md](./archive/2026-06-16-14-feat-ym-token-migration.md) | 既存セレクタの `--ym-*` 移行 | 3〜5 |
| 15 | [archive/2026-06-16-15-feat-popup-wamo-theme.md](./archive/2026-06-16-15-feat-popup-wamo-theme.md) | ポップアップ和モダン化 | 3〜4 |
| 16 | [archive/2026-06-17-16-fix-obsidian-independent-usage.md](./archive/2026-06-17-16-fix-obsidian-independent-usage.md) | Obsidian非依存のAIテスト・録画動作 | 5 |
| 17 | [archive/2026-06-17-17-feat-obsidian-enable-checkbox.md](./archive/2026-06-17-17-feat-obsidian-enable-checkbox.md) | ダッシュボード初期設定に Obsidian 利用有無のチェックボックスを追加 | 5 |
| 18 | [archive/2026-06-17-18-feat-selective-obsidian-append.md](./archive/2026-06-17-18-feat-selective-obsidian-append.md) | SQLite History から選択した記事を Obsidian に追記する | 5 |
| 19 | [archive/2026-06-20-19-feat-onboarding-wizard.md](./archive/2026-06-20-19-feat-onboarding-wizard.md) | 対話型設定ウィザード | 5 |
| 20 | [archive/2026-06-20-20-feat-manual-record-visibility.md](./archive/2026-06-20-20-feat-manual-record-visibility.md) | 手動実行ボタンの視認性向上 | 3 |
| 21 | [archive/2026-06-20-21-feat-markdown-copy.md](./archive/2026-06-20-21-feat-markdown-copy.md) | Markdown 1クリックコピー | 3 |
| 22 | [archive/2026-06-20-22-feat-store-landing-refresh.md](./archive/2026-06-20-22-feat-store-landing-refresh.md) | Chrome Web Store ランディングページ刷新 | 3 |
| 23 | [2026-06-21-23-fix-privacy-consent-version-migration.md](./2026-06-21-23-fix-privacy-consent-version-migration.md) | プライバシー同意バージョン移行 | 3 |
| 24 | [2026-06-21-24-feat-db-export-import.md](./2026-06-21-24-feat-db-export-import.md) | `.db` バイナリエクスポート・インポート | 5 |
| 25 | [2026-06-21-25-feat-opfs-recovery-migration.md](./2026-06-21-25-feat-opfs-recovery-migration.md) | OPFS 復旧時の自動マイグレーション | 5 |
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
