# PBI: 既定値の一本化と小さな永続化の seam 統一

種別: refactor
状態: 実装済み（2026-09-28）

上流: 大局的コードレビュー 2026-09-28 テーマ2の一部。PBI 24（trigger 読み修正）の姉妹 PBI で、残りの分散を解消する。

## ユーザーストーリー

記録条件の既定値を変える開発者として、1箇所の変更で content・dashboard・background の全フォールバックに反映される状態を目指す。

## 優先度

- 順位: 5 / 7
- RICE スコア: 5.0（Reach=5 / Impact=1 / Confidence=100% / Effort=1.0）
- 根拠: PBI 24 が実害側を閉じるため、こちらは波及コストの削減。確実にできる範囲

## 現状と問題（file:line 証拠付き）

- 既定値の分散: `src/content/visitGating.ts:151-152` と `src/content/pageState.ts:23-24` が `DEFAULT_MIN_VISIT_DURATION = 5` / `DEFAULT_MIN_SCROLL_DEPTH = 50` を独立宣言し、`src/dashboard/recordingConditionsSettings.ts:49-50` と `src/background/recordingTriggerManager.ts:127-128` がリテラル `?? 5` / `?? 50` でフォールバックする。閾値変更が4箇所に飛び火する
- `src/utils/permissionManager.ts` の同一ファイル内二重 seam: 読み `getDeniedDomains()` は直叩き（`:86`）、書き `updateDeniedDomains()` は `withOptimisticLock`（`:102`）
- `src/dashboard/panels/staticForm/privacySettingsPanel.ts:83` の `chrome.storage.local.clear()` は破壊操作でありながら Repository も maintenance 経路も経由しない。version カウンタとの競合時の挙動が未定義

## BDD 受け入れシナリオ

```gherkin
Scenario: 既定値変更が全フォールバックに反映される
  Given 既定値を 1 箇所で変更する
  When content・dashboard・background の各フォールバックを読む
  Then すべて新しい既定値になる

Scenario: 全削除が定義済み経路を通る
  Given 全データ削除を実行する
  When 削除が完了する
  Then Repository または maintenance 経路を経由し、version カウンタとの整合条件が文書化されている
```

## 受け入れ基準

- [x] 既定値 4 箇所を `defaults.ts`（または content 制約下で読める小モジュール）の定数に一本化する
- [x] `permissionManager.ts` の読み書きを同一 seam（`withOptimisticLock` または Repository）に統一する
- [x] `privacySettingsPanel.ts:83` の `clear()` を定義済み経路（Repository / `storageMaintenance.ts`）に寄せ、競合時の挙動をコメントで明示する

## テスト戦略

- 単体: 既定値の一意性 pin（定数と各フォールバックの一致）。permissionManager の read-after-write テスト
- 既存 pin: 関連テストが green のままであること

## 見積もり

1.0 SP

## Definition of Done

- [x] BDD シナリオに対応するテストがパスする
- [x] `npm run validate` が通る
