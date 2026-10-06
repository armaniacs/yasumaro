# PBI: 一般設定の top/bottom ボタン対×4 が無効化範囲・status 書き込み先まで食い違っている

## ユーザーストーリー

設定画面の利用者として、一般設定の操作ボタンの再入ガードを統一したい。4 ハンドラの無効化規約がバラバラで、連打により並行ダウンロード・並行テスト・並行保存が成立するから。

## 優先度

- 順位: 14/32
- RICE: 4.0（R4 / I2 / C1.0 / E2）
- 根拠: 共有セーム `runPanelAction`（再入抑止込み）が実在するのにこの 4 つだけが未適用。純 RICE では NN17 より下だが同一ファイルの順序依存で NN17 に先行する
- 依存: なし（NN17 の先行）

## 背景（file:line 現状）

すべて `src/dashboard/generalSettings/connectionTests.ts`:

- `:245-264` の `handleSaveOnly`: ボタン無効化なし。`#status` へ書く（`:251-255` success、`:261-263` showSaveError with syncTop:true）
- `:266-331` の `handleTestObsidian`: `:277` で bottom のみ `disabled = true`、`:329` で bottom のみ復元。`#status` + `:323, :327` で sync
- `:333-402` の `handleTestAi`: `:346-351` で両方無効化（この 1 つだけ）。`#status` + `:370, :371, :393, :398` で sync
- `:404-477` の `handleTestLocalMarkdown`: `:405, :413, :475` で top のみ無効化。**`#statusTop` 直書き**（`:406-411, :431-432, :462-463, :472-473`）、sync なし。`:421` の showSaveError も top へ
- `:44-51` の `showSaveError` の `syncTop` オプションは「呼ぶかどうかを呼び出し側が記憶」する契約
- 配線: `src/dashboard/panels/staticForm/generalSettingsPanel.ts:113-117`（top）、`:130-133`（bottom）
- 未適用の共有セーム: `src/dashboard/panels/panelAction.ts:74-115`（`inFlightControls` WeakSet による再入抑止、finally で disabled/ラベル復元）。適用済みは `generalSettings/settingsForm.ts:173, :203` と diagnostic 系のみ
- ガードの正の実装例: `src/dashboard/aiTestRunner.ts:79, :122-123, :173-178`
- 影響: bottom の Test Local Markdown 連打で並行ダウンロードが成立、top の Test Obsidian 連打で並行テストが成立、Save は無ガードで並行保存

## BDD受け入れシナリオ

```gherkin
Scenario: いずれのボタンも連打で並行実行しない
  Given Test Obsidian / Test AI / Test Local Markdown / Save のいずれかの実行中
  When 対応する top / bottom のどちらかをもう一度押す
  Then 2 回目は実行されず、1 回目の完了後に両ボタンが復元される

Scenario: Save の並行保存が起きない
  Given 保存処理の実行中
  When Save をもう一度押す
  Then 2 回目は抑止される

Scenario: status の書き込み先が統一される
  Given 4 ハンドラのいずれかが成功・失敗する
  When 結果が表示される
  Then #status へ書いた後に必ず mirror され、#statusTop への直書きが残らない
```

## 受け入れ基準

- [x] ボタン対が表で宣言され、外側のラッパが「両方無効化 + 再入抑止 + status 1 本化」を担う（`runPanelAction` の `buttons: [top, bottom]` と `inFlightControls` を利用）
- [x] status は `#status` へ書いた後に必ず mirror される
- [x] ハンドラ内の手書き disabled / try / finally と `#statusTop` 直書きは削除されている
- [x] `showSaveError` の `syncTop` オプションが統合され、オプション自体が廃止されている（null ガード・`autoClear:false` は移設）
- [x] NN17 の移設先（`showStatus` 側への mirror 移設）と競合しない形になっている
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 再入抑止テスト（実行中に 2 回目を呼んでも 1 回しか実行されない）
- 単体: status 書き込み先の統一テスト
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

2 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/dashboard/generalSettings/connectionTests.ts`（ボタン対テーブル + `runPanelAction({ buttons: [top, bottom] })` ラッパへの移行。AI の外側にも `onError` を追加し runner 外の throw を吸収）、`src/dashboard/generalSettings/__tests__/connectionTests.test.ts`（Local Markdown 系の `#statusTop` → `#status` 更新 + 新規 4 件）
- ゲート: 対象 108 tests green / type-check PASS / lint 0 errors
