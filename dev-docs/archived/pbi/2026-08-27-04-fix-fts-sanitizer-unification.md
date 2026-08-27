# PBI: FTS5 サニタイザの二重定義統一

## ユーザーストーリー
利用者として、FTS5 検索で `OR/AND/NOT/NEAR` がインジェクションとして悪用されない AND 正常な検索語が誤って除去されない状態にしたい、なぜなら `schema.ts` と `sqliteQueryBuilder.ts` で逆の仕様がロックされており将来的な統一で必ず片方のテストが壊れるから。

## 優先度
- 順位: 4 / 8
- RICEスコア: 320（Reach=40 / Impact=2 / Confidence=80% / Effort=0.2）
- 根拠: 全文検索は主要機能 (Reach=40)。インジェクションはセキュリティ (Impact=2)。2 箇所の重複が drift を生むと確信。統一に設計判断が必要で Effort 0.2。

## なぜなぜ分析
- なぜ二重定義か: `sanitizeFtsTerm` (whitelist) と `buildFtsTagMatchCondition` (operator 除去) が別々に実装された
- なぜ逆の期待になったか: schema 側テストは保持を正、tag 側テストは除去を正としてそれぞれ固定した
- なぜ統一できないか: どちらが SSOT か決めずにテストを書いた
- 解: SSOT を `sanitizeFtsTerm` に集約し operator 除去を含めるか、tag 側に委譲するかを決定し両テストを一致させる

## BDD受け入れシナリオ
Scenario: ハッピーパス — 正常語は保持される
  Given クエリ `hello world 日本語` を渡す
  When `sanitizeFtsTerm` を呼ぶ
  Then 入力と同値が返る

Scenario: セキュリティ — FTS 演算子は無害化される
  Given クエリ `foo OR bar AND baz` を渡す
  When `sanitizeFtsTerm` を呼ぶ
  Then `OR`/`AND` は除去または空白化され `foo bar baz` になる

## 受け入れ基準
- [x] `src/offscreen/schema.ts:415-427` と `src/offscreen/sqliteQueryBuilder.ts:42-49` のどちらが SSOT か ADR またはコメントで明記されている
- [x] `sanitizeFtsTerm` が `OR/AND/NOT/NEAR` を除去する (またはしない) 方針が統一され、両テストの期待値が一致する
- [x] `src/offscreen/__tests__/schema-comprehensive.test.ts:252` と `sqliteQueryBuilder-comprehensive.test.ts:254` が同じ仕様でパスする
- [x] 既存 392+332 ケースがパスする

## テスト戦略
- 単体: `sanitizeFtsTerm` に `OR/AND/NOT/NEAR` の大文字小文字/境界ケースを投入し除去を検証
- 統合: `buildFtsTagMatchCondition` 経由の tag 検索 + `sanitizeFtsTerm` 経由の text 検索の両方で FTS MATCH が期待通り動くことを確認
- E2E: `opfs-fts5-search` 相当の日本語/英語クエリで再現テスト

## 見積もり
2pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ADR またはコメントで SSOT を文書化
