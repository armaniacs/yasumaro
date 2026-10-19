# Backlog: arch-delivery-loop ラウンド archloop-1015 (2026-10-15)

arch-delivery-loop skill によるコードベース全体 (差分スコープ) のアーキテクチャ診断と閉ループ実行。
診断レポート: `/tmp/architecture-review-20261015-053800.md`。
直近ラウンド (holistic-1014b、10-14 着地) が層跨ぎの手書き並列の主要部を解消済みのため、本ラウンドの新規候補は 1 件のみ。残りは deferred/クリーンの記録。

## RICE 採点表 (降順 = 実行順)

| NN | 候補 | R | I | C | E | RICE | 判定 |
|---|---|---|---|---|---|---|---|
| 01 | uBlock sourceManager の i18n seam 迂回 (fix) | 3 | 1 | 1.0 | 1 | **3.0** | PBI 化・実装 |
| ― | AGENTS.md 未コミット 1 行修正 (docs) | ― | ― | ― | ― | ― | PBI 化せず直接コミット |
| ― | F2 dashboardGateway 寄せ | ― | ― | ― | ― | ― | 発火条件未成立 (retrying op は 2 件のみ) で deferred 維持 |
| ― | F1 KEK 脅威モデル | ― | ― | ― | ― | ― | security ラウンド案件・本ループ対象外 |
| ― | Gated backlog 6 件 (wa-sqlite/TS7/stryker/wasm-watch/archive-split/utils-reorg) | ― | ― | ― | ― | ― | トリガー未発火 |

依存: なし (NN01 と docs 修正はファイル非重複のため同バッチ可)。

## 実行順

W1 (NN01 実装 + AGENTS.md コミット、ファイル非重複) → Phase 3 フルゲート → Phase 4 版上げ。

## 台帳送り消費

- holistic-1014b F3 を NN01 が部分消費 (uBlock import 内部分散のうち user-facing 文言 + console.warn。trancoNotification/tagCooccurrence の console 残は別 F として残置)
