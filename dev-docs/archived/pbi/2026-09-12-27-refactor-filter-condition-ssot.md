# PBI 2026-09-12-27 — Filter condition SSOT（3 スペリング統合・SQL search の excludeDeleted 無視解消）

- **種別**: 🔧非機能追加（refactor + fix・backend 分岐の実バグ解消を伴う）
- **優先度**: 3 位 / RICE **16.0**（R15 × I2 × C80% / E1.5人日）
- **出典**: round 12 診断 候補 27・サブエージェント探索 + 直接検証

## 背景（なぜ）

同一フィルタ集合（dateFrom/dateTo/domain/starred/gistSynced/ids/excludeDeleted/tag）が 3 スペリングで存在:

- `buildWhereClause`（sqliteQueryBuilder.ts:15-35・plain path・7 filters）
- `buildExtraWhereSql`（queryPlan.ts:32-52・search path・6 filters + `b.` 限定子を文字列 replace で生成 — 最も壊れやすい）
- `matchesExtraWhere`（queryPlan.ts:75-89・non-SQL・7 filters + tag）

さらに**実バグ**: SQL search（FTS queryPlan.ts:315,320 / LIKE :340）が `is_deleted = 0` をハードコードし `excludeDeleted` を無視。fallback（storageFallback.ts:189-191）と InMemory（inMemoryTransport.ts:207）は honoring。同一クエリで backend 間に行集合の差。

## スコープ

- `buildWhereClause` を構造化条件（[{sql, param, column}]）の単一 builder に
- `buildExtraWhereSql` はその射影（`b.` 限定子を param 化）に縮約し `excludeDeleted` を search path に貫通
- `matchesExtraWhere` は condition list との parity を pin（生成まではしない — non-SQL 側の型の利点を維持）
- filter matrix（各 filter × plain/FTS/LIKE/fallback）を parametric test に

## 受け入れ基準（BDD）

### シナリオ 1: excludeDeleted が全 backend で honoring される（ハッピーパス）
```gherkin
Given text 付きクエリに excludeDeleted: false
When FTS / LIKE / fallback / InMemory で実行する
then 4 backend とも削除済み行を含む同一行集合を返す
```

### シナリオ 2: 新 filter は 1 行追加（境界）
```gherkin
Given condition builder に新 filter を 1 行追加
When plain / search / non-SQL の全経路で検証する
then parity テストが 3 経路の一致を pin する（手動同期不要）
```

## DoD

- [x] 構造化条件 builder 新設・buildExtraWhereSql 縮約・excludeDeleted 貫通
- [x] filter matrix parametric テスト新設
- [x] offscreen query 関連テスト green
- [x] type-check / lint green

## 実装メモ（2026-09-12）

- `buildFilterConditions(query): FilterCondition[]` 新設（queryPlan.ts）— dateFrom/dateTo/domain/starred/gistSynced/ids/excludeDeleted の単一語彙。`qualifyCondition(c, 'b.')` で FTS JOIN パスの限定子を param 化（旧 regex 文字列書き換えを削除）
- `buildExtraWhereSql` は condition list の射影に縮約。`ExtraWhere.includeDeletedFilter` 追加 — search builders（buildFtsSearchStatements / buildLikeSearchStatements）のハードコード `is_deleted = 0` をこの flag で置換し `excludeDeleted: false` が search path に到達
- IdbVfsBackend.query は 1 個の qualified ExtraWhere を FTS/LIKE 両方に渡す（params は位置同一のため共用）
- `buildWhereClause`（plain path）は既存のまま — parity は buildFilterConditions と同語彙のため pin テストで担保
- 検証: filterConditionSsot 12 tests 新設（condition matrix / qualified projection / FTS・LIKE includeDeletedFilter / plain parity）・offscreen 全 77 ファイル 1067 tests green・type-check green・lint 0 errors

## 見積もり

🟡中（2pt目安） / 副作用: 🟡軽微（excludeDeleted:false の search が backend 間で統一 = 分岐の解消）
