# PBI 07: dashboard import を insertBatch 経由に統合（N+1 round-trip 解消 + skipped 欠落修正）

## ユーザーストーリー

履歴を CSV/JSON から import する利用者として、import が高速で、重複スキップ数が正しく報告されてほしい。なぜなら現状は行毎に SW→offscreen→backend を往復し（1000 行 = 1000 往復）、重複スキップ数は wire で欠落して dashboard が自前再構築しているから。

## 優先度

- 順位: 07 / 9
- RICE スコア: 10.7（Reach=2 / Impact=2 / Confidence=80% / Effort=0.3 人週）
- 根拠（2026-09-11 診断）:
  - `src/background/handlers/dashboardSqlite/maintenanceBatchHandler.ts:36-73` — 50 行バッチだが `deps.insert` を行毎に呼ぶ（backend の `insertBatch` 未使用）。`lastInsertError` のみ保持し `inserted===0` のときしか表面化しない（99 成功 1 失敗が成功と報告）
  - `src/offscreen/recordsRepo.ts:31-36` — `insertBatch` の戻り `{inserted, skipped}` を `{count: inserted}` に潰す（seam での shape 欠落）
  - `src/dashboard/dashboardSqliteService.ts:452-466` — dashboard は `{inserted, skipped, total}` を期待し、行毎ループの結果から自前 reconstruct

## BDD 受け入れシナリオ

```gherkin
Scenario: 1000 行の import が 1 回の insertBatch で完了する
  Given dashboard から 1000 行の import を要求する
  When  maintenanceBatchHandler が処理する
  Then  deps 経由の往復は行数に比例せず、insertBatch が 1 回呼ばれる

Scenario: 重複行の skipped が正しく報告される
  Given 既存 DB に同一 URL の行が 3 件ある
  When  10 行を import する
  Then  結果は {inserted: 7, skipped: 3, total: 10} を報告する

Scenario: 一部失敗が成功と報告されない
  Given 10 行のうち 1 行が制約違反で失敗する
  When  import を実行する
  Then  結果は失敗行を反映した正確な inserted/skipped を返す（成功 10 と報告しない）
```

## 受け入れ基準

- [x] `maintenanceBatchHandler` の import が `deps` 経由で `insertBatch` を使用する（行毎 insert ループを削除）
- [x] `recordsRepo.insertBatch` が `{inserted, skipped}`（または wire 契約に沿った同値）を返す
- [x] `dashboardSqliteService.importLogs` が backend の報告をそのまま使い、自前 reconstruct を削除
- [x] validator の `MAX_IMPORT_ROWS` 上限チェックは維持（`src/messaging/limits.ts` SSOT 参照のまま）
- [x] import 関連単体/統合テスト green（insertBatch-counting-parametric.test.ts 等の既存実 SQLite テスト含む）

## テスト戦略

- 単体: handler が insertBatch を 1 回呼ぶこと・エラー伝播
- 統合: 実 SQLite（better-sqlite3 parametric）で skipped 集計が正しいこと
- 既存: import 経路テスト全 green

## 見積もり

S-M（0.3 人週）。種別: fix（性能 + 正確性）。

## 実装アプローチ

1. `recordsRepo.insertBatch` の戻り shape を拡張（`skipped` 保持）
2. `maintenanceBatchHandler` を insertBatch 呼び出しに統合
3. `dashboardSqliteService.importLogs` の reconstruct 削除
4. wire 契約（SqliteResult）・テスト更新

## 実装メモ（2026-09-11）

- `recordsRepo.insertBatch` が backend の `{inserted, skipped}` を wire まで保持（旧: `{count}` に潰す）。
- `MaintenanceBatchDeps` に `insertBatch` を追加し、`createSqliteClientDeps` で wire。import handler を 1 往復に統合（旧: 行毎 mutate、MAX_IMPORT_ROWS 往復）。エラーは batch 全体の失敗を返す（旧 lastInsertError のみ保持問題の解消）。
- wire 型: `OffscreenCountResponse` に inserted/skipped（オプショナル）、`SqliteRpcClient.mutate` insertBatch オーバーロードを `{count, skipped}` に。InMemoryTransport も wire shape に対応。
- dashboardSqliteService.importLogs の decode は変えず（{inserted, skipped, total} を handler が組み立てる）。append テストに「1 往復」assertion 追加。
