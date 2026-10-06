# PBI: popup 初期化が 3 経路に分散し、「単一 entry point」宣言と矛盾している

## ユーザーストーリー

popup の保守担当者として、初期化を宣言どおりの 1 entry point に寄せたい。副作用 import・DOMContentLoaded 二重登録・import 時配線が別に存在し、順序が暗黙仕様で新パネル追加時の規約が判断できないから。

## 優先度

- 順位: 30/32
- RICE: 1.6（R4 / I1 / C0.8 / E2）
- 根拠: popup 起動系の改修時のみ関わる。配線の寄せ方に設計判断が残る
- 依存: なし

## 背景（file:line 現状）

- 宣言: `entrypoints/popup/main.ts:14-15` と `src/popup/popup.ts:100-102` が「初期化は initPopup の 1 entry point」と明記
- 実態の 3 経路:
  1. 副作用 import: `entrypoints/popup/main.ts:10-11`（拡張子なし）
  2. DOMContentLoaded の二重登録: `entrypoints/popup/main.ts:27-33`（**readyState ガードあり**）と `src/popup/main.ts:27-40`（**readyState ガードなし**）の非対称。スクリプト注入タイミングが変わると無言で何も起きない
  3. import 時配線: `src/popup/pendingPages.ts:219-220` の `setupEventListeners()`、`src/popup/privatePageDialog.ts:139-144, :146-158, :160-177, :179-196, :198-203, :205-218` の addEventListener 6 箇所
- 到達不能な catch: `src/popup/popup.ts:35-39, :41-45, :47-52, :55-70` の try/catch が**非同期関数に適用**されており catch が走らない。正の実装は `entrypoints/popup/main.ts:33-38` の `.catch`

## BDD受け入れシナリオ

```gherkin
Scenario: 初期化が 1 entry point から呼ばれる
  Given popup の起動
  When 初期化の呼び出し元を数える
  Then initPopup（または initMainScreen）からの明示呼び出しに統一され、import 時配線が残らない

Scenario: readyState に関わらず初期化される
  Given loading / interactive / complete の各 readyState
  When 起動する
  Then いずれでも初期化が走る

Scenario: 非同期失敗が catch される
  Given popup.ts の非同期初期化が reject する
  When 実行する
  Then await 付き try/catch または .catch で捕捉され、logError に記録される
```

## 受け入れ基準

- [x] 副作用が明示呼び出しになっている（`privatePageDialog` に `wireDialogButtons()` を置き、`pendingPages.setupEventListeners` と併せて `initPopup` から呼ぶ。import 自体は型・関数参照だけ）
- [x] `src/popup/main.ts` の DOMContentLoaded 内処理が `export async function initMainScreen()` になり、entrypoints 側の readyState 判定の下から 1 箇所呼ばれる
- [x] `popup.ts` の非同期関数の try/catch に `await` が付くか `.catch` に置換されている
- [x] 既存の個別 try/catch（`popup.ts:30, :37, :43, :50, :68`）は `logError` の文言を保ったまま残る
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 初期化の呼び出し順序テスト、readyState 各状態のテスト
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

2 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `entrypoints/popup/main.ts`（副作用 import をやめ明示呼び出し）、`src/popup/main.ts`（`initMainScreen()` を export）、`src/popup/pendingPages.ts`（import 時呼び出しを削除）、`src/popup/privatePageDialog.ts`（`wireDialogButtons()` + once ガード）、`src/popup/popup.ts`（明示呼び出し + `await` 付与）、テスト 2 ファイル（mock 追加 + dispatch 17 箇所を `initMainScreen()` 化）
- 統合修正: import 時配線を前提にした 3 テストファイルを統合側で追従（main-domcontentloaded の dispatch 8 箇所を `await initMainScreen()` 化、privatePageDialog ×2 の動的 import 35 箇所に `wireDialogButtons()` 追加）
- ゲート: 対象 97 + 44 tests green / type-check PASS / lint 0 errors
