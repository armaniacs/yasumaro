# PBI: queryPlan のタグ付加と param 組立をヘルパーに畳む

## ユーザーストーリー

オフスクリーン検索の保守担当者として、タグ条件の付加を 1 箇所にしたい。FTS 文と LIKE 文の `tagSql/tagParams` と `countParams/rowsParams` の末尾付加順が手書きで同期されており、param 順誤り（かつての `ids` ネスト配列事故と同型）を再発しやすいから。

## 優先度

- 順位: 4/23
- RICE: 4.27（R4 / I2 / C0.8 / E1.5）
- 根拠: param 順事故の再発防止。SQL 文字列・param 順は現行どおり
- 依存: なし

## 背景（file:line 現状）

- `src/offscreen/queryPlan.ts:476-477` と `:515-516`（`tagSql/tagParams` 同一形）
- `:494-495` と `:526-528`（`countParams/rowsParams` 組立）
- `:547-550`（plain 側の同型付加）
- コメント `:465-466`（text+tag 両適用の負荷点）
- 呼び出し側 `src/offscreen/searchExecution.ts:94-110`（`:85-119` の skeleton 統一済みと境界が接する）

## BDD受け入れシナリオ

```gherkin
Scenario: タグ付加がヘルパー経由になる
  Given FTS / LIKE / plain の 3 builder
  When tag 条件付きで組み立てる
  Then appendTag / withTagParams の 2 ヘルパーを経由し、SQL 文字列・param 順が現行と同一である

Scenario: 既存の回帰テストが green のまま
  Given queryPlan・searchExecution の既存テスト
  When 実行する
  Then 全件 green である
```

## 受け入れ基準

- [x] `appendTag(baseSql, tagFilter)` と `withTagParams(baseParams, tagFilter)` の 2 ヘルパーに畳まれている
- [x] 3 builder から呼ばれ、SQL 文字列・param 順は現行どおり
- [x] `searchExecution.ts:94-110` の呼び出し側は不変
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 既存の queryPlan / searchExecution テストが green。param 順の pin があれば維持
- 実時間待ちは使わない

## 見積もり

1.5 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/offscreen/queryPlan.ts` のみ
- ゲート: 対象 8 ファイル 70 tests green / type-check PASS / lint 0 errors
