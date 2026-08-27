# PBI: SQLite storage backend の QueryPlanner 統一

## ユーザーストーリー
開発者として、SQLite の query 意味を1つの `QueryPlanner` で生成し、3バックエンドは `exec(plan)` のみに縮退させたい、なぜなら `backendResolver` / `IdbVfsBackend` / `FallbackStorage` / `opfsWorker` の5往復と LIMIT cap (100/1000/100000) の乖離が FTS/LIMIT バグの温床になっているから。

## 優先度
- 順位: 1 / 7
- RICEスコア: 480（Reach=80 / Impact=3 / Confidence=80% / Effort=0.4）
- 根拠: 全記録が通過する最ホットパス。`where/order/limit` を1箇所に集約すれば重複100行削減、E2E `wasm-boundary` の不安定要因を解消。Strong かつ deletion test で利得が集中。

## なぜなぜ分析
- なぜ乖離するか: 3バックエンドで `extraWhereSql` 生成と `LIMIT` cap を個別に持つ
- なぜ気づかないか: 純粋抽出 `buildWhereClause` は単体テスト容易だがバグは呼び出し側の合成漏れに宿る
- 解: `QueryPlanner { where, order, limit }` を SSOT とし、backend は `exec` のみ

## BDD受け入れシナリオ
Scenario: ハッピーパス — text検索が FTS で統一される
  Given `query({text:"hello", limit:10})` を渡す
  When `QueryPlanner` が plan を生成する
  Then 全バックエンドで同じ `where`/`limit` が使われる

Scenario: エッジケース — alias 乖離が解消される
  Given `is_starred` / `starred` の旧 alias を渡す
  When `QueryPlanner` が正規化する
  Then 3バックエンドで同じ結果を返す

## 受け入れ基準
- [ ] `QueryPlanner` が `where/order/limit/FTS tag` を1箇所で生成する
- [ ] `IdbVfsBackend.query` / `FallbackStorage.query` / `opfsWorker` の重複 100行が削除されている
- [ ] `StorageBackend` が `exec(QueryPlan)` の1 seam に縮退している

## テスト戦略
- 単体: `QueryPlanner` の 3分岐 × 3バックエンドのテーブル駆動テスト
- 統合: 実 DB での `text/domain/starred` 組み合わせ検索の一致検証
- E2E: `wasm-boundary-comprehensive` で永続化と検索が全バックエンドで一致することを検証

## 見積もり
3pt（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
