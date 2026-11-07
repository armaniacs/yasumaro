# PBI 2026-11-08-02: shallow micro modules の fold と dead ftsClauseQuery 削除

## メタ情報

- ラウンド: arch-delivery-loop archloop-1108
- 順位: 2/9
- RICE: 10 (R5 / I2 / C1.0)
- 依存: なし (06は本PBIの後に実施)
- 種別: refactor
- 規模: M
- プライバシー: 接触なし
- 振る舞い変更: なし (削除されるのは未参照コードのみ)

## ユーザーストーリー

保守担当者として、query周りの20-50行 micro module を fold/削除してほしい。なぜなら interface≒implementation の shallow module が3つあり、読解の起点が分散しているから。

## 背景 (Read確認済み)

- `src/offscreen/ftsClauseQuery.ts:5-20`: 製品コードからの参照ゼロ (importは `__tests__/ftsClauseQuery.test.ts:2` のみ)。
- `src/offscreen/queryNormalize.ts:19-54`: 唯一の呼出元は `src/offscreen/queryPlanner.ts:63-65,78-83` (planQuery/planSearch)。
- `src/offscreen/queryParityPredicate.ts:18-32`: `src/offscreen/sqliteQueryBuilder.ts:277` 経由→ `src/offscreen/queryPlan.ts:308-341` の二段 re-export で seam 二重。
- 方針: normalize は planner へ fold して planner を wire→AlreadyCappedQuery の単一 policy module に深める。matchesExtraWhere は builder 直 import に一本化。fts は削除か builder sanitize 系へ fold。

## BDD受け入れシナリオ

```gherkin
Scenario: 未参照のftsClauseQueryが消える
  Given ftsClauseQueryが製品コードから参照されていない
  When PBIが実施される
  Then ftsClauseQuery.tsが削除される
  And 対応テストも削除または移管され validate が緑である
```

```gherkin
Scenario: query読解の起点が2箇所に集約される
  Given normalize が planner へ fold される
  When 保守担当者がクエリ方策を読む
  Then 入口は planner/builder の2箇所で足りる
  And matchesExtraWhere の import 先が builder に一本化される
```

## 受け入れ基準

- [x] `ftsClauseQuery.ts` が削除される (残す場合は builder 配下への fold と理由記録)
- [x] `normalizeStorageQuery` が queryPlanner 内に fold され `queryNormalize.ts` が削除される
- [x] `matchesExtraWhere` の呼出が builder 直 import に一本化され plan 経由の二段 re-export が解消される
- [x] 既存テスト緑。振る舞い pin (planner境界テスト) が通る

## テスト戦略

- 単体: `src/offscreen/__tests__/` の既存 planner/builder テストで pin。fts テストは削除に伴い整理。
- 統合: 既存 sqlite 経路に任せる。E2E追加なし。

## 5 Whys記録先

- `/tmp/whywhy/2026-11-08-02-micro-fold.md`
