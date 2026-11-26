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

実行順: 09 → 10 → 11 (本ラウンド実装) → 14 → 12 → 13 (次ラウンド、14 が先行依存)。
09/10/11 は本ラウンドで実装し、12/13/14 は起案のみ (ユーザー裁定)。

## PBI 一覧

| NN | PBI | 種別 | RICE | SP | 状態 |
|---|---|---|---:|---:|---|
| 09 | [2026-11-26-09-refactor-import-row-contract-layer0.md](2026-11-26-09-refactor-import-row-contract-layer0.md) | 🔧非機能追加 | 6.0 | 2 | ⬜ |
| 10 | [2026-11-26-10-refactor-restore-staging-transport.md](2026-11-26-10-refactor-restore-staging-transport.md) | 🔧非機能追加 | 5.0 | 3 | ⬜ |
| 11 | [2026-11-26-11-refactor-split-shape-check.md](2026-11-26-11-refactor-split-shape-check.md) | 🔧非機能追加 | 1.5 | 3 | ⬜ |
| 12 | [2026-11-26-12-refactor-restore-swap-extraction.md](2026-11-26-12-refactor-restore-swap-extraction.md) | 🔧非機能追加 | 4.0 | 2 | ⬜ (PBI 14 の後) |
| 13 | [2026-11-26-13-refactor-maintain-handler-table.md](2026-11-26-13-refactor-maintain-handler-table.md) | 🔧非機能追加 | 3.2 | 5 | ⬜ (PBI 14 の後) |
| 14 | [2026-11-26-14-chore-remove-single-shot-restore.md](2026-11-26-14-chore-remove-single-shot-restore.md) | 🔧非機能追加 | 4.0 | 5 | ⬜ (次ラウンド先行) |

## 積み残しと軽微な構造事項 (レビュー報告書 §4)

- restoreSessionHandler の 4-case switch は TableDrivenDescriptor で折りたためるが、
  影響は診断ログの一貫性のみで小さいため、PBI 13 (table 派生化) の副産物として扱う
- レビュー報告書の「主な構造的課題」で評価された強み (wire SSOT、段階的深さ防御、
  上限 SSOT、keyset 自文書化) は本ラウンドの追加対象外 (強みとして維持)
