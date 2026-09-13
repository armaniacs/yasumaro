# PBI: issue報告モーダルの隠れた再入防止ガードをcontrollerオブジェクトへ集約

## ユーザーストーリー
保守担当者として、`issueReportLink.ts`の`wireIssueReportButton()`を読んだときに、関数シグネチャだけで正しい呼び出し方（診断パネル・サイドバー双方から呼ぶ、呼び出し順序に意味がある）が分かるようにしたい。なぜなら、現状は`pendingUrl`・`modalWiredTo`というmodule-scoped変数が隠れた再入防止ガードとして機能しており、関数を1回だけ呼ぶ・別の順序で呼ぶといった誤用がテストなしでは検出できないから。

## 優先度
- 順位: 04
- 根拠: 機能追加ではなく可読性・保守性のためのリファクタリング。挙動を変えないため独立して実施可能。

## 制約
- 診断パネル・サイドバーの2箇所からの呼び出しAPIは変更しないか、変更する場合は両呼び出し元を同時に更新すること
- 共有モーダル（`#bugReportPreviewModal`）の表示・Cancel/Close/Openの既存動作を変えないこと
- `pendingUrl`・`modalWiredTo`のmodule-scoped変数を残さないこと

## BDD受け入れシナリオ

```gherkin
Scenario: createIssueReportModalControllerがcontrollerオブジェクトを返す
  Given モーダル要素一式とcollectSnapshot関数がある
  When createIssueReportModalController(modalEls, collectSnapshot) を呼び出す
  Then { attachTrigger(btn) } を持つオブジェクトが返る
  And module-scopeのpendingUrl・modalWiredTo変数は存在しない

Scenario: 診断パネル・サイドバー双方からattachTriggerで配線する
  Given dashboard.tsが1つのcontrollerインスタンスを生成済み
  When 診断パネルが自身の#diagReportBugBtnをattachTriggerで配線する
  And サイドバーが自身の#sidebarReportBugBtnをattachTriggerで配線する
  Then どちらのボタンをクリックしても同じ共有モーダルが開く
  And Cancel/Close/Openの挙動はどちらの経路でも変わらない

Scenario: サイドバーボタンから開いてOpenで確認する
  Given controllerがサイドバーボタンにattachTrigger済み
  When サイドバーの「不具合を報告」ボタンを押す
  And プレビューダイアログの「開く」ボタンを押す
  Then chrome.tabs.createが正しいURLで1回だけ呼ばれる
  And プレビューダイアログは閉じる

Scenario: Cancelでタブを開かず閉じる
  Given controllerがボタンにattachTrigger済みでモーダルが開いている
  When 「キャンセル」ボタンを押す
  Then プレビューダイアログが閉じる
  And 「開く」ボタンを押してもchrome.tabs.createは呼ばれない
```

## 実装ノート
- `createIssueReportModalController(modalEls, collectSnapshot)` が `{ attachTrigger(btn) }` を返すオブジェクトとして実装される
- `pendingUrl`・`modalWiredTo` のmodule-scoped変数はcontroller内部のクロージャ変数に置き換える
- `dashboard.ts` でcontrollerを1度だけ生成し、`getIssueReportModalController()` 経由で診断パネル・サイドバー双方の配線に使い回す
- 診断パネル単体でマウントされる既存のパネル単体テスト（`initDashboard()`を経由しない）を壊さないよう、controller未生成時は`getIssueReportModalController()`が`null`を返し、呼び出し側は`?.attachTrigger(...)`で安全にスキップする

## Definition of Done
- [x] `createIssueReportModalController`が`{ attachTrigger(btn) }`を返すオブジェクトとして実装されている
- [x] `pendingUrl`・`modalWiredTo`のmodule-scoped変数が削除されている
- [x] `dashboard.ts`でcontrollerを1度だけ生成し、診断パネル・サイドバー双方の配線に使い回している
- [x] `issueReportLink.wire.test.ts`が新しい構造に合わせて更新され、再入防止の保証がテストで示されている
- [x] 診断パネル・サイドバーの呼び出し方は変更しないか、変更する場合は両呼び出し元を同時に更新した
- [x] 共有モーダルの表示・Cancel/Close/Openの既存動作が変わっていない
- [x] `npm run type-check`がグリーン
- [x] 該当ユニットテスト（`issueReportLink.wire.test.ts`、`issueReportLink.test.ts`、`diagnosticsPanel.*.test.ts`）がグリーン
