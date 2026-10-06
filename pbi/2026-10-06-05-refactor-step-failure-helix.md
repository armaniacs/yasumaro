# PBI: Orchestrator と SavePhase の catch 継続ブロック写経をヘルパー化する

## ユーザーストーリー

recording パイプラインの保守担当者として、catch 側の定型処理を 1 つにしたい。`decideStepOutcome` 集約後も呼び出し側の写経（outcome 解決→done 分岐→errors 追記＋WARN）が 2 箇所に残り、継続ポリシーを変えると pre-save 段と save 段で観測ログが食い違うから。

## 優先度

- 順位: 5/23
- RICE: 4.0（R4 / I1 / C1.0 / E1）
- 根拠: `decideStepOutcome` 自体は単一のため残渣は呼び出し側のみ。ヘルパー 1 関数＋2 箇所置換
- 依存: なし

## 背景（file:line 現状）

- `src/background/pipeline/RecordingOrchestrator.ts:190-202`（pre-save loop）
- `src/background/pipeline/savePhase.ts:194-208`（sink loop。`outcomes.push` 付き）
- 対照: `src/background/pipeline/stepExecutor.ts:62-75`（outcome 解決をしない）
- 形状: `src/background/pipeline/recordingOutcome.ts:73-80`（`OutcomeStep` が両 loop から呼べる形状）
- 残すもの: SavePhase 側の `outcomes.push(status)` と `SqliteClientAbsentError` 分岐（`savePhase.ts:184-193`）

## BDD受け入れシナリオ

```gherkin
Scenario: 継続処理がヘルパー経由になる
  Given pre-save / save の失敗時
  When 処理する
  Then 同一ヘルパーで outcome 解決・errors 追記・WARN が行われる

Scenario: SavePhase 固有の分岐が残る
  Given SqliteClientAbsentError の場合
  When 処理する
  Then 型スキップ分岐が従来どおり動作する
```

## 受け入れ基準

- [x] `recordingOutcome.ts` に `handleStepFailure` 相当の薄いヘルパーがある
- [x] 両 loop から呼ばれ、`outcomes.push` と absent 分岐は残っている
- [x] 観測ログの文言・順序が不変
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 既存の pipeline parity / outcome テストが green
- 実時間待ちは使わない

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `recordingOutcome.ts`（StepFailureDisposition＋handleStepFailure）、`RecordingOrchestrator.ts`・`savePhase.ts`（写経を置換。outcomes.push と absent 分岐は残置）
- ゲート: pipeline 21 ファイル 256 tests green / type-check PASS / lint 0 errors
