# 台帳 2026-11-08 arch-delivery-loop archloop-1108 (9件)

診断: `/tmp/architecture-review-20261108.md`。3方向並列 (messaging seam / offscreen query / MV3乖離) + 本体裏取り。
前回 (archloop-1107の5件) は完了済みのため新規ラウンド。NNは本日01起番。

## RICE (降順 = 実行順。依存はスコアより優先し逸脱を記録)

| NN | 候補 | R | I | C | RICE | 依存 |
|---|---|---|---|---:|---|
| 01 | SW module-let state (S1) | 6 | 2 | 1.0 | 12 | なし |
| 02 | shallow micro + dead fts (O1) | 5 | 2 | 1.0 | 10 | なし |
| 03 | messaging alias集約 (M2) | 7 | 1 | 1.0 | 7 | なし |
| 04 | connectionTests innerHTML往復除去 (S2) | 4 | 2 | 0.8 | 6.4 | なし |
| 05 | searchExecution backend parity (O3) | 3 | 2 | 0.8 | 4.8 | なし |
| 06 | queryPlan facade段階削除 (O2) | 5 | 1 | 0.8 | 4.0 | O1の後 (queryPlan.ts競合回避) |
| 07 | report scope twin traversal統合 (M1) | 4 | 1 | 0.8 | 3.2 | なし |
| 08 | message契約loader複製解消 (M3) | 3 | 1 | 0.8 | 2.4 | M2の後 (types.ts競合回避) |
| 09 | E2E waitForTimeout肯定条件化 (S3) | 2 | 1 | 0.8 | 1.6 | なし |

バッチ: B1 = 01/02/03/04 並列 (background/offscreen/messaging/dashboardで排他)。B2 = 05/07/08/09 並列 (06は05とsearchExecution.tsで重なるためB3へ分離)。B3 = 06 単独 (05の後)。
プライバシー: 全件が表示・型・テストのみ。履歴の外部送信なし、鍵復号の移動なし。`check-privacy` 緩和なし。
