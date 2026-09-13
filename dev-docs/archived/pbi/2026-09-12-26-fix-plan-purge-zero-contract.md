# PBI 2026-09-12-26 — planPurge の 0-vs-absent 契約確定（2 つの破壊的操作が逆動作する実バグ解消）

- **種別**: 🔧非機能追加（fix + hardening）
- **優先度**: 2 位 / RICE **19.2**（R6 × I2 × C80% / E0.5人日）
- **出典**: round 12 診断 候補 26・サブエージェント探索 + 直接検証

## 背景（なぜ）

`planPurge(0, 0)` は `ok:true` を返すが、`purgeContent(0, 0)` は 3 backend すべてで `>0` ガード（IdbVfsBackend.ts:249,257 / purgeHandlers.ts:66,72 / storageFallback.ts:397,407）により**何もしない**。一方 `purgeOldRecords(0, 0)` は `purgeCutoffMs(0)=now` で未スター全件削除 + maxRecords 退避（IdbVfsBackend.ts:216-242）。同じ planner 出力が 2 つの破壊的操作で正反対の意味。

## スコープ

- planPurge で `0` を「次元スキップ（= 指定なし）」に正規化（`0 → undefined` 相当）し、backend は `!= null` 分岐に統一
- 代替案（0 を拒否）ではなく現行ユーザー契約（UI は 0 を送らない・デフォルトのみが実入力）を維持する最小修正
- parametric テーブル（0 / undefined / 1 / NaN / -1）で purgeOldRecords × purgeContent × 3 backend の挙動一致を pin

## 受け入れ基準（BDD）

### シナリオ 1: 0 は「スキップ」に統一される（ハッピーパス）
```gherkin
Given planPurge(0, 0) の出力
When purgeOldRecords / purgeContent の両方を実行する
then 両 op とも「次元スキップ」として同一に解釈される（purgeOldRecords の全件削除は発生しない）
```

### シナリオ 2: 正常値と異常値の契約は round 11 どおり（境界）
```gherkin
Given retentionDays=90 / maxRecords=1000 / NaN / -1
When planPurge を通す
then 正常値は通過・NaN/-1 は fail-closed（回帰なし）
```

## DoD

- [x] planPurge 契約修正・backend `!= null` 統一
- [x] parametric テーブル新設
- [x] offscreen purge 関連テスト green
- [x] type-check / lint green

## 実装メモ（2026-09-12）

- `planPurge` が `0` を `undefined`（次元スキップ）に正規化 — backend の既存 `!= null && > 0` ガードと契約が一致（backend 側の変更なし）
- `PlanPurgeResult` 型に `| undefined` を明示（exactOptionalPropertyTypes 対応）
- planPurge テストの 0 ケースを新契約に更新
- 検証: planPurge + coverage 100 tests green・offscreen 全 76 ファイル 1055 tests green・type-check green

## 見積もり

🟢低（1pt目安） / 副作用: 🟡軽微（`0` の意味が「全件削除」から「スキップ」に確定 — UI は 0 を送らないため実害なし）
