# PBI 02: queryNormalize の ids に上限と整数化を追加

## ユーザーストーリー

履歴 API を使う利用者として、改ざんされた ids 配列（数千要素・小数）が巨大な `IN (…)` SQL になることなく、有限整数のみに正規化されてほしい。なぜなら round 5 の正規化は形状（配列化・有限数）のみで、上限と整数化が無いから。

## 優先度

- 順位: 02 / 9
- RICE スコア: 20.0（Reach=2 / Impact=1 / Confidence=100% / Effort=0.05 人週）
- 根拠（round 6 診断 B7）: `queryNormalize.ts:33-37` — `map(Number).filter(isFinite && >= 0)` は要素数無制限・float 通過。wire から `ids: [1e9 × N]` で巨大 `IN (…)` を作れる。

## BDD 受け入れシナリオ

```gherkin
Scenario: ids は MAX_QUERY_IDS 件に丸められる
  Given ids が 5000 要素の配列
  When normalizeStorageQuery が適用される
  Then 先頭 MAX_QUERY_IDS 件のみ残る

Scenario: 小数は落とされる
  Given ids に 2.5 が含まれる
  When normalizeStorageQuery が適用される
  Then 2.5 は除外される
```

## 受け入れ基準

- [x] `MAX_QUERY_IDS`（例: 200）を limits.ts に定義し queryNormalize で適用
- [x] `Number.isInteger` フィルタ追加
- [x] テスト: 長大配列 / float / 正常

## テスト戦略

queryNormalize テスト拡張。

## 見積もり

XS（0.05 人週）。種別: fix（堅牢化）。

## 実装メモ（2026-09-11 round 6）

- `MAX_QUERY_IDS = 200` を limits.ts に追加し、queryNormalize の ids に `.slice(0, MAX_QUERY_IDS)` + `Number.isInteger` フィルタを適用。テスト追加（1000 要素 → 200、float 除外）。
