# PBI: readOnlyHandler の list params デフォルト所有を planner seam に集約する

- 種別: refactor
- RICE: 4.0（R4 × I1 × C1.0 / E1.0）
- 依存: なし
- バッチ: W2

## ユーザーストーリー

保守担当者として、dashboard SQLite read のデフォルト値（orderBy / orderDir / offset）の所有が planner seam に 1 箇所あってほしい。なぜなら list 経路だけ背景側で bake され、search 経路は planner に委譲という所有分割は、デフォルト変更時に 2 箇所編集を要求するから。

## 背景（現状）

- `src/background/handlers/dashboardSqlite/readOnlyHandler.ts:26-56` — `buildListParams` は `orderBy: payload.orderBy || 'created_at'`、`orderDir: payload.orderDir || 'DESC'`、`offset: payload.offset ?? 0` を bake。兄弟 `buildSearchParams` は `pickDefined` で undefined を透過し planner に委譲
- ヘッダーコメント（:20-25）は「limits pass through raw (undefined included) and the offscreen planner seam owns them」と主張 — limit についてのみ真、orderBy/orderDir は反例（stale doc claim）
- offscreen `src/offscreen/sqliteQueryBuilder.ts:82` — `buildOrderByClause` が同一デフォルト（`q.orderBy || 'created_at'`、orderDir は `|| 'DESC'`）を適用済み → 背景側の bake を外しても wire 結果は不変

同一概念（read-param デフォルト）の所有が op によって違う split seam。

## BDD 受け入れシナリオ

```gherkin
Scenario: orderBy 未指定の list クエリの wire 結果は不変
  Given buildListParams が orderBy を透過する
  When orderBy 未指定の query サブタイプを処理する
  Then offscreen planner が同一デフォルト（created_at / DESC）を適用し、結果は変更前と同一

Scenario: 不正な orderDir の拒否は planner 側で不変
  Given orderDir が 'ASC' / 'DESC' 以外の list クエリ
  When query サブタイプを処理する
  Then planner の許容方向検査が同一の error を返す（背景側の bake で判定しない）
```

## 受け入れ基準

- [x] `buildListParams` から `orderBy` / `orderDir` の `||` デフォルトを外し、`pickDefined` で透過する
- [x] `offset ?? 0` は現状維持（planner 側の所有確認の上、同一なら透過に統一）
- [x] ヘッダーコメントの「planner seam owns them」が全パラメータについて真になる
- [x] 既存 dashboard SQLite list テストが green（wire 結果不変）
- [x] search 経路は変更しない（既に委譲済み）

## テスト戦略

- unit: `src/background/handlers/dashboardSqlite/__tests__/` の readOnlyHandler テストが green
- integration: offscreen planner の既存 orderby テストで担保（wire 結果不変の pin）
- 挿入 fixture: orderBy 未指定の入力で背景側 wire payload に `created_at` が混入しないこと（透過）を pin

## 見積もり

1.0 SP

## 技術的考慮事項

- wire 結果不変を planner のデフォルト適用（:82、:86）で裏取り済み
- プライバシー保証: 変更なし

## 実装者向け注記

### 実装手順

1. `buildListParams` の orderBy/orderDir を `pickDefined` に統一
2. planner 側のデフォルト適用を確認（sqliteQueryBuilder.ts:82）→ wire 不変
3. `npx vitest run src/background/handlers/dashboardSqlite src/offscreen` で検証

### 落とし穴

- `buildLikeOrderClause` は `orderBy !== 'created_at'` を `created_at DESC` に落とす語義を持つ（G17 台帳送りで文書化）— 本 PBI では変更しない
- offset の扱いは planner 側の実装確認後に決める（`?? 0` の bake が残るならコメントに例外を明記）

## Definition of Done

- [x] list params のデフォルト所有が planner seam に集約
- [x] wire 結果不変（既存テスト green）
- [x] stale doc claim 解消
- [x] ロールバック不要（挙動不変の集約）
