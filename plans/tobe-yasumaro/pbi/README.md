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
```

## PBI一覧

| # | ファイル | 概要 | SP | 依存 | 状態 | 備考 |
|---|---------|------|-----|------|------|------|
| 01 | [sqlite-core](./2026-06-09-01-feat-sqlite-core.md) | wa-sqlite + OPFS + FTS5基盤 | 8 | なし | ✅ 完了 | 31 tests, レビュー済み |
| 02 | [data-migration](./2026-06-09-02-feat-data-migration.md) | 既存データ自動マイグレーション | 5 | #01 | ✅ 完了 | 6 tests |
| 03 | [dashboard-ui](./2026-06-09-03-feat-dashboard-ui.md) | カレンダー+タイムライン+全文検索UI | 13 | #01 | ✅ 完了 | FTS5検索・スター/削除対応 |
| 04 | [recording-triggers](./2026-06-09-04-feat-recording-triggers.md) | 記録トリガー複数選択設定UI | 8 | #01 | ✅ 完了 | chrome.alarms 定期スナップショット |
| 05 | [export](./2026-06-09-05-feat-export.md) | JSON / Markdown / CSVエクスポート | 8 | #01 | ✅ 完了 | .db実バイナリは代替中 |
| 06 | [obsidian-integration](./2026-06-09-06-feat-obsidian-integration.md) | Obsidian連携ハイブリッド動作維持 | 5 | #01 | ✅ 完了 | obsidian_synced カラム追加 |
| 07 | [privacy](./2026-06-09-07-feat-privacy.md) | PIIマスキング継続 + consent UI再設計 | 5 | なし | ✅ 完了 | ブランド名更新・同意撤回UI |
| 08 | [store-release](./2026-06-09-08-feat-store-release.md) | Chrome Web Store公開準備 | 5 | #01〜07 | ⬜ 未着手 | `_locales/` i18n 未作成 |

**合計: 57ストーリーポイント | 完了済み: 52 SP (91%) | 未着手: 5 SP (9%)**

## 技術スタック決定事項

| 項目 | 決定 |
|------|------|
| SQLiteライブラリ | wa-sqlite（opfs-sahpoolバックエンド） |
| Wasm実行コンテキスト | Offscreen Document（既存を拡張） |
| ダッシュボード | 全画面新規タブページ |
| アプリ名 | Yasumaro - AI Browsing Logger |
| AIプロバイダー優先度 | Gemini > OpenAI > Groq > Ollama > OpenAI互換 |
| 全文検索 | SQLite FTS5 |
