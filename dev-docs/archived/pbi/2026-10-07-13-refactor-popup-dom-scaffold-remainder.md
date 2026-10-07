# PBI: popup テスト DOM 脚手架の残り 4 ファイルを共有 scaffold に寄せる（S6 完結）

## ユーザーストーリー

popup テストの保守担当者として、残り 4 ファイルの手作り DOM fixture が共有 setupPopupDom に乗ってほしい。共有 helper が fixture を表現できず手作りが残存し、privacyConsentController-r2 はポリフィルをバイト同一で複製しているから。

## 優先度

- 順位: 13/17
- RICE: 2.0（R4 / I1 / C1.0 / E2）
- 根拠: holistic-1005 NN28 と archloop-1006 S6 の残余。fixture seam（「only the fixture generation moves here」）の完結
- 依存: なし

## 背景（file:line 現状）

- 共有 helper は実在: `src/popup/__tests__/helpers/popupDom.ts:99`（setupPopupDom、6 ファイルが使用）
- 残り 4 ファイル:
  - `statusPanel-cleansingFeedback.test.ts:54-60` — STATUS_PANEL_SKELETON に `#reportCleansingFeedbackBtn` / `#reportCleansingFeedbackStatus` が不在（ギャップ）+ `#statusPanel` shell の重複
  - `privacyConsentController.test.ts:92-114` + `privacyConsentController-r2.test.ts:74-96` — ポリフィル + dialog skeleton がバイト同一の 2 複製。共有 polyfillDialogs（:81-97）が ids 引数付きで再利用可能
  - `recordCurrentPage-extra.test.ts:131-140,435-441` — currentPage 要素（#favicon/#pageTitle/#pageUrl/#recordBtn/#tagResultPanel）が skeleton 未対応（`#mainStatus` のみ重複）

## BDD受け入れシナリオ

```gherkin
Scenario: 残り 4 ファイルが共有 scaffold を使う
  Given PopupDomOptions に feedback / consentModal / currentPage が追加されている
  When 4 ファイルの setupDom を setupPopupDom(...) に置き換える
  Then 手作り fixture とバイト同一複製のポリフィルが消える

Scenario: テストの期待値は不変
  Given 既存の 4 テストスイート
  When fixture を共有化する
  Then 期待値・アサーションが従来と同一で green である
```

## 受け入れ基準

- [x] STATUS_PANEL_SKELETON に 2 feedback ID を追加
- [x] DIALOG_SKELETON / polyfillDialogs(ids) に `includeConsentModal`（`privacyConsentModal`）を追加
- [x] currentPage skeleton（#favicon/#pageTitle/#pageUrl/#recordBtn/#tagResultPanel）を追加
- [x] 4 ファイルを setupPopupDom(...) に移行し、r2 のバイト同一 polyfill 複製を削除
- [x] 4 テストスイートが green のまま（期待値不変）
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- unit: 4 テストスイート自体が pin（fixture 置換で期待値を変えない）
- 配置: `src/popup/__tests__/`、実時間待ちは使わない

## 見積もり

2 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する

## 実装記録

- 変更ファイル: `src/popup/__tests__/helpers/popupDom.ts`（feedback / consentModal / currentPage skeleton 追加）/ 残留 4 テストファイルを setupPopupDom 経由に統一
- ゲート: popup 902 tests green / type-check PASS / lint PASS / validate PASS
