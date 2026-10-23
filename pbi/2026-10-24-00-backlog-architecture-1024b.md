# 建築改善バックログ第2弾（2026-10-24）

> `improve-codebase-architecture` による診断第2弾（codebase-design 語彙、録画スライス＋popup/サービス群の並列探索、HTMLレポート出力済み）の結果台帳。10 候補のうち Speculative 2 件を除外して 8 PBI にした。コード変更は一切行っていない。レポート: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/architecture-review-20261024b.html`。

## RICE スコア表（全 8 PBI）

RICE = Reach（影響する利用箇所・経路数）× Impact（3=実害解消 / 2=大 / 1=中）× Confidence（1.0=確定 / 0.8=設計判断残り）÷ Effort（人日）

| 順位 | PBI | テーマ | Reach | Impact | Conf | Effort | RICE |
|---|---|---|---|---|---|---|---|
| 01 | [2026-10-24-01](2026-10-24-01-refactor-truncate-single-owner.md) | truncate単一所有 | 4 | 2 | 1.0 | 0.5 | 16 |
| 02 | [2026-10-24-02](2026-10-24-02-refactor-notification-policy-table.md) | 通知方針table | 10 | 1 | 1.0 | 1.0 | 10 |
| 03 | [2026-10-24-03](2026-10-24-03-refactor-recording-pause-module.md) | 一時停止の深いmodule | 7 | 2 | 0.8 | 1.5 | 7.5 |
| 04 | [2026-10-24-04](2026-10-24-04-refactor-recording-gate-table.md) | 判定純粋核一本化 | 6 | 3 | 0.8 | 2.0 | 7.2 |
| 05 | [2026-10-24-05](2026-10-24-05-refactor-recording-flow-seam.md) | 記録フロー単一seam | 6 | 3 | 0.8 | 2.5 | 5.8 |
| 06 | [2026-10-24-06](2026-10-24-06-refactor-tab-lifecycle-module.md) | tab lifecycle 1 module | 5 | 2 | 0.8 | 1.5 | 5.3 |
| 07 | [2026-10-24-07](2026-10-24-07-refactor-extractor-single-seam.md) | extractor単一seam | 4 | 2 | 0.8 | 1.5 | 4.3 |
| 08 | [2026-10-24-08](2026-10-24-08-refactor-popup-tab-query.md) | tab照会1 module | 5 | 1 | 0.8 | 1.0 | 4 |

## 依存グラフと実施順の推奨

- **RICE 順が既定**。同点なし。
- **NN04 → NN05**: 同orchestratorに触れるため判定核を先に。
- **並列可**: NN01 / NN02 / NN06 / NN07 は互いに独立。NN03 / NN04 / NN08 は互いに独立。NN05 は NN04 の後に単独。

## 除外（PBI 化しない）

- クレンジング委譲＋PII契約重複（Speculative）：現状維持し再評価待ち。
- sessionAlarmsManager shim（Speculative）：現状維持し再評価待ち。

## 次のアクションの案内

- 実装するなら autonomous-task-closer（RICE 順・依存順でバッチ並列実装〜検証〜版上げ）。
- 個別に手動実装なら各 PBI ファイルを開く。
