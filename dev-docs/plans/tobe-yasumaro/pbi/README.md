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
| 01-08 | [archive/](./archive/) | Phase 1〜7 + DEV-78 (完了) | 53 | ✅ 完了済み |
| 100-108 | [archive/](./archive/) | Checking Team Review (完了) | 42 | ✅ 完了済み |
| 10-13 | [archive/](./archive/) | OPFS/診断パネル拡張 (完了) | 16 | ✅ 完了済み |
| **09** | [design-system](./2026-06-10-09-feat-design-system.md) | **和モダン・デザインシステム確立** | **8** | **🔜 着手（深掘り済み）** |
| **14** | [ym-token-migration](./2026-06-16-14-feat-ym-token-migration.md) | **既存セレクタの `--ym-*` 移行** | **3〜5** | **🔜 PBI-09 完了後** |
| **15** | [popup-wamo-theme](./2026-06-16-15-feat-popup-wamo-theme.md) | **ポップアップ和モダン化** | **3〜4** | **🔜 PBI-09 完了後** |
| 08 (旧) | [store-release](./2026-06-09-08-feat-store-release.md) | Chrome Web Store公開準備 | 5 | ⛔ **明示指示待ち**（v6.0.0 リリース直前のみ） |

**合計: 132〜137 SP | 完了済み: 111 SP (81〜84%) | 未着手: 14〜17 SP | 指示待ち: 5 SP**

### 実行順序

```
PBI-09 (トークン定義) → PBI-14 (dash 移行) → PBI-15 (popup) → PBI-08 (Store)
```

### Archive (完了済み PBI)

| # | ファイル | 概要 | SP |
|---|---------|------|-----|
| 00 | [archive/2026-06-09-00-feat-rename-to-yasumaro.md](./archive/2026-06-09-00-feat-rename-to-yasumaro.md) | リポジトリ名 yasumaro に統一 | 2 |
| 01-07 | [archive/](./archive/) | Phase 1〜7 | 53 |
| 10 | [archive/2026-06-14-10-spike-opfs-vfs-feasibility.md](./archive/2026-06-14-10-spike-opfs-vfs-feasibility.md) | OPFS VFS スパイク | 3 |
| 11 | *(未アーカイブ)* | レガシー変換改善 | — |
| 12 | [archive/2026-06-14-12-feat-opfs-vfs-implementation.md](./archive/2026-06-14-12-feat-opfs-vfs-implementation.md) | OPFS VFS 実装 | 5 |
| 13 | [archive/2026-06-14-13-feat-diagnostics-capability-matrix.md](./archive/2026-06-14-13-feat-diagnostics-capability-matrix.md) | 診断パネル | 3 |
| 100-108 | [archive/](./archive/) | Checking Team Review | 42 |

## 技術スタック決定事項

| 項目 | 決定 |
|------|------|
| SQLiteライブラリ | wa-sqlite（opfs-sahpoolバックエンド） |
| Wasm実行コンテキスト | Offscreen Document（既存を拡張） |
| ダッシュボード | 全画面新規タブページ |
| アプリ名 | Yasumaro - AI Browsing Logger |
| AIプロバイダー優先度 | Gemini > OpenAI > Groq > Ollama > OpenAI互換 |
| 全文検索 | SQLite FTS5 |
