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

- [ ] `src/dashboard/panels/diagnostic/archivePanel.ts:49` の `restoreFileInput` が busy スコープ（`:56` の controls）に含まれるか、in-flight 中の `runPanelAction` 二重開始が構造的に防がれる
- [ ] `src/dashboard/panels/panelAction.ts:70-91` の二重実行が guard（counter または in-flight 判定）で防がれ、finally（`:88`）が他実行を壊さない
- [ ] `src/dashboard/panels/diagnostic/archivePanel.ts:429-430` の staging name 共有クロージャで誤ファイルの preview/open/stage が起こらない
- [ ] `archivePanel.ts:436` の `createWritable` reject が try 外の raw reject で放置されない
- [ ] confirm dialog を await する前に `runPanelAction` を外す経路（`src/dashboard/panels/diagnosticsActions.ts:163-169, :239-245`、`archivePanel.ts:161, :395`）のボタン有効状態が対応される

## テスト戦略

- 単体: `panelAction.test.ts` に 2 つ目の開始が guard で拒否されることを pin
- 単体: `archivePanel` の restore 経路に file input 再操作を注入し、二重実行が起こらないことを pin
- 単体: diagnosticsActions の confirm dialog 経路の busy 状態テスト
- 既存テスト green 維持 + `npm run validate` が通ること

## 見積もり

1.5 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了
