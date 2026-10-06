# PBI: content/popup の console 残存 6 箇所を utils/logger に統一する

## ユーザーストーリー

content・popup の保守担当者として、ログ経路を 1 つにしたい。`utils/logger` が使える場所で `console.*` が残り、dev-trace と本番ログが二重に出るから。

## 優先度

- 順位: 21/23
- RICE: 1.5（R3 / I0.5 / C1.0 / E1）
- 根拠: 6 箇所の置換。bench 計測は不変
- 依存: なし

## 背景（file:line 現状）

- `src/content/visitReporter.ts:165`（`console.info` 開始）と `:184`（`console.info` 応答）— 直前・直後に `logInfo`/`logDebug` があり重複
- `src/content/contentKernel.ts:232`（`console.info` 自動保存トリガー）
- `src/content/loader.ts:79`（`warn` コールバックが `console.warn` 直結）
- `src/popup/spinner.ts:17,36`（`console.warn` 要素不在 2 箇所）
- 対照: content/popup で `utils/logger` を使うファイルは 13 件あり、利用可能性は実証済み
- 不変: `benchMark('ow-extract-start')` 等の Performance 計測は触らない

## BDD受け入れシナリオ

```gherkin
Scenario: ログが一本化される
  Given 上記 6 箇所
  When 実行する
  Then utils/logger 経由で出力され、console 直呼びが残らない
```

## 受け入れ基準

- [x] 6 箇所が `logInfo`/`logWarn`（`void` 付き fire-and-forget 形）に置換されている
- [x] `loader.ts:79` の `warn` が logger ベースの関数に差し替わっている
- [x] Performance 計測（benchMark）は不変
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 既存 content/popup テストが green
- 実時間待ちは使わない

## 見積もり

1 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `visitReporter.ts`（重複 2 行を削除。隣接 log が同内容をカバー）、`contentKernel.ts`・`loader.ts`・`spinner.ts`（logger 置換。文言維持）、テスト 3 ファイル（assert 先を logWarn mock に変更）
- ゲート: 対象 6 ファイル 86 tests green / type-check PASS / lint 0 errors
