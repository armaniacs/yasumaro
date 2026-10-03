# PBI: runPanelAction の onError ハンドラが投げる例外が新たな rejection になるのを防ぐ

種別: fix (adversarial-review, RICE #5)

## ユーザーストーリー

ダッシュボードでアクションを実行するユーザーとして、処理が失敗したときにエラー表示が出てボタンが復帰することを期待する。エラー表示処理自体の失敗が新たなクラッシュになるなら、失敗処理が信頼できなくなるから。

## 優先度

- 順位: 05/15
- RICE: 10.0 (R5 / I1 / C1.0 / E0.5)
- 根拠: 25 個の呼び出し箇所を持つ共通経路で、onError 内の throw が呼び出し元の rejection に化けるため R5。修正が 1 箇所で完結するため C1.0。依存注記: 本 PBI が rank-08 archive-exclusion PBI (panelAction.ts を共有する可能性) に先行するため、先に完了する。

## 背景 (evidence, verified)

- `src/dashboard/panels/panelAction.ts:84-86` — catch 内で `onError?.()` を素呼び出ししており、onError 内の throw が新たな rejection として外に漏れる (`finally :87-91` は引き続き実行)。
- 呼び出し 25 箇所: `void` 20、await-in-closure 3 (`archivePanel.ts:402`、`diagnosticsActions.ts:171,247`)、caught 2 (`settingsForm.ts:173,203` — `onPurgeClick` try/catch 経由、`generalSettingsPanel.ts:361-367`)。
- await-in-closure の 3 箇所では onError の throw が unhandled rejection として漏れ得る。

## スコープ (file:line)

- `src/dashboard/panels/panelAction.ts:84-86`
- `src/dashboard/panels/panelAction.ts:87-91`

## BDD 受け入れシナリオ

```gherkin
Scenario: アクション失敗時にエラー表示が出てボタンが復帰する
  Given ユーザーがダッシュボードでアクションを実行する
  When アクションが失敗する
  Then エラーメッセージが表示され、ボタンが再び押せる状態に戻る

Scenario: エラー表示処理自体が失敗してもクラッシュしない
  Given アクションが失敗した
  When エラー表示の処理自体が失敗する
  Then その失敗が新たなエラーとして外部に漏れず、ボタンは復帰する
```

## 受け入れ基準 (file-scoped)

- [ ] `src/dashboard/panels/panelAction.ts:85-86` — `onError?.()` の呼び出しが guard され、onError 内の throw が新たな rejection として外に漏れない
- [ ] `src/dashboard/panels/panelAction.ts:87-91` — `finally` によるボタン復帰が引き続き実行される
- [ ] onError が throw した場合の扱い (記録して握りつぶす方針とその WHY コメント) がコードとして明文化される
- [ ] await-in-closure 3 箇所 (`archivePanel.ts:402`、`diagnosticsActions.ts:171,247`) と caught 2 箇所 (`settingsForm.ts:173,203`) の現行ふるまいが不変である

## テスト戦略

- 単体: `runPanelAction` に throw する onError を注入し、外に rejection が漏れないことと finally 実行を pin するテスト
- 統合: onError が正常な既存パネルアクションテスト green 維持
- E2E: 失敗するアクションでエラー表示とボタン復帰を手動確認

## 見積もり

0.5 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了
