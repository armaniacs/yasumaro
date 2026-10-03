# PBI: archive パネルの restore file input を busy 相互排除スコープへ含める

## ユーザーストーリー

診断パネルで archive 操作を行うユーザーとして、処理中に 2 つ目の操作が始まってステージング名が混線し、別のファイルを restore してほしくない。restore file input が busy スコープ外で有効なままになり、共有クロージャの staging name が 2 経路で競合するから。

## 優先度

- 順位: 08/15
- RICE: 3.6（R3 / I2 / C0.9 / E1.5）
- 根拠: restore 中の誤ファイル preview/open/stage というデータ整合の実害（R3・I2）。file input をスコープへ足す + confirm-dialog 経路の構造修正（C0.9・E1.5）
- 依存: rank-05（onError）PBI の完了後に着手 — `panelAction.ts` 共有の可能性

## 現状（証拠）

- `src/dashboard/panels/diagnostic/archivePanel.ts:49` の `restoreFileInput` が controls（`:56`）に含まれず、in-flight 中も有効
- change handler の gate は file 存在のみ（`archivePanel.ts:417-418`）
- 2 つ目の `runPanelAction` が開始できる（`src/dashboard/panels/panelAction.ts:70-91` に counter/guard なし）
- 1 つ目の finally（`panelAction.ts:88`）が 2 つ目の実行中に全ボタンを再 enable
- Staging race: `archivePanel.ts:429-430` の共有クロージャが `restoreStagingName`/`lastStagingName` を書く。flow1 が `await`（`:434`）後に flow2 の名前を読み、誤ファイルを preview/open/stage。`assertRegisteredStagingName` は PASS する（prepareIncoming が登録済み: `src/offscreen/archiveStaging.ts:72-76, 113-117`）。engine validation は intra-file のみ
- OPFS lock は後続の `createWritable`（`archivePanel.ts:436`、try 外の raw reject）で失敗する可能性が高い
- 同型: `src/dashboard/panels/diagnosticsActions` の confirm dialog は `runPanelAction` の **前** に await され（`:163-169, :239-245`）、dialog 中はボタン有効。`archivePanel.ts` purge（`:161`）/ sessionClose（`:395`）も同様
- 既存構造は `b21034d0` の rewrite で保持済み

## BDD受け入れシナリオ

```gherkin
Scenario: in-flight 中に 2 つ目の restore が始まらない
  Given restore が実行中である
  When file input を操作する
  Then 2 つ目の runPanelAction は開始しない（busy スコープか in-flight guard で防がれる）

Scenario: staging name が混線しない
  Given 2 つの restore 操作が近接して走る
  When flow1 が await から戻る
  Then flow1 は自分の staging name で preview/open/stage し、flow2 の名前を読まない

Scenario: confirm dialog 中もボタンが二重発火しない
  Given diagnosticsActions の confirm dialog が開いている
  When ユーザーが別の操作ボタンを押す
  Then 実行中アクションとの競合が発生しない（dialog も busy スコープに含まれる）
```

## 受け入れ基準

- [x] `src/dashboard/panels/diagnostic/archivePanel.ts:49` の `restoreFileInput` が busy スコープ（`:56` の controls）に含まれるか、in-flight 中の `runPanelAction` 二重開始が構造的に防がれる
- [x] `src/dashboard/panels/panelAction.ts:70-91` の二重実行が guard（counter または in-flight 判定）で防がれ、finally（`:88`）が他実行を壊さない
- [x] `src/dashboard/panels/diagnostic/archivePanel.ts:429-430` の staging name 共有クロージャで誤ファイルの preview/open/stage が起こらない
- [x] `archivePanel.ts:436` の `createWritable` reject が try 外の raw reject で放置されない
- [x] confirm dialog を await する前に `runPanelAction` を外す経路（`src/dashboard/panels/diagnosticsActions.ts:163-169, :239-245`、`archivePanel.ts:161, :395`）のボタン有効状態が対応される

## テスト戦略

- 単体: `panelAction.test.ts` に 2 つ目の開始が guard で拒否されることを pin
- 単体: `archivePanel` の restore 経路に file input 再操作を注入し、二重実行が起こらないことを pin
- 単体: diagnosticsActions の confirm dialog 経路の busy 状態テスト
- 既存テスト green 維持 + `npm run validate` が通ること

## 見積もり

1.5 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録（2026-10-03）

- 裁定: 両方の防御を採用 — `restoreFileInput` を busy スコープ（controls）へ含め、かつ `runPanelAction` に `inFlightControls`（WeakSet）guard を導入して共有 control の二重開始を構造的に拒否
- `src/dashboard/panels/panelAction.ts` — `buttons` 型を `HTMLInputElement` へ拡張（file input を格納可能に）、`inFlightControls` WeakSet で in-flight 中の共有 control を検出して return。finally は自分の control のみ restore（他実行を壊さない）
- `src/dashboard/panels/diagnostic/archivePanel.ts` — `restoreFileInput` を controls に追加、staging name をローカル変数化（await 中の再 pick による共有クロージャ上書きを除去し、自分の名前で preview/open/stage）、`createWritable` を try 内へ移動（reject を abort 経路へ）、sessionClose の confirm dialog を run 内へ移動（dialog 中も controls disabled、キャンセルは `abortPanelAction`）
- `src/dashboard/panels/diagnostic/diagnosticsActions.ts` — migrate/cleanup の confirm dialog を run 内へ移動（`abortPanelAction` でキャンセル中断）。purge（`archivePanel.ts:161`）も同型で run 内 + `abortPanelAction`
- テスト: `panelAction.test.ts`（二重開始拒否 pin）、`archivePanel.test.ts`（restore 経路の file input 再操作・staging 分離）、`diagnosticsActions.test.ts`（dialog 経路 busy 状態）を更新・追加
- 検証: tsc 0 エラー・lint 0 エラー・test 15,476 pass・validate exit 0・当該 53 tests green・repeats=20
