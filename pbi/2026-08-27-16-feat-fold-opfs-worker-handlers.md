# PBI: opfsWorker Handler 断片の SqliteWorkerApi 統合

## ユーザーストーリー
開発者として、`opfsWorker` の router + 4 handler + `sqlExec` shim の3ホップを `SqliteWorkerApi` に統合したい、なぜなら `INSERT` 1件で `crudHandlers` → `schema` → `handlers` の3層を往復し、トランザクション境界の `ROLLBACK` 漏れが呼び出し側の `ensureEngine` 忘れと組み合わさって再現困難だから。

## 優先度
- 順位: 5 / 7
- RICEスコア: 160（Reach=40 / Impact=2 / Confidence=40% / Effort=0.30） — 再評価で Confidence 60→40 に下方修正。19 `WorkerMessageType` を5メソッドで覆うと再分岐が必要で `1 call` 縮退の利得が消失。`OpfsWorkerBackend` との重複は同一トランザクションのネストではなく並列実装のコード重複で、Worker境界で統合しても `SQLITE_LOCKED` は解消しない。
- 根拠: 変更頻度中だが、現行 thin router + 機能別 handler 分割は `PBI-07` 抽出の意図通り。`purgeHandlers` の2段階DELETEは 2026-07-20-11で単一トランザクション化済み。`withTransaction` 抽出に縮退するのが適正。

## なぜなぜ分析
- なぜ断片化したか: `PBI-07` で `opfsWorker.ts` から `crudHandlers` を抽出したが、各 handler は `sqlExec` ラッパーと同複雑度。`handlers.ts` は `HandlerContext{engine}` + `sqlExec/sqlQuery` 2関数の委譲shim
- なぜ 5メソッドでは不足か: 19分岐を5メソッドで覆うと `query` に `SEARCH/QUERY/GET_COUNT/STATUS/FTS_INDEX_SIZE/AUDIT_LOG_QUERY` を、`purge` に `PURGE/CONTENT_PURGE/CLEAR_ALL` を無理に束ね再分岐が必要
- 解: 最小是正案: `src/offscreen/opfsWorker/handlers.ts` に `withTransaction(ctx, fn)` を抽出し `crudHandlers.ts:128-146` / `purgeHandlers.ts:22-53` / `IdbVfsBackend.ts:42-55` の3箇所の `BEGIN/COMMIT/ROLLBACK` 重複をヘルパに一本化。Api統合は見送り、PBI-12/14 後に再評価

## BDD受け入れシナリオ
Scenario: ハッピーパス — 重複トランザクションがヘルパに一本化される
  Given `insertBatch` を呼ぶ
  When `withTransaction` ヘルパ経由で実行する
  Then `BEGIN IMMEDIATE` → `INSERT_IGNORE` loop → `COMMIT` がヘルパ内で完結し、3箇所の重複が解消される

Scenario: エッジケース — ROLLBACK が漏れない
  Given `insertBatch` で `INSERT` が失敗する
  When `withTransaction` が `catch` する
  Then `ROLLBACK` が確実に実行され、外側エラーを隠蔽しない

## 受け入れ基準
- [ ] `handlers.ts` に `withTransaction(ctx, fn)` が抽出されている
- [ ] `crudHandlers.ts:128-146` / `purgeHandlers.ts:22-53` / `IdbVfsBackend.ts:42-55` の3箇所の `BEGIN/COMMIT/ROLLBACK` 重複がヘルパに一本化されている
- [ ] `SqliteWorkerApi` への統合は見送り、PBI-12/14 後に再評価する方針が ADR またはコメントで明記されている

## テスト戦略
- 単体: `withTransaction` の `COMMIT`/`ROLLBACK` 境界テスト。`BEGIN` 失敗時の `ROLLBACK` 投げ直しで外側エラーを隠蔽しないことを検証
- 統合: `OpfsWorkerBackend` との重複除去後の `SQLITE_LOCKED` 再現は `requestQueue` の直列化で既に担保されていることを確認
- E2E: 不要

## 見積もり
3pt（ヘルパ抽出, 要チームでの見積もり） — フル `SqliteWorkerApi` 15メソッド統合は 5pt

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
