# バックログ: 履歴パネルの独立化（2026-11-01）

設計書（`docs/superpowers/specs/2026-11-01-history-panels-independence-design.md`）のA案（リージョン移植）をRICE採点してPBI化した。

## 順位表

| 順位 | 候補 | RICE | 内訳 | 根拠・依存関係 |
|---|---|---|---|---|
| 1 | [2026-11-01-01-feat-saved-collections-panel.md](../dev-docs/archived/pbi/2026-11-01-01-feat-saved-collections-panel.md) | 0.64 | Reach=0.4 / Impact=2 / Confidence=80% / Effort=1.0人週 | 分離全体の基盤。02・03 が参照する置き場所を先に確定 |
| 2 | [2026-11-01-02-feat-ask-history-panel.md](../dev-docs/archived/pbi/2026-11-01-02-feat-ask-history-panel.md) | 0.64 | Reach=0.3 / Impact=2 / Confidence=80% / Effort=0.75人週 | 01 と同点のため基盤側先行のタイブレーク。履歴に依存しない |
| 3 | [2026-11-01-03-feat-research-report-panel.md](../dev-docs/archived/pbi/2026-11-01-03-feat-research-report-panel.md) | 0.42 | Reach=0.3 / Impact=1.5 / Confidence=70% / Effort=0.75人週 | 対象解決の新規性が高く確信度を下げた。履歴に依存しない |
| 4 | [2026-11-01-04-fix-history-panel-slimming.md](../dev-docs/archived/pbi/2026-11-01-04-fix-history-panel-slimming.md) | 0.72 | Reach=0.4 / Impact=1 / Confidence=90% / Effort=0.5人週 | スコア最上位だが 01〜03 への依存により最後に実施 |
| 5 | [2026-11-01-05-feat-saved-collections-first-condition.md](2026-11-01-05-feat-saved-collections-first-condition.md) | 0.56 | Reach=0.2 / Impact=2 / Confidence=70% / Effort=0.5人週 | 全体レビューの指摘1件目。初期利用者の初回作成導線。01 の後に実施 |
| 6 | [2026-11-01-06-fix-recall-history-handoff.md](../dev-docs/archived/pbi/2026-11-01-06-fix-recall-history-handoff.md) | 0.28 | Reach=0.2 / Impact=1 / Confidence=70% / Effort=0.5人週 | 全体レビューの指摘2件目。`model.applyCollection` の配線か整理。05 の後に実施 |

## 依存関係

- 04 は 01・02・03 に依存する（新パネルが受け皿として動いてから履歴側を削る）。
- 01・02・03 の間に実装順の依存はない（触る catalog 行とシェルが別で、履歴への依存を持たない）。
- 05 は 01 に依存する（新パネルの空状態と呼び出し契約が確定してから初回作成導線を足す）。
- 06 は 05 に依存する（初回作成導線の確定後に引き継ぎ方式を決める）。

## 実装順

01 → 02 → 03 → 04 → 05 → 06
