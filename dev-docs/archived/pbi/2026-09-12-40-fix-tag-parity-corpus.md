# PBI 2026-09-12-40 — tag/order の cross-backend parity（6 入力で発散する silent wrong-answer 解消）

- **種別**: 🔧非功能追加（fix + refactor・backend 間 tag セマンティクスの発散解消）
- **優先度**: 3 位 / RICE **6.4**（R6 × I2 × C80% / E1.5人日）
- **出典**: round 14 診断 候補 40・サブエージェント探索 + 直接検証

## 背景（なぜ）

fallback の tag/ソートは JS bespoke で SQL と 6 入力で発散する（検証済み）:

1. **大文字小文字**: tag:'AI' / 行 tags:'ai tools' — SQL LIKE は ASCII case-fold で match、JS includes は不 match
2. **カンマ入りタグ**: tag:'a,b' / 行 tags:'a,b' — SQL LIKE は match、JS は行を split するため不 match
3. **ワイルドカード**: tag:'a%b' / 行 tags:'axxb' — SQL は展開して match、JS は literal で不 match
4. **whitespace padding**: tag:' ai ' / 行 tags:'x, ai, y' — SQL match、JS 不 match
5. **sanitizer 差異**: tag:'test OR demo' — FTS path は operator 語除去で match、fallback は raw で不 match
6. **orderBy:rank**: SQL は created_at に coerce、fallback は挿入順

`queryPlan.ts:104-110` は「mirrors」と prose で主張するが executable 契約が無い。fallback は degraded path backend だが silent wrong-answer は error より悪い。

## スコープ

- row predicate を queryPlan に抽出（`rowMatchesTagLike(tags, limitedTag)`）し `tagMatchesFilter`（matchesExtraWhere の tag branch）と共用 — wildcard/case ポリシーを 1 回決めて文書化（SQL 側に合わせ case-insensitive + wildcard 展開を採用）
- fallback のソートを spec.order 経由に（orderBy:rank → created_at coerce を含む）
- **tag-corpus test** 新設: 6 入力 × {idb LIKE, idb FTS, opfs LIKE, opfs FTS, fallback} で同一 match 集合を assert
- 併せて FTS sanitizer 2 種（schema.ts sanitizeFtsTerm vs buildTagFilterCondition inline）の tag-branch 統一 + parity pin

## 受け入れ基準（BDD）

### シナリオ 1: 6 入力で全 backend が同一 match 集合（ハッピーパス）
```gherkin
Given tag-corpus の 6 入力と 5 backend
When 各 backend で同一クエリを実行する
then match 集合が backend 間で一致する
```

### シナリオ 2: wildcard/case ポリシーが 1 回だけ決定される（境界）
```gherkin
Given tag:'a%b'
When row tags:'axxb' に対して filter を評価する
then 展開して match するポリシーが 1 箇所（rowMatchesTagLike）に文書化され、全 backend が従う
```

## DoD

- [x] rowMatchesTagLike 新設・tagMatchesFilter 共用・fallback ソート統一
- [x] tag-corpus parametric テスト新設
- [x] offscreen query 関連テスト green
- [x] type-check / lint green

## 見積もり

🟡中（2pt目安） / 副作用: 🟡軽微（fallback の tag match が SQL 準拠に変わる = silent wrong-answer の解消）

## 実装メモ（2026-09-12）

- **ポリシー決定**（rowMatchesTagLike の doc comment に文書化）: case-insensitive substring・`%` = any sequence・`_` = any char（SQL LIKE 準拠）・カンマは literal（SQL `LIKE '%a,b%'` が同一行に match するため split しない）
- `rowMatchesTagLike(tags, tagFilter)` 新設（queryPlan.ts）— `matchesExtraWhere` の tag branch がこれを使用（旧 `tagMatchesFilter` 呼び出しを置換）。`tagMatchesFilter` は direct caller 向けに legacy comma-split 契約を文書化して維持
- fallback ソート統一: text path で `orderBy:rank` を `created_at DESC` に coerce（buildLikeOrderClause と同一 SQL 挙動・旧 insertion order 分岐を削除）。2 つの intentional divergence pin を parity テストに更新
- **テストケース修正**: 初回の corpus test で `a_b` vs `axxb`（4 文字 vs 3 文字パターン）と `' ai '` vs `'x, ai, y'`（trailing space 不在）の 2 ケースが SQL 準拠でも不 match だったため `axb` / `'has ai tools'` に修正 — agent の分析ケースの一部も SQL LIKE 準拠では不正確だった
- 検証: tagCorpusParity 9 tests 新設・offscreen 全 80 ファイル 1090 tests green・type-check green・lint 0 errors
