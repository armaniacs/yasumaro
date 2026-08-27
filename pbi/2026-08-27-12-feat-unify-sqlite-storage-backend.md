# PBI: SQLite storage backend の QueryPlanner 統一

## ユーザーストーリー
開発者として、SQLite の query 意味を1つの `QueryPlanner` で生成し、3バックエンドは `exec(plan)` のみに縮退させたい、なぜなら `backendResolver` / `IdbVfsBackend` / `FallbackStorage` / `opfsWorker` の5往復と LIMIT cap (100/1000/100000) の乖離が FTS/LIMIT バグの温床になっているから。

## 優先度
- 順位: 1 / 7
- RICEスコア: 288（Reach=80 / Impact=3 / Confidence=60% / Effort=0.5）— 共有理解で確定: Fallback を含めつつ `QuerySpec` 構造体で統一。`LIMIT` は 2種温存を ADR 化し、`searchHandlers` 先行修正を前提に 5pt で着手。
- 根拠: 全記録が通過する最ホットパス。`QuerySpec` (`where/order/limit/cap/ftsTag`) を 3バックエンド共通で生成すれば重複100行削減、E2E `wasm-boundary` の不安定要因を解消。`grilling` で Fallback 含めることに合意。

## なぜなぜ分析
- なぜ乖離するか: 3バックエンドで `extraWhereSql` 生成と `LIMIT` cap (100/1000/100000) を個別に持ち、FTS 判定 `shouldUseFts5` と `sanitizeTextForFts5` が二重実装
- なぜ気づかないか: 純粋抽出 `buildWhereClause` は単体テスト容易だがバグは `extraWhereSqlFts` 合成漏れと `FallbackStorage` の `qAny['isStarred']` フォールバックに宿る
- 解: `QueryPlanner: buildQuerySpec(query, {caps, fts5Available}) -> QuerySpec` を SSOT とし、Idb/OPFS は `QuerySpec` から `sql` を組み立て、Fallback は同じ `QuerySpec` から `Array.filter` 述語を組み立てる。`LIMIT` は `fts:100000 / plain:1000` の2種を `QuerySpec.cap` として明示し、`shouldUseFts5` の結果で選択。`searchHandlers` の extra filter 欠落は本PBI着手前に先行修正

## BDD受け入れシナリオ
Scenario: ハッピーパス — text検索が 3バックエンドで統一される
  Given `query({text:"hello", limit:10})` を渡す
  When `QueryPlanner.buildQuerySpec(query, {caps, fts5Available})` が `QuerySpec` を生成する
  Then Idb/OPFS は `QuerySpec` から `sql` を、Fallback は同じ `QuerySpec` から `Array.filter` 述語を生成し、3者で同じ `where`/`limit` が使われる

Scenario: エッジケース — alias 乖離が解消される
  Given `is_starred` / `starred` の旧 alias を渡す
  When `QueryPlanner` が正規化する
  Then 3バックエンドで同じ結果を返す。`searchHandlers.ts` の domain/starred 無視バグは本PBI着手前に先行修正済み

## 受け入れ基準
- [ ] `QueryPlanner` が `buildQuerySpec(query, {caps, fts5Available})` の純粋関数として `QuerySpec {where, order, limit, cap, ftsTag}` を1箇所で生成している
- [ ] `IdbVfsBackend` / `OpfsWorker` / `FallbackStorage` の3者が同じ `QuerySpec` からそれぞれ `sql` または `Array.filter` 述語を生成している
- [ ] `LIMIT` 政策 `fts:100000 / plain:1000` が `QuerySpec.cap` として明示され、ADR で確定している
- [ ] `searchHandlers.ts` の `domain`/`starred`/`date` の `extraWhereSql` 欠落バグが本PBI着手前に先行修正されている

## テスト戦略
- 単体: `QueryPlanner` の 3分岐 × 3 backend (Idb/OPFS/Fallback) のテーブル駆動テスト。`caps` と `fts5Available` を注入して純粋性を検証
- 統合: 実 DB での `text/domain/starred` 組み合わせ検索の 3者一致検証
- E2E: `wasm-boundary-comprehensive` で永続化と検索が 3バックエンドで一致することを検証

## 見積もり
5pt（要チームでの見積もり） — 共有理解で確定したスコープ (Fallback 含む QuerySpec + LIMIT 2種温存 + searchHandlers 先行修正) を含む

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
