# 台帳: 2026-11-26 後続候補ラウンド followup-1126 (3件)

## 概要

holistic-1126 ラウンド (PBI 09-14、PR #219 マージ済み) で台帳送りした後続候補
3 件 (既知 a-d のうち着手可能なもの) を PBI 化したラウンド。

- ブランチ: chore/holistic-followup-1126 (main 先端から分岐)
- 出所: pbi/2026-11-26-00-backlog-encrypted-backup-capacity.md と
  pbi/2026-11-26-07-backlog-log-migration-capacity.md の後続候補セクション、
  Supply Chain 指摘 (dependings 日付再スタンプ)

## RICE 採点 (降順が実行順)

| PBI | R | I | C | RICE | SP | 逸脱理由 |
|---|---:|---:|---:|---:|---:|---|
| 16 ローカル Markdown 上限緩和 | 3 | 1 | 1.0 | 3.0 | 3 | なし |
| 17 export/import 計測 bench 追加 | 4 | 1 | 0.8 | 3.2 | 3 | なし |
| 18 dependings 共通化 + 日付制御 | 3 | 0.5 | 0.8 | 1.2 | 3 | なし |

実行順: RICE 降順だが、3 件は相互依存なし (ファイル排他) のため並列バッチ 1 組で実装する。

## PBI 一覧

| NN | PBI | 種別 | RICE | SP | 状態 |
|---|---|---|---:|---:|---|
| 16 | [2026-11-26-16-feat-local-markdown-100k.md](2026-11-26-16-feat-local-markdown-100k.md) | ✨機能追加 | 3.0 | 3 | ⬜ |
| 17 | [2026-11-26-17-test-log-export-bench.md](2026-11-26-17-test-log-export-bench.md) | 🧪テスト | 3.2 | 3 | ⬜ |
| 18 | [2026-11-26-18-refactor-dependings-common.md](2026-11-26-18-refactor-dependings-common.md) | 🔧非機能追加 | 1.2 | 3 | ⬜ |

## 台帳送り (本ラウンドの対象外)

- 既知 (a) staging レジストリ共通化 / (c) stringify 最適化 (PBI 17 の計測結果次第) /
  (d) DEPENDINGS 書式共通化 (PBI 18 が共通化の第一歩を踏む、完全統一は次ラウンド以降)
- 再検討トリガー: (c) は PBI 17 の計測結果が「ゲート規模で peak RSS が閾値超」なら
  次ラウンドで最適化 PBI 起案
