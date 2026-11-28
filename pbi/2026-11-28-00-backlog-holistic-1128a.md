# 台帳: 2026-11-28 holistic 改善ラウンド holistic-1128a (4件)

## 概要

holistic-code-review (plans/2026-11-28-0145-holistic-review-1128a.md、未レビュー領域
重点: pipeline / content / utils 粒度 / cli Rust / entrypoints 配線) の改善テーマ
TOP 5 から得た 4 候補 (テーマ 5+2 を同一変更セットとして統合) を PBI 化したラウンド。
全 4 件を実装する (ユーザー裁定: 全 5 候補実装)。

- ブランチ: 1128a (main 先端 a45116cf2 から作成)
- 出所: plans/2026-11-28-0145-holistic-review-1128a.md (file:line 実測)
- 過去台帳で閉じたテーマの再指摘なし (差分スコープ規則適用)

## RICE 採点 (降順が実行順)

| PBI | R | I | C | RICE | SP | 逸脱理由 |
|---|---:|---:|---:|---:|---:|---|
| 01 byteStats 型 2 定義統合 | 5 | 1 | 1.0 | 5.0 | 2 | なし (Quick Win、ロードマップ 1 位) |
| 02 contentKernel teardown 対称化 + SpaNavigationMonitor 切り出し (テーマ 5+2 統合) | 4 | 1 | 1.0 | 4.0 | 3 | テーマ 5 と 2 は同一変更セット (contentKernel) で統合したため 1 PBI 化 |
| 03 background/ クラスタ再編 (テーマ 1) | 4 | 0.5 | 1.0 | 2.0 | 5 | SoC 整理のため Impact 0.5 評価。独立 PR 推奨 |
| 04 encryptionSession 3 責務分割 (テーマ 3) | 3 | 1 | 0.8 | 2.4 | 8 | 暗号領域、golden pin 先行。独立バッチ (最後) |

実行順: 01 + 02 (並列バッチ 1、ファイル排他) → 03 (バッチ 2、独立 PR) → 04 (バッチ 3)。

## PBI 一覧

| NN | PBI | 種別 | RICE | SP | 状態 |
|---|---|---|---:|---:|---|
| 01 | [2026-11-28-01-refactor-byte-stats-fields-unification.md](2026-11-28-01-refactor-byte-stats-fields-unification.md) | 🔧非機能追加 | 5.0 | 2 | ⬜ |
| 02 | [2026-11-28-02-refactor-content-kernel-disposers.md](2026-11-28-02-refactor-content-kernel-disposers.md) | 🔧非機能追加 | 4.0 | 3 | ⬜ |
| 03 | [2026-11-28-03-refactor-background-cluster-reorg.md](2026-11-28-03-refactor-background-cluster-reorg.md) | 🔧非機能追加 | 2.0 | 5 | ⬜ |
| 04 | [2026-11-28-04-refactor-encryption-session-split.md](2026-11-28-04-refactor-encryption-session-split.md) | 🔧非機能追加 | 2.4 | 8 | ⬜ |

## 積み残しと判断事項

- テーマ 1 のシム Sunset: SessionAlarmService.ts / sessionAlarmsManager.ts シムと
  rateLimiter.ts シムの移行完了定義が未定義 ― PBI 03 (クラスタ再編) 内で判断
- レビュー報告書 §4 (積み残し) なし: 全テーマが外部挙動を変えないリファクタリング
  に収まった。cleansedReason ユニオン化 (PBI 01) は実行時検証 (validators 層) の
  確認を PBI 内で pin する

## 検証記録 (ラウンド終了後に記載)
