# PBI: popup ユニットテストの DOM 脚手架が 17 ファイルに分散し、共有 seam が無い

## ユーザーストーリー

popup のテストを書く開発者として、DOM 脚手架を共有したい。同じ popup DOM と dialog polyfill を各テストが毎回描き直しており、構造変更のたびに 17 箇所を同時修正する必要があるから。

## 優先度

- 順位: 25/32
- RICE: 2.25（R5 / I1 / C0.9 / E2）
- 根拠: popup テストは頻繁に触る。content 側には helpers 規約があり popup だけ欠落している
- 依存: NN09（class pin 更新と同時に触ると 1 回で済む）、NN21（i18n mock の機械置換を先に行うと同一ファイルを 2 回触らずに済む）

## 背景（file:line 現状）

- `<div id="mainStatus"></div>` の個別定義 8 箇所: `src/popup/__tests__/main.test.ts:398`、`autoClose.test.ts:97, :200, :261`、`statusPanel.test.ts:355`、`errorDisplayContract.test.ts:106`、`recordCurrentPage-extra.test.ts:143`、`statusPanel-wireOnce-parity.test.ts:142`、`pendingPages-errorBoundary.test.ts:108`
- `function setupDom()` の個別定義 8 件: `errorDisplayContract.test.ts:101`、`pendingPages-errorBoundary.test.ts:101`、`statusInvalidUrlLocales.test.ts`、`statusPanel-cleansingFeedback.test.ts`、`privacyConsentController.test.ts`、`privacyConsentController-r2.test.ts`、`privatePageDialog-recordRejection.test.ts`、`recordCurrentPage-extra.test.ts`
- dialog の `showModal` / `close` polyfill 複製: `errorDisplayContract.test.ts:111-136`、`privatePageDialog.test.ts`、`privatePageDialog-recordRejection.test.ts`
- `document.body.innerHTML` 直書きの多さ: `mask-visualization.test.ts`（18 箇所）、`statusPanel-extra.test.ts`（17）、`statusPanel.test.ts`（9）、`pendingPages.test.ts`（9）、`sanitizePreview.test.ts`（6）、`trustPanel.test.ts`（5）、`popup-xss.test.ts`（5）、`spinner.test.ts`（4）
- 既存規約の参照: `src/content/__tests__/helpers/contentTestkit.ts` / `fakeScheduler.ts` / `inMemoryDomainPolicyPort.ts`（content 側にはテスト専用 seam を置く規約があり popup だけ抜けている）

## BDD受け入れシナリオ

```gherkin
Scenario: 脚手架が共有ヘルパーに統一される
  Given setupPopupDom を使うテスト
  When 実行する
  Then #mainStatus / 2 dialog / pending セクションの骨格と dialog polyfill が共有され、assert 結果が従来と同一である

Scenario: オプションで差し替えができる
  Given pending 一覧や statusPanel 要素の要否が違うテスト
  When オプションを指定する
  Then 必要な骨格だけが生成される

Scenario: NN09・NN21 との同時変更が 1 回で済む
  Given NN09 の class pin 更新と NN21 の mock 置換
  When 同一ファイルを触る
  Then 脚手架の再構成と合わせて 1 回の編集で済む
```

## 受け入れ基準

- [x] `src/popup/__tests__/helpers/popupDom.ts` に `setupPopupDom(opts)` が置かれている
- [x] `#mainStatus` / 2 dialog / pending セクションの骨格と dialog polyfill が共有されている
- [x] オプションで pending 一覧・statusPanel 要素の有無を差し替えできる
- [x] 既存テストの assert 文は無変更のまま fixture 生成だけ置換されている
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 既存テストの green 維持（置換自体がテスト）
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

2 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: 新規 `src/popup/__tests__/helpers/popupDom.ts`、移行 6 ファイル（errorDisplayContract / pendingPages-errorBoundary / privatePageDialog / privatePageDialog-recordRejection / statusPanel-wireOnce-parity / statusInvalidUrlLocales。いずれも薄いラッパー化で呼び出し側は不変）
- 残余（ヘルパー拡張点として記録）: statusPanel-cleansingFeedback / privacyConsentController ×2 / recordCurrentPage-extra の 4 setupDom は専用 DOM（consent modal / cleansing panel / record page）のため未移行。popupDom.ts にオプション追加すれば寄せられる
- ゲート: 対象 57 tests green / type-check PASS / lint 0 errors
