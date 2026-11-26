# 台帳: 2026-11-26 holistic 改善ラウンド holistic-1126 (5件)

## 概要

PR #218 (fix/encrypted-backup-large-capacity) の大局的コードレビュー
(plans/2026-11-26-1113-holistic-review-fix-encrypted-backup-large-capacity.md、
holistic-code-review スキル、4 観点: DRY/SoC/拡張性/堅牢性) から得た改善テーマ 5 件を
PBI 化したラウンド。出所は holistic-code-review の報告書 (file:line は実測済み)。

- ブランチ: refactor/holistic-1126 (fix/encrypted-backup-large-capacity の先端から)
- PR: #218 は大容量対応ラウンド分。本ラウンドの実装は別コミット群として本ブランチに積む
- ユーザー裁定 (2 回の確認): 5 候補全実装、ただしテーマ 3/4 は既知 (b) 連動のため
  PBI 14 (単発 restore 7 層削除) を先行させる次ラウンド構成にする

## RICE 採点 (降順が実行順)

| PBI | R | I | C | RICE | SP | 逸脱理由 |
|---|---:|---:|---:|---:|---:|---|
| 09 import 行契約の layer 0 移動 | 6 | 1 | 1.0 | 6.0 | 2 | なし |
| 10 restore staging 分離インターフェース化 | 5 | 1 | 1.0 | 5.0 | 3 | なし (Quick Win) |
| 11 分割形状検証の純粋関数集約 | 3 | 0.5 | 1.0 | 1.5 | 3 | なし |
| 14 単発 restore 7 層削除 (既知 (b)) | 4 | 1 | 1.0 | 4.0 | 5 | テーマ 12/13 の前提として先行 |
| 12 commit swap 手続きの純粋切り出し | 4 | 1 | 1.0 | 4.0 | 2 | PBI 14 の後に着手 (swap が staging 一本になった後が切り出し先最小) |
| 13 maintain ハンドラ table 派生化 | 4 | 1 | 0.8 | 3.2 | 5 | 同上 (runner 表が最小になるタイミング) |

実行順 (実施結果): 09 → 10 → 11 (サブエージェント並列バッチ) → 14 → 12 → 13 (依存順、14 が先行)。ユーザー裁定で 5 件全実装とし、12/13 は 14 完了後に着手した。09/10/11 は並列バッチ、14/12/13 は逐次 (ファイル排他)。

## PBI 一覧

| NN | PBI | 種別 | RICE | SP | 状態 |
|---|---|---|---:|---:|---|
| 09 | [2026-11-26-09-refactor-import-row-contract-layer0.md](2026-11-26-09-refactor-import-row-contract-layer0.md) | 🔧非機能追加 | 6.0 | 2 | ✅ 実装完了 (2026-11-26 アーカイブ済み) |
| 10 | [2026-11-26-10-refactor-restore-staging-transport.md](2026-11-26-10-refactor-restore-staging-transport.md) | 🔧非機能追加 | 5.0 | 3 | ✅ 実装完了 (2026-11-26 アーカイブ済み) |
| 11 | [2026-11-26-11-refactor-split-shape-check.md](2026-11-26-11-refactor-split-shape-check.md) | 🔧非機能追加 | 1.5 | 3 | ✅ 実装完了 (2026-11-26 アーカイブ済み) |
| 14 | [2026-11-26-14-chore-remove-single-shot-restore.md](2026-11-26-14-chore-remove-single-shot-restore.md) | 🔧非機能追加 | 4.0 | 5 | ✅ 実装完了 (2026-11-26 アーカイブ済み、-697 行) |
| 12 | [2026-11-26-12-refactor-restore-swap-extraction.md](2026-11-26-12-refactor-restore-swap-extraction.md) | 🔧非機能追加 | 4.0 | 2 | ✅ 実装完了 (2026-11-26 アーカイブ済み) |
| 13 | [2026-11-26-13-refactor-maintain-handler-table.md](2026-11-26-13-refactor-maintain-handler-table.md) | 🔧非機能追加 | 3.2 | 5 | ✅ 実装完了 (2026-11-26 アーカイブ済み) |

## 検証記録

- PBI 09/10/11: バッチ境界 (type-check / lint / 担当テスト) 緑、json reporter フルスイート failed 0
- PBI 14: 担当 11 ファイル 166 件 + 追加 22 ファイル 379 件緑、type-check 緑、grep 参照ゼロ
- PBI 12: 担当 3 ファイル 28 件緑、type-check 緑
- PBI 13: 指定 8 ファイル 79 件 + 影響 18 ファイル 332 件緑、type-check 緑、wireLambdaFactories の既存落ち (PBI 14 更新漏れ) も修正
- 最終ゲート: `npm run validate` 全緑 (1,377 ファイル / 19,371 件、65s) + `npm run build` 緑
- 補足: 高負荷時 (ロード 8-11) のフルスイートは recordingPipeline-impl.test.ts がタイムアウトしたが、単独実行 (30 件 / 227ms) で緑のため負荷起因の flaky と確定 (コード変更非依存)

## 積み残しと軽微な構造事項 (レビュー報告書 §4)

- restoreSessionHandler の 4-case switch は TableDrivenDescriptor で折りたためるが、
  影響は診断ログの一貫性のみで小さいため、PBI 13 (table 派生化) の副産物として扱う
- レビュー報告書の「主な構造的課題」で評価された強み (wire SSOT、段階的深さ防御、
  上限 SSOT、keyset 自文書化) は本ラウンドの追加対象外 (強みとして維持)

## 積み残しと軽微な構造事項 (レビュー報告書 §4)

- restoreSessionHandler の 4-case switch は TableDrivenDescriptor で折りたためるが、
  影響は診断ログの一貫性のみで小さいため、PBI 13 (table 派生化) の副産物として扱う
- レビュー報告書の「主な構造的課題」で評価された強み (wire SSOT、段階的深さ防御、
  上限 SSOT、keyset 自文書化) は本ラウンドの追加対象外 (強みとして維持)
