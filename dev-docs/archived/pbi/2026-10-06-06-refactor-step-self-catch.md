# PBI: ステップ内自前 catch が Executor の再試行・集約を迂回している

## ユーザーストーリー

パイプラインの保守担当者として、失敗処理の所有を Executor・outcome 政策に一本化したい。一部ステップが内部で catch して握りつぶすため、`extractSentences` の RETRY 予算が発火せず、`saveSqlite` で二重ログになるから。

## 優先度

- 順位: 6/23
- RICE: 4.0（R5 / I2 / C0.8 / E2）
- 根拠: AI 要約の再試行予算が無駄になる実害。フォールバック継続の方針裁定が残る
- 依存: なし（NN05 と順序不問）

## 背景（file:line 現状）

- `src/background/pipeline/steps/extractSentencesStep.ts:128-152`（catch 内でログ＋errors 追記して正常 context 復帰。`strategy: BEST_EFFORT` を自称）
- `src/background/pipeline/steps/saveSqliteStep.ts:74-82` と `:104-111`（log-and-rethrow 2 箇所）
- `src/background/pipeline/RecordingOrchestrator.ts:104-105`（`privacyPipeline`/`extractSentences` に `RETRY,maxRetries:3,offlineRetry ai_summary` 付与 — 実質不発）
- `src/background/pipeline/stepExecutor.ts:49-60`（RETRY 再試行＋backoff の正規所有者）
- 競合なし: `savePhase.ts:52-57` の型スキップとは無関係

## BDD受け入れシナリオ

```gherkin
Scenario: extractSentences の失敗が政策に委ねられる
  Given 文抽出の失敗時
  When 処理する
  Then ErrorStrategy 宣言と decideStepOutcome に継続可否が委ねられ、RETRY 予算が発火しうる

Scenario: saveSqlite の二重ログが消える
  Given insert/regenerate 更新の失敗時
  When 処理する
  Then ログは executor/outcome 側に寄り、素投げになる
```

## 受け入れ基準

- [x] `extractSentencesStep` の内部 catch が削除され素通しになる（フォールバック内容が必要なら `PipelineError` 側に載せる）
- [x] `saveSqliteStep` の 2 箇所が素投げになり、観測は executor/outcome 側に寄る
- [x] 成功時 context 形状は不変
- [x] 既存の parity / offline-policy テストが green
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 既存 parity / offline-policy 系テストが green。RETRY 発火のテストがあれば維持
- 実時間待ちは使わない（注入 sleep を使用）

## 見積もり

2 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `extractSentencesStep.ts`（素通し化。未使用 import 削除）、`saveSqliteStep.ts`（2 箇所素投げ化。queue 二重失敗ログは保持）、`extractSentencesStep.test.ts`（握りつぶし期待を rejects に変更＋stub 補完）
- ゲート: 対象 6 ファイル 50 tests green / type-check PASS / lint 0 errors
