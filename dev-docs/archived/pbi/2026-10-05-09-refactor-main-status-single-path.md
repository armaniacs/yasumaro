# PBI: `#mainStatus` への statusChannel 経路と素の直書き経路の併存（class 契約 2 系統 + stale-clear race）

## ユーザーストーリー

popup の利用者として、`#mainStatus` への表示経路を 1 本にしたい。直書き側は TTL タイマーを持たないため、statusChannel 側の期限タイマーが直書きメッセージを消して class を置換する race が起きるから。

## 優先度

- 順位: 9/32
- RICE: 6.0（R6 / I2 / C1.0 / E2）
- 根拠: popup のほぼ全表示に波及する。NN31 / NN28 の先行（経路競合と class pin 更新）
- 依存: なし（NN31・NN28 の先行）

## 背景（file:line 現状）

- 経路 A（statusChannel 経由・TTL タイマーあり）: `src/popup/statusPanel.ts:22` の `statusChannel.register('mainStatus', { defaultTtlMs: 2000 })`、`:259` / `:262-266` / `:284` / `:287-291` の report、`src/popup/trustPanel.ts:26`、`src/popup/privatePageDialog.ts:135`、`src/utils/ui/statusChannel.ts:30-44`
- `cancelPendingClear` は `src/utils/ui/settingsUiHelper.ts:69` にのみ存在し、`:77-81` に pending clear がある
- 経路 B（class 直書き・タイマーなし）: `src/popup/errorUtils.ts:234`（showError が `statusElement.className = STATUS_CLASS.error`）と `:258`（showSuccess）。呼び出しは `src/popup/pendingPages.ts:31, :199`、`src/popup/recordCurrentPage/recordSession.ts:489, :529`
- 経路 B の実装箇所: `errorUtils.ts:234, :258` / `pendingPages.ts:30-31, :197-199` / `privatePageDialog.ts:105-117` / `recordSession.ts:332-333, :349-350, :388-389, :489, :523-524, :529, :360`
- 隠れた結合: `'mainStatus'` の register は `statusPanel.ts:22` のみ。`trustPanel` / `privatePageDialog` が report できるのは他モジュールの import が register を走らせるから（未登録だと既定 TTL 3000/5000 に落ちる）
- 既存 pin の非対称: `src/popup/__tests__/statusPanel-extra.test.ts:1129, :1141` は `status-message error`、`src/popup/__tests__/pendingPages-errorBoundary.test.ts:174, :370` は素の `error` / `success`
- 閉済スコープ: `dev-docs/archived/pbi/2026-09-28-19-refactor-status-message-residual-bundle.md` の対象は `statusPanel.ts` の 4 箇所のみで、下記は対象外だった

## BDD受け入れシナリオ

```gherkin
Scenario: statusChannel 発行後に直書き系の表示が消えない
  Given statusChannel 経由でメッセージを表示し 2000ms タイマーが発行されている
  When 直後に errorUtils 系の表示が書かれる
  Then 先に書かれたタイマーで後のメッセージが消えず、class も status-message 系で統一される

Scenario: 強制記録ボタン付きエラーも 1 経路で表示される
  Given DOMAIN_BLOCKED エラーで onForceRecord がある
  When showError が呼ばれる
  Then 本文は statusChannel 経由で表示され、ボタンは status 要素の外側の親に出る

Scenario: 既存の契約テストが更新される
  Given 置換後の class 契約
  When pendingPages-errorBoundary テストを実行する
  Then 素 class の pin が status-message 系に更新され green になる
```

## 受け入れ基準

- [x] 経路 B が `statusChannel.report('mainStatus', ...)` に置換され、表示経路が 1 本になっている
- [x] `errorUtils.showError` の `onForceRecord` ボタンは status 要素の外側の親（既存の `alert-btn` を append する場所）へ出し、本文だけ report に渡す
- [x] `register` が `statusPanel.ts:22` から `statusClasses.ts`（`STATUS_CLASS` を既に持つ葉モジュール）へ移されている
- [x] `pendingPages-errorBoundary.test.ts:174, :370` の素 class pin が `status-message <type>` に更新されている（`statusPanel-extra.test.ts:1129, :1141` は現状のまま緑を維持）
- [x] 既存の try/catch と null ガード（`errorUtils.ts:232` の引数ガード、`pendingPages.ts:31` の `if (statusDiv)`、`recordSession.ts:378` の `if (!statusDiv)`）は呼び出し側の if のまま移されている
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 契約テスト: class 契約の統一（status-message 系）を pin。TTL stale-clear の race が起きないことをタイマー駆動テストで検証（実時間待ちではなく注入タイマー）
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

2 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/popup/statusClasses.ts`（STATUS_CLASS のフル契約化 + register 移設）、`src/popup/errorUtils.ts`（report 経由化。ボタンは親へ）、`src/popup/privatePageDialog.ts`（直書き 2 箇所を置換）、`src/popup/recordCurrentPage/recordSession.ts`（4 箇所を置換）、`src/popup/statusPanel.ts`（register 削除→副作用 import）。`pendingPages.ts` / `statusChannel.ts` / `settingsUiHelper.ts` は変更不要と判断
- テスト: pin 更新 3 ファイル、対象 9 ファイル 290 tests green
- ゲート: type-check PASS / lint 0 errors
