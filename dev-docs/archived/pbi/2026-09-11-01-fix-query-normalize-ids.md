# PBI 01: queryNormalize の ids を wire 信頼境界で検証する

## ユーザーストーリー

履歴パネルを使う利用者として、改ざんされた query ペイロードが届いても SQL 組立がクラスタせず、不正な ids は単に「条件なし」として扱われることを知りたい。なぜなら現状は `payload.ids as number[]` の未検証キャストで、文字列 ids が SQL 側の `.map` で TypeError を起こすから。

## 優先度

- 順位: 01 / 10
- RICE スコア: 40.0（Reach=2 / Impact=1 / Confidence=100% / Effort=0.05 人週）
- 根拠: `src/offscreen/queryNormalize.ts:29` の `ids: payload?.ids != null ? (payload.ids as number[]) : undefined` — limit/offset は Number 正規化済みだが ids だけ無検証。SQL 側 `queryPlan.ts:36-40` が `.map` → 型外れ値でクラスタ。wire（chrome.runtime.sendMessage）から到達可能。

## BDD 受け入れシナリオ

```gherkin
Scenario: 文字列 ids は条件なしに正規化される
  Given ids が文字列 "1,2,3" の query ペイロードが届く
  When normalizeStorageQuery が適用される
  Then ids は undefined になり、SQL 組立は TypeError を起こさない

Scenario: 数値配列 ids は有限数のみ残す
  Given ids が [1, "2", NaN, 3] を含む配列である
  When normalizeStorageQuery が適用される
  Then ids は [1, 2] になる
```

## 受け入れ基準

- [x] `ids` は Array.isArray ガード + 要素の Number 変換 + isFinite フィルタを通る
- [x] 非配列・全要素不正の場合は undefined（フィルタ適用なし・fail-open ではなく fail-neutral）
- [x] 正規化テスト新設（文字列 / 非配列 / 混在配列 / 正常配列）

## テスト戦略

単体: queryNormalize の各入力形状。既存 normalize 系テスト green。

## 見積もり

XS（0.05 人週）。種別: fix（セキュリティ堅牢化）。

## 実装アプローチ

1. `queryNormalize.ts` の ids 行を配列ガード + 正規化に置換
2. テスト追加

## 実装メモ（2026-09-11 round 5）

- `queryNormalize.ts` の ids を `Array.isArray` + `Number` + `isFinite && >= 0` フィルタに正規化。非配列・全要素不正は undefined（フィルタ適用なし）。
- normalize テストに文字列/非配列/混在配列/全不正の 4 形状を追加。
