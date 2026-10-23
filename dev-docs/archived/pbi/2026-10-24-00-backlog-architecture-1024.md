# 建築改善バックログ（2026-10-24）

> `improve-codebase-architecture` による診断（codebase-design 語彙、2領域の並列探索、HTMLレポート出力済み）の結果台帳。10 候補のうち Speculative 1 件を除外し、重複テーマ 1 組を統合して 8 PBI にした。コード変更は一切行っていない。レポート: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/architecture-review-20261024.html`。

## RICE スコア表（全 8 PBI）

RICE = Reach（影響する利用箇所・経路数）× Impact（3=実害解消 / 2=大 / 1=中）× Confidence（1.0=確定 / 0.8=設計判断残り）÷ Effort（人日）

| 順位 | PBI | テーマ | Reach | Impact | Conf | Effort | RICE |
|---|---|---|---|---|---|---|---|
| 01 | [2026-10-24-01](2026-10-24-01-refactor-pending-gateway-normalize.md) | pending normalize共有化 | 3 | 2 | 1.0 | 0.5 | 12 |
| 02 | [2026-10-24-02](2026-10-24-02-refactor-response-canonical-module.md) | 応答形状の正本化 | 6 | 3 | 0.8 | 2.0 | 7.2 |
| 03 | [2026-10-24-03](2026-10-24-03-refactor-regenerate-error-conversion.md) | エラー変換の集約 | 3 | 2 | 1.0 | 1.0 | 6 |
| 04 | [2026-10-24-04](2026-10-24-04-refactor-ask-evidence-module.md) | 証拠pure群の独立化 | 4 | 2 | 0.8 | 1.5 | 4.3 |
| 05 | [2026-10-24-05](2026-10-24-05-refactor-history-panel-wiring-split.md) | panel配線集中の緩和 | 5 | 3 | 0.8 | 3.0 | 4 |
| 06 | [2026-10-24-06](2026-10-24-06-refactor-send-seam-unification.md) | 送信seam一本化 | 5 | 2 | 0.8 | 2.0 | 4 |
| 07 | [2026-10-24-07](2026-10-24-07-refactor-history-ids-ownership.md) | id所有の是正 | 4 | 1 | 1.0 | 1.0 | 4 |
| 08 | [2026-10-24-08](2026-10-24-08-refactor-proposal-row-selectors.md) | selectors畳み込み | 3 | 1 | 0.8 | 1.0 | 2.4 |

## 依存グラフと実施順の推奨

- **RICE 順が既定**。同点（05/06/07 = 4）は依存とリスク軽減で 05 → 06 → 07 に置く。
- **NN02 → NN03・NN04**: 正本の上で組立てるため。
- **NN07 → NN05**: 同 view 群に触れるため id 移動を先に。
- **NN02 → NN05**: panel 再編は正本の上で行うことが望ましい（同 panel に触れるため安全側）。
- **並列可**: NN01 / NN06 / NN07 / NN08 は互いに独立（触れるファイルが重ならない）。NN02 は NN07 と重ならないが NN05・NN03・NN04 の前提になるため単独バッチに置く。

## 除外（PBI 化しない）

- 貯蔵Pick型のseam化見送り（Speculative）：第二adapter不在の仮説seam。現状維持し、切替先出現時に再評価する。

## 次のアクションの案内

- 実装するなら autonomous-task-closer（RICE 順・依存順でバッチ並列実装〜検証〜版上げ）。
- 個別に手動実装なら各 PBI ファイルを開く。
