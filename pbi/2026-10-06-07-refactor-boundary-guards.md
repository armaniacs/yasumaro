# PBI: 境界キャストと数値パースのガード欠落を型ガード付きヘルパーに集約する

## ユーザーストーリー

dashboard 設定系の保守担当者として、境界の無検証キャストをなくしたい。正常系では動くが、不正値混入時に `undefined` 伝播・誤ソート・誤 fetch になる箇所が反復しているから。

## 優先度

- 順位: 7/23
- RICE: 3.6（R3 / I1 / C0.9 / E1）
- 根拠: 各ヘルパー 10 行前後＋呼び出し置換。正常値の出力不変
- 依存: なし（NN18 の先行としてガードヘルパーを確定させる）

## 背景（file:line 現状）

- `src/dashboard/settings/customPromptManager.ts:99,110,302,352,399,418,511`（`(currentSettings[...] as CustomPrompt[]) || []` の同文 7 箇所。`:284` の provider 断定も無検証）
- `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts:122`（`as boolean | undefined`）、`:161,211`（`Record<string,unknown>` 往復）、`:144,326`（`as` 断定）、`:313-323`（`parseInt` 6 連で NaN ガードなし）
- `src/dashboard/settings/trustSettings.ts:532,542,552`（`dataset.category as TrustCategory` 等 3 箇所）
- `src/dashboard/panels/asyncData/sqliteHistoryModel.ts:556,559`（`as string`）
- `src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts:669,676,680,684,716`（`Number()` で NaN ガードなし）、`:773-774,810`（`dataset.date!` 断定）

## BDD受け入れシナリオ

```gherkin
Scenario: 不正値がデフォルトに倒れる
  Given 欠損キー・NaN・未知カテゴリの入力
  When 各ヘルパーに通す
  Then 例外なくデフォルト（[] / false / 既定値）に倒れる

Scenario: 正常値の出力が変わらない
  Given 正常な設定スナップショット
  When 読み出す
  Then 従来と同一の値になる
```

## 受け入れ基準

- [x] `CUSTOM_PROMPTS` 読みが `Array.isArray` ガード付き `asCustomPrompts(unknown)` に一本化されている
- [x] `ruleValues` 往復が `getRuleFlag(settings,key)` に畳まれている
- [x] `parseInt` 群に `Number.isNaN` フォールバックが付いている
- [x] `dataset.category` に `isTrustCategory`、`data-id` に `Number.isInteger` ガードが付いている
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 各ヘルパーの正常・不正テスト。既存テストが green
- 実時間待ちは使わない

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `customPromptManager.ts`・`aiSummaryCleansingSettingsV2.ts`・`trustSettings.ts`・`sqliteHistoryModel.ts`・`sqliteHistoryPanelView.ts`（ガードヘルパー＋置換のみ）
- ゲート: settings 11 ファイル 307 tests＋asyncData 7 ファイル 80 tests green / type-check PASS / lint 0 errors
