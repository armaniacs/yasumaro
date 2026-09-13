# PBI 2026-09-12-35 — filter 語彙の 2 モジュール分裂統合（search+ids の nested bind 実バグ解消）

- **種別**: 🔧非功能追加（refactor + fix・SQL search の bind バグ解消を伴う）
- **優先度**: 3 位 / RICE **24.0**（R15 × I2 × C80% / E1.0人日）
- **出典**: round 13 診断 候補 35・サブエージェント探索 + 直接検証

## 背景（なぜ）

round 12 PBI 27 で `buildFilterConditions`（queryPlan.ts:51-67）を新設したが `buildWhereClause`（sqliteQueryBuilder.ts:15-35）が同語彙の別実装として残り、2 モジュール分裂が発生。分裂の直接被害として**実バグ**: `buildFilterConditions` が `ids` 配列を 1 個の bind 値として格納（:63-65）、`buildExtraWhereSql` も flatten しない（:83）ため、**text+ids 同時指定の検索**で `id IN (?,?)` に対しネスト配列 `[3,7]` が 1 値として bind される（FTS :368-369 / LIKE :400-401 の両 search path）。型は `SqliteValue` が `number[]` を含むため通過。plain path（sqliteQueryBuilder:28-31 は spread）は正しい。

## スコープ

- `FilterCondition` を `{ sql; params: SqliteValue[] }`（vector 専用 — bare-or-array union を排除）に変更
- 語彙を 1 module（queryPlan.ts の buildFilterConditions）に実装し、`buildWhereClause` は WHERE-prefix 射影の薄 adapter に（sqliteQueryBuilder から再 export で import 安定）
- `qualifyCondition` の dead no-op 行（queryPlan.ts:72）を削除
- Ssot テストに search params flatten assert + search+ids round-trip を追加

## 受け入れ基準（BDD）

### シナリオ 1: search+ids が flatten 済み params を bind する（ハッピーパス）
```gherkin
Given text + ids:[3,7] の検索
When buildExtraWhereSql を通す
then extraParams は [3, 7] と flatten され、id IN (?,?) の 2 placeholder に対応する
```

### シナリオ 2: 新 filter は 1 行追加（境界）
```gherkin
Given buildFilterConditions に新 filter を 1 行追加
When plain / search の全経路で検証する
then 両経路が同一語彙から生成される（parity テストが pin）
```

## DoD

- [x] vector 化・語彙統合・buildWhereClause adapter 化・dead 行削除
- [x] flatten assert + round-trip テスト新設
- [x] offscreen query 関連テスト green
- [x] type-check / lint green

## 見積もり

🟡中（2pt目安） / 副作用: 🟡軽微（text+ids 検索が正しく ids で絞り込むようになる = バグの解消）

## 実装メモ（2026-09-12）

- `FilterCondition` を `{ sql; params: SqliteValue[] }`（vector 専用）に変更。`buildFilterConditions` が ids を spread して格納
- `buildWhereClause`（sqliteQueryBuilder）を `buildFilterConditions` の WHERE-prefix 射影 adapter に置換 — 語彙の 2 モジュール複製を解消（import 安定のため sqliteQueryBuilder から再 export の形を維持）
- `buildExtraWhereSql` を `flatMap((c) => c.params)` に変更 — text+ids の nested bind 解消
- `qualifyCondition` の dead no-op 行（queryPlan.ts:72）を削除
- 検証: filterConditionSsot テスト更新（flat vector assert + search+ids flatten round-trip）+ offscreen 全 78 ファイル 1085 tests green・type-check green・lint 0 errors
