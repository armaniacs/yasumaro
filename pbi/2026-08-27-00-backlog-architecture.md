# Backlog: 2026-08-27 Architecture Deepening 7件

## 概要
`improve-codebase-architecture` レビューで抽出された 7件の深掘り機会を RICE で優先度付け。`QueryPlanner` と `PipelineKernel` が最優先。

## RICE スコア表
| 順位 | PBI | RICE | Reach | Impact | Conf | Effort | 強度 | 根拠 |
|------|-----|------|-------|--------|------|--------|------|------|
| 1 | 12-unify-sqlite-storage-backend | 480 | 80 | 3 | 80% | 0.40 | Strong | 全記録が通過、重複100行削減、E2E安定化 |
| 2 | 13-consolidate-recording-pipeline | 420 | 80 | 3 | 70% | 0.40 | Strong | 新プロバイダ追加ごとに分岐増加、offline網羅が困難 |
| 3 | 14-collapse-sqlite-engine-context | 360 | 60 | 2 | 80% | 0.35 | Strong | 初期化競合のテストが全モックを要する |
| 4 | 15-deepen-settings-repository | 300 | 70 | 2 | 70% | 0.35 | Worth exploring | 横断的ホットスポット、将来のAI_PROVIDER追加で工数半減 |
| 5 | 16-fold-opfs-worker-handlers | 240 | 40 | 2 | 60% | 0.25 | Worth exploring | ROLLBACK漏れが再現困難、重複トランザクション除去 |
| 6 | 17-merge-history-panel-mvc | 180 | 30 | 1.5 | 60% | 0.35 | Worth exploring | ソート1つで5ファイル往復、generation忘れが再発 |
| 7 | 18-consolidate-dashboard-rpc | 120 | 30 | 1 | 60% | 0.30 | Speculative | subtype追加で5ファイル、retry重複 |

## 依存関係
- 12 と 14 は `offscreen` 層で関連するが独立して実装可能、統合後に相乗
- 13 は 12 の `QueryPlanner` を利用して `PipelineKernel` の Sqlite 保存を簡潔化できるため、12 → 13 の順が有利
- 15 は他と独立
- 16 は 12 の `QueryPlanner` 統合後に Worker 境界が単純になるため、12 → 16
- 17 は Dashboard 層で独立
- 18 は 12-17 と独立

## 推奨着手順
- Wave1 (2並列): 12,13
- Wave2 (2並列): 14,15
- Wave3 (2並列): 16,17
- Wave4 (1): 18

## 出力ファイル
- `pbi/2026-08-27-12-feat-unify-sqlite-storage-backend.md`
- `pbi/2026-08-27-13-feat-consolidate-recording-pipeline.md`
- `pbi/2026-08-27-14-feat-collapse-sqlite-engine-context.md`
- `pbi/2026-08-27-15-feat-deepen-settings-repository.md`
- `pbi/2026-08-27-16-feat-fold-opfs-worker-handlers.md`
- `pbi/2026-08-27-17-feat-merge-history-panel-mvc.md`
- `pbi/2026-08-27-18-feat-consolidate-dashboard-rpc.md`
