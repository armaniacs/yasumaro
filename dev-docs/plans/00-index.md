# 00-index.md

このファイルは、dev-docs/plans/*.md に書かれたファイルを分類するためのファイルである。

dev-docs/plans/*.md には、今後やりたいこと、今やっていること、完了したことなどが書いてある。

概ね、現在主に作業している内容は、このうちの 1 つのファイルに集約されている。

00-index.md はそれぞれのファイルのステータスを一覧するためのファイルである。

- 更新 2026-07-06（#03・#05・#01実装完了を反映、Phase 1完了、関連設計ドキュメント一覧を拡充）

全ての完了済み計画ファイルは `dev-docs/plans/archive-old/` に移動しました。

## DEV-86 追加機能候補 PBI（実装順提案）

親issue: [DEV-86](https://linear.app/armaniacs/issue/DEV-86)

### 選定基準

1. **Quick Win 優先** — 小工数で早期にユーザー価値を届ける（#07: 5pt, #03: 3pt）
2. **依存解決** — 後続機能の前提を先に整える（#05 → #06/#12, #03 → #01/#02）
3. **★ 分散配置** — 各フェーズに★を1つずつ配置し常に価値を届ける
4. **リスクは基盤後** — #04（誤マージリスク）は品質機構が固まってから着手

### フェーズ構成

| Phase | 内容 | PBI | 累計pt | リリース価値 |
|-------|------|-----|--------|-------------|
| **1** | 基盤整備（Quick Win 3連打） | #07 → #03 → #05 | 13 | 非Obsidian層参入 + タグ品質 + AI安定性 ✅完了 |
| **2** | コア価値（★ + B領域完結） | #01 → ~~#04~~ → #06 | 18 | 週次サマリ + ~~重複統合~~ + 記録漏れ回復 |
| **3** | 信頼性（D領域3つ） | #10 → #11 → #12 | 52 | 暗号化バックアップ + 監査ログ + 完全オフライン |
| **4** | 拡張（残り） | #02 → #08 → #09 | 75 | タグ可視化 + 出力先拡張 + 他ブラウザ対応 |

### 実装順テーブル

| 順位 | # | ファイル | 領域 | 優先 | pt | 選定理由 | 実装状況 |
|------|---|---------|------|------|----|---------|---------|
| **1** | 07 | 2026-07-04-07-feat-local-markdown-export.md | C 連携 | ★ | 5 | 最小コストで非Obsidian層にリーチ。依存ゼロ | ✅ 実装後（v6.5.2で完了。ファイル内「ステータス: 完了」・受け入れ基準全チェック済み・CHANGELOG.md記載あり） |
| **2** | 03 | 2026-07-04-03-feat-tag-auto-clustering-normalization.md | A 知識活用 | ★ | 3 | 全PBI中最短。全タグ機能(#01/#02)の品質基盤 | ✅ 実装後（`97f1b28`で実装済み。正規化辞書・バッジ表示・FTS5サーバーサイドフィルタ） |
| **3** | 05 | 2026-07-04-05-feat-summary-retry-fallback.md | B 記録品質 | ★ | 5 | #06/#12の前提。AI要約安定性が全機能を底上げ | ✅ 実装後（9タスク全て完了。ProviderSlot型・フォールバックロジック・ダッシュボードUI・保存/読込・変更リスナー実装済み） |
| **4** | 01 | 2026-07-04-01-feat-weekly-review-summary.md | A 知識活用 | ★ | 8 | 最大の"見える"価値。#03/#05完了で高品質 | ✅ 実装後（StorageKeys・サマリ生成ロジック・自動アラーム・ダッシュボードUI・テストを追加。URL_RETENTION_DAYSも35日に延長） |
| ~~5~~ | 04 | 2026-07-04-04-feat-duplicate-page-merge.md | B 記録品質 | ★ | 8 | データS/N比を根本改善。基盤整備後に着手 | ❌ 実装しない（2026-07-05決定。同日内の再訪は既存の重複チェックで十分と判断） |
| **6** | 06 | 2026-07-04-06-feat-missed-record-recovery.md | B 記録品質 | 中 | 5 | #05のpending機構を流用。B領域を完結 | ⏳ 実装前 |
| **7** | 10 | 2026-07-04-10-feat-encrypted-backup.md | D 信頼性 | ★ | 8 | データ蓄積後が最適なタイミング。独立した価値 | ⏳ 実装前 |
| **8** | 11 | 2026-07-04-11-feat-audit-log-data-flow.md | D 信頼性 | 中 | 5 | プライバシー透明性。信頼領域を強化 | ⏳ 実装前 |
| **9** | 12 | 2026-07-04-12-feat-strict-offline-mode.md | D 信頼性 | 中 | 5 | #05のfallback設計が前提。保証価値が高い | ⏳ 実装前 |
| 10 | 02 | 2026-07-04-02-feat-related-graph-tag-cluster.md | A 知識活用 | 中 | 5 | #03完了でより綺麗なグラフ。可視化の仕上げ | ⏳ 実装前 |
| 11 | 08 | 2026-07-04-08-feat-sync-target-abstraction.md | C 連携 | 中 | 13 | #07の次。大工数で価格対効果を考慮し後半 | ⏳ 実装前 |
| 12 | 09 | 2026-07-04-09-feat-chromium-browser-support.md | C 連携 | 低 | 5 | 最優先度低。機能安定化後に | ⏳ 実装前 |

#### 関連ファイルの実装状況

| ファイル | 種別 | 実装状況 |
|---------|------|---------|
| dev-docs/plans/2026-07-04-03-feat-tag-auto-clustering-normalization.deep-dig.md | #03の深掘りメモ | ✅ 実装完了（#03の実装に反映済み） |
| docs/superpowers/specs/2026-07-05-weekly-monthly-local-summary-design.md | #01の設計ドキュメント | ✅ 設計完了・ステージング済み（`A `）。#01の実装はこれから |
| dev-docs/plans/2026-07-05-01-feat-provider-priority-fallback-design.md | #05のフォールバック設計（AIプロバイダ優先順位1〜3位） | ✅ 設計承認済み（コミット済み）。実装完了 |
| dev-docs/plans/2026-07-05-02-feat-provider-priority-fallback-impl-plan.md | #05の実装計画（Task分解済み） | ✅ 実装完了（全9タスク完了） |

### 優先度再評価

- **#03** 中 → ★: 全PBI中最短工数(3pt)で他機能の品質基盤となる。Quick Winとして最有力
- **#05** 中 → ★: #06/#12の前提であり、AI要約成功率の向上は全機能の信頼性に直結
- その他は元の優先度を尊重

★=第一弾推奨（6件）。すべて提案ステータス。

## 関連設計ドキュメント

- [2026-07-05-01-feat-provider-priority-fallback-design.md](2026-07-05-01-feat-provider-priority-fallback-design.md) — #05のAIプロバイダ優先順位（1〜3位）設計。ステータス: 設計承認済み、実装計画作成済み
- [2026-07-05-02-feat-provider-priority-fallback-impl-plan.md](2026-07-05-02-feat-provider-priority-fallback-impl-plan.md) — #05の実装計画（9タスク・各Step分解済み）。ステータス: 未着手
- [2026-07-05-02-feat-encrypted-backup-design.md](2026-07-05-02-feat-encrypted-backup-design.md) — #10の暗号化バックアップ設計。ステータス: 設計済み、実装未着手
- [docs/superpowers/specs/2026-07-05-weekly-monthly-local-summary-design.md](../superpowers/specs/2026-07-05-weekly-monthly-local-summary-design.md) — #01の週次/月次サマリ設計。ステータス: 設計済み、実装完了
