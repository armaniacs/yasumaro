# PBI: `clampLimit` の直書き 100 を `DEFAULT_QUERY_LIMIT` に一本化

## ユーザーストーリー
検索基盤の保守担当者として、既定 limit が2箇所で二重管理されていてほしくない。なぜなら片方変更でもう片方が残り、無言で振る舞いがずれるから。

## 優先度
- 順位: 06 / 08
- RICEスコア: 20（Reach=5 / Impact=0.25 / Confidence=1.0 / Effort=0.0625）
- 根拠: 現状値は一致しており実害なしの予防。1行修正＋テスト pin。依存なし（PBI 03 と同領域だがファイルが異なり独立）。

## 背景
adversarial-code-review (2026-10-16) の検証通過指摘 (保守 #14、offscreen 反証で事実確認)。`clampLimit(query.limit, cap, 100)` (`src/offscreen/queryPlan.ts:374`) のフォールバックが直書きで、同ファイル `:28` の `DEFAULT_QUERY_LIMIT` と二重管理になっている。

## BDD受け入れシナリオ
Scenario: 不正 limit は既定に倒れる
  Given 非正・非整数・0以下の limit
  When `buildQuerySpec` で組み立てる
  Then `DEFAULT_QUERY_LIMIT` と等しい値になる

Scenario: 正常系は不変
  Given 既存の paging テスト
  When 実行する
  Then 全緑

## 受け入れ基準
- [x] 直書きが定数参照になり、定数変更が自動反映される（テストで pin）
- [x] `npx vitest run src/offscreen/` の query 系全緑

## テスト戦略
- 単体: 定数との一致 pin（Red: 定数を変えたら落ちる → Green）
- 既存: query 系テストで回帰確認

## 見積もり
0.25 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（不要ならその旨を記録）
