# PBI: popup 内 3 dialog に focusTrap を配線

## ユーザーストーリー
キーボード操作の利用者として、popup の確認ダイアログ表示中はフォーカスがダイアログ内に留まってほしい、なぜなら背景にフォーカスが抜けると操作位置を見失い誤操作につながるから

## 優先度
- 順位: 20 / 26
- RICEスコア: 320（Reach=200 / Impact=1 / Confidence=0.8 / Effort=0.5日）
- 根拠: キーボード利用者に限定されるがアクセシビリティ要件（WCAG 2.1）のため Impact は中。配線パターンは既存で半日対応可能。

## BDD受け入れシナリオ
```gherkin
Scenario: 各 dialog 表示中は Tab 移動が dialog 内に留まる
  Given popup で対象 dialog のいずれかを開いた状態
  When  Tab / Shift+Tab を繰り返し押す
  Then  フォーカスが dialog 内の要素を循環し背景に抜けない

Scenario: dialog を閉じるとフォーカスが元の要素に戻る
  Given 対象 dialog を開く前のフォーカス要素がある状態
  When  dialog を閉じる
  Then  フォーカスが開く前の要素に復帰する
```

## 受け入れ基準
- [x] 下記3系統の dialog の表示/非表示に `focusTrapManager.trap` / `release` が配線されている
- [x] Esc 時の既存の閉じる挙動と競合しない（trap の closeCallback に既存 close 処理を渡す）
- [x] 既存の onboardingWizard のトラップ挙動に退行がない

## テスト戦略
- 単体: 各 dialog の show/close を呼び出し、`focusTrapManager.trap` / `release` が呼ばれることをスパイで検証する（`onboardingWizard.test.ts:154,212` の前例）
- 手動: popup で各 dialog を開き、Tab 循環とフォーカス復帰を目視確認する

## 実装アプローチ
`onboardingWizard.ts:157,164` の `focusTrapManager.trap(element, closeCallback)` / `release(id)` パターンを3系統に適用する。各 `showModal()` 直後に trap、`close()` する全経路で release を呼ぶ。trap ID はモジュール単位で保持し二重 trap を避ける。

## 見積もり
2ポイント（0.5日相当：3系統への配線とテスト追加が中心）

## 実装者向け注記
- 確認済み現状: `src/popup/onboardingWizard.ts:3,157,164` のみ `focusTrapManager` 配線済み。未配線は① `src/popup/previewView.ts:75-77`（`confirmationModal` の `showModal`）、② `src/popup/privatePageDialog.ts:24,40`（`private-page-dialog` と `recording-failed-dialog` の2要素・同モジュール）、③ `src/popup/privacyConsentController.ts:146`（`privacyConsentModal` の `showModal`、表示後に `cb?.focus()` のみ）
- パターン: `src/utils/ui/focusTrap.ts` の `FocusTrapManager.trap/release` を使用。close ボタンの分散箇所（例: `privatePageDialog.ts:82-146` の各ハンドラー）では release 漏れに注意
- 調査用コマンド: `rg -n "showModal|focusTrapManager" src/popup --glob '!**/__tests__/**'`

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（ACCESSIBILITY.md への言及があれば）

## 実装メモ（2026-09-05・branch 0905c）
- 完了（commit `fcd13631`、SDD サブエージェント実装）。未配線だった 3 系統ダイアログ（confirmationModal・private/recording-failed・privacyConsentModal）に focusTrapManager を配線（open で trap/close で release・新規 18 tests）。sanitizePreview の ResizeObserver 挙動は不変。実機目視は手動確認項目として残置。
