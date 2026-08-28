# Backlog: 2026-08-27 Architecture Deepening 7件

## 概要
`improve-codebase-architecture` レビューで抽出された 7件の深掘り機会を RICE で優先度付け。`QueryPlanner` と `PipelineKernel` が最優先。

## RICE スコア表（再評価後）
| 順位 | PBI | RICE | Reach | Impact | Conf | Effort | 強度 | 根拠 |
|------|-----|------|-------|--------|------|--------|------|------|
| 1 | 12-unify-sqlite-storage-backend | 288 | 80 | 3 | 60% | 0.50 | Strong | 5pt に上方修正。SqlQueryPlanner に縮退し Fallback は adapter 留まり。LIMIT 政策を ADR 化してから着手 |
| 2 | 13-consolidate-recording-pipeline | 420→252* | 80 | 3 | 70%→42% | 0.40→0.67 | Strong | 3pt (Phase A) + 5pt (Phase B) に分割。Phase A は `StepExecutor` 統合と `isNetworkError` ガード、Phase B は typed builder。*Phase Aのみで RICE 252 |
| 3 | 15-deepen-settings-repository | 257 | 70 | 2 | 55% | 0.30 | Worth exploring | 2pt → 3pt に上方修正。`re-encrypt` 副作用と `optimisticLock` の chrome 結合が隠れた結合 |
| 4 | 14-collapse-sqlite-engine-context | 210 | 60 | 2 | 80% | 0.60 | Strong | 2pt → 3pt (薄い alias) / 5pt (完全)。3メソッド制約では `OpfsWorkerBackend` 書き換えがスコープ漏れ |
| 5 | 16-fold-opfs-worker-handlers | 160 | 40 | 2 | 40% | 0.30 | Worth exploring | 2pt → 3pt (ヘルパ抽出) / 5pt (フル)。19分岐を5メソッドで覆うと再分岐で利得消失 |
| 6 | 17-merge-history-panel-mvc | 180→154 | 30 | 1.5 | 60%→51% | 0.35→0.42 | Worth exploring | 3pt (縮小案: Controller+State) / 4.5pt (全面)。`Query/View` まで統合すると God Module |
| 7 | 18-consolidate-dashboard-rpc | 120→720* | 30 | 1 | 60% | 0.30→0.05 | Speculative | フル 3pt → 最小 0.5pt (retry 抽出) に縮退。*最小案では RICE 720 で rank1 だが Speculative のため最後 |

*再評価後の Top は **12 → 13(A) → 15**。Phase A のみで `leverage` を確保し、Phase B は `isNetworkError` 分類が固まってから。

## 依存関係（再評価後）
- 12 と 14 は `offscreen` 層で関連するが独立して実装可能、統合後に相乗。**12 を先に確定**させ、14 は薄い alias に留める
- 13 は 12 の `QueryPlanner` を利用して `PipelineKernel` の Sqlite 保存を簡潔化できるため、12 → 13(A) の順が有利。13(B) は `isNetworkError` ガード追加後に着手
- 15 は他と独立だが、`re-encrypt` 副作用を `migrateIfNeeded` に分離してからでないと `StoragePort` 純粋化が破綻
- 16 は 12 の `QueryPlanner` 統合後に Worker 境界が単純になるため、12 → 16。`withTransaction` 抽出に縮退
- 17 は Dashboard 層で独立。`Controller+State` のみに縮小し `Query/View` は現状維持
- 18 は 12-17 と独立。最小案 0.5pt (retry 抽出) に縮退し、`BrowsingLogRepository` の去就決定後に再検討

## 推奨着手順（再評価後）
- **Wave1 (2並列): 12 (5pt), 13A (3pt)** — `LIMIT` 政策 ADR + `isNetworkError` ガードを先に
- **Wave2 (2並列): 15 (3pt), 14 (3pt 薄い alias)** — 12確定後に `Settings` と `Host` を並行
- **Wave3 (2並列): 16 (3pt ヘルパ), 17 (3pt 縮小)** — 12確定後に Worker と History を並行
- **Wave4 (1): 18 (0.5pt 最小)** — `withRetry` 抽出のみ。フル 3pt は `BrowsingLogRepository` 去就決定後に再検討

## 出力ファイル
- `pbi/2026-08-27-12-feat-unify-sqlite-storage-backend.md`
- `pbi/2026-08-27-13-feat-consolidate-recording-pipeline.md`
- `pbi/2026-08-27-14-feat-collapse-sqlite-engine-context.md`
- `pbi/2026-08-27-15-feat-deepen-settings-repository.md`
- `pbi/2026-08-27-16-feat-fold-opfs-worker-handlers.md`
- `pbi/2026-08-27-17-feat-merge-history-panel-mvc.md`
- `pbi/2026-08-27-18-feat-consolidate-dashboard-rpc.md`
