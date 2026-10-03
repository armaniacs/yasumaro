# PBI: logInfo の details と source 引数が入れ替わっている呼び出しを修正する

種別: fix (adversarial-review, RICE #4)

## ユーザーストーリー

ログを診断で利用する開発者・保守担当者として、ログのモジュール名とメッセージが正しい位置に記録されてほしい。引数が入れ替わったままだと、フィルタや集計が壊れ、障害調査の情報が失われるから。

## 優先度

- 順位: 04/15
- RICE: 10.0 (R5 / I1 / C1.0 / E0.5)
- 根拠: 障害調査時のログ信頼性に直結するが、ユーザー可視の機能低下ではないため I1。修正機械的で確実なため C1.0。依存注記: 本 PBI の `settingsPipeline.ts` 編集が rank-06 PBI (同ファイル) に先行するため、先に完了する。

## 背景 (evidence, verified)

- 署名: `src/utils/logger/api.ts:61-64` — `logInfo(message, details?, source?)`。JSDoc `:57-59` は `message=メッセージ` / `source=出力元`。
- 呼び出し `src/dashboard/settingsPipeline.ts:149` — `logInfo('settingsPipeline', { layout }, 'Provider priority collection failed; aborting save')` が本文メッセージを source スロットに入れ、モジュール名を message スロットに入れている (入れ替わり)。
- 同様に `settingsPipeline.ts:230-234`、`trancoManager.ts:61` (systematic に入れ替わり)。
- 正しい使用例は `logger-enhanced.test.ts:208` で pin 済み。

## スコープ (file:line)

- `src/dashboard/settingsPipeline.ts:149`
- `src/dashboard/settingsPipeline.ts:230-234`
- `src/dashboard/trancoManager.ts:61`

## BDD 受け入れシナリオ

```gherkin
Scenario: ログにモジュール名とメッセージが正しい位置で記録される
  Given 設定パイプラインで情報ログが出力される
  When 該当のログ処理が実行される
  Then モジュール名が出力元 (source) に、本文がメッセージ (message) に記録される

Scenario: 既存の正しい呼び出しは影響を受けない
  Given 正しい引数順で呼び出している箇所が存在する
  When 修正が適用される
  Then それらのログ出力に変化がない
```

## 受け入れ基準 (file-scoped)

- [ ] `src/dashboard/settingsPipeline.ts:149` — `logInfo` 呼び出しが `message` / `details` / `source` の契約 (`logger/api.ts:61-64`) に沿う
- [ ] `src/dashboard/settingsPipeline.ts:230-234` — 同上
- [ ] `src/dashboard/trancoManager.ts:61` — 同上
- [ ] `logger-enhanced.test.ts:208` が pin する正しい使用例との整合が維持される
- [ ] 入れ替わっていた 3 箇所の修正後に、message / source の位置を検証するテストが追加される

## テスト戦略

- 単体: message / source の位置契約を検証するテスト (入れ替わりが再発すると落ちる)
- 統合: 既存 logger 系テスト green 維持
- E2E: なし (ログ内部の修正のため、単体・統合で十分)

## 見積もり

0.5 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了
