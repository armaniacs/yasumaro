# PBI 06: タグ条件を search path へ貫通し fallback の ids を統合（条件セットの 1 本化）

## ユーザーストーリー

タグで絞り込みつつ全文検索する利用者として、text+tag の組み合わせがどのバックエンドでも同じ結果を返すことを知りたい。なぜなら round 4 の tag 移行が plain path しか貫通しておらず、text+tag は OPFS/IDB でタグ無視（fallback は honor）の 2-vs-1 分歧になっているから。

## 優先度

- 順位: 06 / 10
- RICE スコア: 9.6（Reach=3 / Impact=2 / Confidence=80% / Effort=0.5 人週）
- 根拠: `buildFtsSearchStatements` / `buildLikeSearchStatements`（`queryPlan.ts:279-323`）は `ExtraWhere` のみ受ける — `QuerySpec.tagFilter` を消費するのは plain path（:335-351）のみ。`IdbVfsBackend.ts:73-128` と `opfsWorker/searchHandlers.ts:25-89` は tag を thread しない。逆に `storageFallback.ts:198-320` は `ids` を一切フィルタせず、`matchesExtraWhere` を呼ばず手写しフィルタ列（date/starred/domain/gist）を持つ — 「どのフィルタが存在するか」の真実が 2 箇所。

## BDD 受け入れシナリオ

```gherkin
Scenario: text+tag が全 backend で同一条件になる
  Given text "rust" と tag "AI" を指定した検索
  When IDB / OPFS worker / fallback で実行する
  Then 全 backend の WHERE に tag 条件が含まれる（parametric テストで pin）

Scenario: fallback でも ids が honor される
  Given ids [1,2] を指定した query
  When fallback storage で実行する
  Then id 1,2 の行のみ返る
```

## 受け入れ基準

- [x] `buildFtsSearchStatements` / `buildLikeSearchStatements` に `tagFilter`（QuerySpec.tagFilter と同一 shape）を追加し、FTS/LIKE の COUNT/rows に組み込む
- [x] `IdbVfsBackend` search branch と `opfsWorker/searchHandlers` が spec.tagFilter / payload.tag を thread する
- [x] `storageFallback.query` のフィルタ列を `matchesExtraWhere` + `tagMatchesFilter` 委譲に置換し、ids 述語が効く
- [x] parametric テスト: text+tag・ids の backend 間一致を pin（INTENTIONAL divergences リストに tag/ids が入らないことを確認）
- [x] 全 offscreen / dashboard テスト green

## テスト戦略

parametric（idb stub / opfs stub / fallback 実物）で WHERE 条件と params の一致を pin。既存 divergence テストに触れない。

## 見積もり

M（0.5 人週）。種別: fix（silent 誤結果解消）。

## 実装アプローチ

1. builders に tagFilter 引数追加（plain と同一 shape）
2. 3 backend で thread、fallback を matchesExtraWhere 委譲に
3. parametric テスト拡充

## 実装メモ（2026-09-11 round 5）

- `buildFtsSearchStatements` / `buildLikeSearchStatements` に `tagFilter` opts を追加（plain path と同一 shape）。
- `buildTagFilterCondition` に `idColumn`（'id' | 'b.id'）option — FTS search は JOIN context のため `b.id IN (...)`。
- IdbVfsBackend（FTS/LIKE 両 branch）と opfsWorker/searchHandlers（Fts/Like 両 handler）が payload.tag を thread。wrapper `handleSearchFts/handleSearchLike` に payload 引数を追加（テスト用 wrapper の契約拡張）。
- `storageFallback.query` の手書しフィルタ列（domain/starred/gist/date）を `matchesExtraWhere` 委譲に置換し **ids 述語が効く** ように。excludeDeleted と is_starred エイリアスquirk は base-shape として local 保持。
- parametric テスト: text+tag（FTS/LIKE 両方・idb/opfs 同一 params）+ ids の backend 間一致を pin。
