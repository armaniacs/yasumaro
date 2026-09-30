# PBI: recordingTriggerManager の閾値読みを blob 経由に修正する

種別: fix
状態: 実装済み（2026-09-28）

上流: 大局的コードレビュー 2026-09-28 テーマ2。同型の欠陥は `src/utils/aiUsageTracker.ts:67-72` で修正済みであり、本 PBI は残存1件の駆逐である。

## ユーザーストーリー

記録条件（スクロール深度・滞在時間）を設定したのに、scroll_idle イベントの記録可否判定が常に既定値で動くユーザーとして、設定が実際の判定に反映される状態を目指す。

## 優先度

- 順位: 1 / 7
- RICE スコア: 24.0（Reach=4 / Impact=2 / Confidence=100% / Effort=0.25）
- 根拠: 実害バグと同型の残存であり、修正は数行。aiUsageTracker の修正事例が再現手順と検証方法の前例になる

## 現状と問題

- `src/background/recordingTriggerManager.ts:125-127` は `MIN_SCROLL_DEPTH` / `MIN_VISIT_DURATION` をトップレベルキーで読み、`?? 50` / `?? 5` にフォールバックする
- 唯一の書き手 `src/dashboard/recordingConditionsSettings.ts:222-223` は `settingsRepository.setAll` で nested blob に書く。トップレベルに書くコードは存在しないため、この読みは常にフォールバックする
- aiUsageTracker の同型欠陥（カスタム上限が常に 10/min 既定値に落ち、レート制限が実質無効化）は 2026-09-22 に修正済み。同じ「blob/scattered 読み書き mismatch」クラスが1件だけ残っている

## BDD 受け入れシナリオ

```gherkin
Scenario: 設定した閾値が scroll_idle 判定に使われる
  Given MIN_SCROLL_DEPTH=80 / MIN_VISIT_DURATION=30 を dashboard で保存する
  When scroll_idle イベントが発生する
  Then decideRecordingTrigger に 80 と 30000 が渡される

Scenario: 未設定時は既定値に落ちる
  Given 閾値を設定していない
  When scroll_idle イベントが発生する
  Then 50 と 5000 が使われる
```

## 受け入れ基準

- [x] `shouldRecord` の scroll_idle 分岐が `SettingsRepository`（または blob 読み）経由で閾値を取得する
- [x] トップレベルキー読みとリテラルフォールバック `?? 50` / `?? 5` がなくなる（既定値は `defaults.ts` の定数を参照する。PBI 28 と重複する場合はそちらへ委譲してよい）
- [x] blob 欠落時のフォールバック挙動がテストで pin される

## テスト戦略

- 単体: blob 値あり/なしの2ケース。aiUsageTracker 修正時の pin を参照する
- 既存 pin: `aiUsageTracker` の同型テストが green のままであること

## 見積もり

0.25 SP

## Definition of Done

- [x] BDD シナリオに対応するテストがパスする
- [x] `npm run validate` が通る
- [x] トップレベルキーへの直接依存が残っていないことを `rg` で確認する
