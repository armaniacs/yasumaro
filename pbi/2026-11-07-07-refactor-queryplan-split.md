# PBI 2026-11-07-07: queryPlan 分割 - policy と statement 構築の分離

## Header
- rank: 7/9
- RICE: 0.8 (Reach 4 / Impact 2 / Confidence 0.8 / Effort 8)
- 依存: 2026-11-07-05 (brand-pinning tests green first。05 の gate が green になるまで着手しない)
- テーマ: queryPlan.ts 909 行の責任集中の解消
- 種別: refactor (振る舞い変更なし)

## User Story
- 開発者として、queryPlan の policy 部分と statement 構築部分を分離したい。なぜなら 909 行の単一 module に mode 判定と cap 選択と brand 定義と SQL 組み立てと purge 実行が同居し、変更時の影響範囲が見えないためだ。

## Background
- `src/offscreen/queryPlan.ts` は全 909 行であることを確認済み。先頭 1-80 行は header comment と policy 層 (mode/cap/brand) の定義域である。
- `planQueryMode` は `src/offscreen/queryPlan.ts:43-45` で定義され、`text` の有無で `search` と `listing` を切り替える。
- `selectReadCap` は `src/offscreen/queryPlan.ts:55-57` で定義され、FTS 使用時に `QUERY_CAPS.fts`、それ以外に `QUERY_CAPS.plain` を返す。
- brand 型 `AlreadyCappedQuery` は `src/offscreen/queryPlan.ts:59-64` で定義される。宣言本体は 63-64 行である。
- `ExtraWhere` は `src/offscreen/queryPlan.ts:73-78` で定義され、検索系の追加 WHERE 断片の単一表現である。
- statement 構築は `src/offscreen/sqliteQueryBuilder.ts` (全 185 行) への thin delegation が方針である。`buildWhereClause` と `buildOrderByClause` と `buildFts5OrderClause` と `buildLikeOrderClause` と `buildTagFilterCondition` を `src/offscreen/queryPlan.ts:14-15` で import し、`buildQuerySpec` (`src/offscreen/queryPlan.ts:310-370`) から呼び出す形を保つ。
- `withTransaction` の import は `src/offscreen/queryPlan.ts:18`、`rowMatchesTagLike` の import は `src/offscreen/queryPlan.ts:19` で確認済み。再 export は `src/offscreen/queryPlan.ts:215`、fallback 判定での使用は `src/offscreen/queryPlan.ts:246`、purge 実行での使用は `src/offscreen/queryPlan.ts:810-818` である。
- 実行層の受け皿は存在する。`src/offscreen/recordsRepo.ts:18` で `applyReadPolicy` を import し `src/offscreen/recordsRepo.ts:55` で適用する。`withTransaction` の中立実装は `src/offscreen/sqliteTransaction.ts:23` にあり、worker 向け wrapper は `src/offscreen/opfsWorker/handlers.ts:38-39` である。
- `AlreadyCappedQuery` の brand 生成は `applyReadPolicy` に固定する方針である。実装は `src/offscreen/queryPlanner.ts:51-56` で確認済みで、`planQuery` (`src/offscreen/queryPlanner.ts:63-65`) と `planSearch` (`src/offscreen/queryPlanner.ts:78-82`) はいずれも同関数を経由する。
- 公開 API の形は変更しない。`buildQuerySpec` と `matchesExtraWhere` と `clampLimit` と `clampOffset` と purge 系 builder の signature と import path の互換性を保つ。

## BDD 受け入れシナリオ

```gherkin
Scenario: policy と statement の責任が分離される
  Given queryPlan が mode/cap/brand の policy 定義を持つ
  When statement 組み立てが sqliteQueryBuilder への thin delegation になる
  Then policy file の変更なしに SQL 整形だけを変えられる
  And SQL builder の変更なしに cap policy だけを変えられる
```

```gherkin
Scenario: plan 層は pure のまま残る
  Given 分割後の plan module がある
  When buildQuerySpec と matchesExtraWhere を呼ぶ
  Then DB 接続なしで同じ入力から同じ出力を返す
  And withTransaction と rowMatchesTagLike の import を持たない
```

```gherkin
Scenario: 公開 API と SQL 出力が変わらない
  Given 分割前の SQL 出力を pin した golden test がある
  When 分割後の module で同じ StorageQuery を流す
  Then SQL 文字列と params と limit/offset がすべて一致する
  And 既存 caller の import path の変更なしに型検査が通る
```

## 受け入れ基準
- [ ] policy 部分 (mode/cap/brand/ExtraWhere) と statement 構築部分 (QuerySpec/SQL 組み立て/purge statements) が別 module に分かれ、依存方向が policy <- statement または共有 builder への一方向である。
- [ ] 分割後の plan 層は pure である。`withTransaction` の import と実行を持たず、`rowMatchesTagLike` の再 export を持たず、副作用のある purge 実行 (`runPurgeSequence`) を含まない。
- [ ] 公開 API の形が同一である。既存 caller (`IdbVfsBackend`、`storageFallback`、`opfsWorker/crudHandlers`) の import path と呼び出し signature に破壊的変更がない。やむを得ない移動には再 export の互換 shim を残す。
- [ ] parity/golden tests を TDD の順序で先に固定する。refactor 前に現行 SQL 出力を pin し、refactor 後に差分ゼロであることを示す。
- [ ] `withTransaction` と `rowMatchesTagLike` の参照が実行層 (`recordsRepo`、`opfsWorker/handlers`、`sqliteTransaction`、`utils/tagLike`) に寄り、plan 層から消える。
- [ ] `AlreadyCappedQuery` の brand 生成が `applyReadPolicy` 経由に固定されたままである。PBI 05 の pin test が全て green のままである。

## Test Strategy
- 方針は `dev-docs/TEST_RULE.md` に従う。固定時間待ちは使わない。非同期の完了は Promise の await または条件待ちで確認する。
- 手順は TDD とする。先に現行 SQL 出力を pin する golden test を追加し、refactor 前後で差分ゼロを確認してから分割に入る。
- pin 対象は `buildQuerySpec` の where/order/limit/offset/params/useFts/mode と purge 系 statements の SQL 文字列である。SQL 文字列の比較は完全一致ではなく cap と filter の有無を中心にし、整形差分で壊れない範囲に絞る。
- refactor 後に回す suite は関連 vitest (`queryPlanClamp`、`queryPlanner`、`tagCorpusParity`、query-backends 系) と `npm run type-check` である。
- E2E は追加しない。単体と golden の構成とする。

## Estimate
- 8SP

## Definition of Done
- [ ] 全 BDD シナリオが自動 test として実装され pass する
- [ ] golden test が refactor 前に pin され refactor 後に差分ゼロである
- [ ] plan 層が withTransaction と rowMatchesTagLike を参照しないことが grep で確認できる
- [ ] 公開 API の互換性が型検査で確認できる
- [ ] `npm run type-check` が pass する
- [ ] 関連 vitest suite が pass する
- [ ] 振る舞い変更がないことが diff で確認できる
