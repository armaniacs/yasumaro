# Backlog — Architecture Deepening Round 2026-09-03b

Phase 0 診断（6候補）を RICE 採点した 7 PBI。実行順 = RICE 降順（依存を尊重）。

## RICE スコアリング（降順 = 実行順）

| 順位 | PBI | RICE | 内訳 | 依存 |
|------|-----|------|------|------|
| 1 | [01-refactor-trust-seam-consolidation](2026-09-03-01-refactor-trust-seam-consolidation.md) | 12.0 | R1×I3×C1.0/E0.25 | なし |
| 2 | [02-fix-retry-policy-ai-false-positive](2026-09-03-02-fix-retry-policy-ai-false-positive.md) | 9.6 | R1×I2×C0.8/E0.125 | なし |
| 3 | [03-refactor-pipeline-consolidation](2026-09-03-03-refactor-pipeline-consolidation.md) | 6.0 | R1×I3×C0.5/E1.0 | なし |
| 4 | [04-refactor-staged-context-branding](2026-09-03-04-refactor-staged-context-branding.md) | 4.8 | R1×I2×C0.8/E0.25 | **03 に依存** |
| 5 | [05-refactor-composition-root-typed](2026-09-03-05-refactor-composition-root-typed.md) | 4.0 | R1×I2×C0.8/E0.5 | なし |
| 6 | [06-refactor-provider-catalog-split](2026-09-03-06-refactor-provider-catalog-split.md) | 2.7 | R1×I1.5×C0.6/E0.5 | なし |
| 7 | [07-refactor-sqlite-gateway-single-seam](2026-09-03-07-refactor-sqlite-gateway-single-seam.md) | 2.0 | R1×I1×C0.5/E0.5 | なし |

## 依存グラフ

```
01 ── 独立
02 ── 独立
03 ── 独立
04 ── 03 の完了後（PipelineStep 型を変更するため）
05 ── 独立
06 ── 独立
07 ── 独立
```

## 5 Whys サマリー

| PBI | 原因 → 解 |
|-----|----------|
| 01 | seam split が状態の所在を曖昧にし orphan CRITICAL を2度生成 → 1 deep module + module-scope singleton に再集約 |
| 02 | ADR 列挙に無い 'ai ' 部分一致が静かに混入 → ADR 列挙語のみに限定 |
| 03 | 「13 steps を隠す」目的で3分割したが Kernel が20行 loop に過ぎず interface だけ増加 → sole state owner 化 |
| 04 | branding を「約束」したが seam で通さず dead code 化 → 型を通すか削除 |
| 05 | ADR 2026-08-20 の未解消循環2が global setter として残存 → port injection で完了させる |
| 06 | security policy が data catalog に融合し churn 集中 → seam 分離 |
| 07 | hop 分割が interface を倍増させ behaviour を倍増させず → 1 seam + 2 adapters |
