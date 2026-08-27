# PBI: opfsWorker Handler 断片の SqliteWorkerApi 統合

## ユーザーストーリー
開発者として、`opfsWorker` の router + 4 handler + `sqlExec` shim の3ホップを `SqliteWorkerApi` に統合したい、なぜなら `INSERT` 1件で `crudHandlers` → `schema` → `handlers` の3層を往復し、トランザクション境界の `ROLLBACK` 漏れが呼び出し側の `ensureEngine` 忘れと組み合わさって再現困難だから。

## 優先度
- 順位: 5 / 7
- RICEスコア: 240（Reach=40 / Impact=2 / Confidence=60% / Effort=0.25）
- 根拠: 変更頻度中。`OpfsWorkerBackend` との重複トランザクション除去で Worker 境界の `SQLITE_LOCKED` 再現が容易になる。

## なぜなぜ分析
- なぜ断片化したか: `PBI-07` で `opfsWorker.ts` から `crudHandlers` を抽出したが、各 handler は `sqlExec` ラッパーと同複雑度
- なぜ漏洩するか: テスト用 re-export `handleSearchFts` が本番 router に漏洩し API 面を広げている
- 解: `SqliteWorkerApi { insert, batch, query, purge, backup }` がトランザクション境界を内部で完結

## BDD受け入れシナリオ
Scenario: ハッピーパス — router が1コールで完結する
  Given `insert` を呼ぶ
  When `SqliteWorkerApi.insert` を呼ぶ
  Then `BEGIN` → `INSERT` → `COMMIT` が内部で完結する

Scenario: エッジケース — ROLLBACK が漏れない
  Given `insertBatch` で `INSERT` が失敗する
  When `batch` を呼ぶ
  Then `ROLLBACK` が確実に実行される

## 受け入れ基準
- [ ] `SqliteWorkerApi` が `insert/batch/query/purge/backup` の5メソッドで完結する
- [ ] `crudHandlers`/`searchHandlers`/`purgeHandlers` の重複が削除されている
- [ ] `router` が `op -> transaction` の1 call に縮退している

## テスト戦略
- 単体: `SqliteWorkerApi` の `insert`/`batch` のトランザクション境界テスト
- 統合: `OpfsWorkerBackend` との重複除去後の `SQLITE_LOCKED` 再現テスト
- E2E: 不要

## 見積もり
2pt（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
