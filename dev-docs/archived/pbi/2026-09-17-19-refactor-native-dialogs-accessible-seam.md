# PBI: ネイティブ confirm()/alert() の残存 11 箇所（実測・cspSettings の window.confirm を追補）をアクセシブル dialog seam に統一する

優先度: 順位 3 / 3（RICE: 2.4 = Reach 3 / Impact 1 / Confidence 0.8 / Effort 1 pt）
backlog: [2026-09-17-00-backlog-archloop-0917.md](2026-09-17-00-backlog-archloop-0917.md)（台帳）
依存: なし

## ユーザーストーリー

キーボード／スクリーンリーダーを使うユーザーとして、拡張機能内のすべての確認・警告ダイアログが一貫した操作系（focus trap、Esc、フォーカス復帰）で動いてほしい。なぜなら DESIGN_SPECIFICATIONS §4.1 はモーダルに focus trap と Esc を必須としているが、ネイティブ `confirm()/alert()` が 11 箇所（実測）に残り、UI 語彙が 2 分裂しているから。

## 背景（現状と課題）

残存箇所（2026-09-17 実測）:

- `src/dashboard/tagsPanel.ts:114, 122, 131, 193` — `alert()` ×4
- `src/dashboard/settings/customPromptManager.ts:377` — `confirm()`
- `src/dashboard/markdownTemplateManager.ts:204` — `confirm()`
- `src/dashboard/settings/settingsExportImportUiCore.ts:180` — `confirm()`
- `src/popup/pendingPages.ts:131` — `confirm()`
- `src/popup/privacyConsentController.ts:166` — `alert()`
- `src/utils/settingsExportImport.ts:480` — `alert()`（utils 層からの UI 直呼び・seam 逆漏洩）

プロジェクトには既に deep module が在る: `focusTrapManager`（`src/utils/ui/focusTrap.ts`）、models-dev-dialog、archive edit modal（2026-09-06-07 で `window.prompt` を置換済み）。新設ではなく移行のみ。

## BDD受け入れシナリオ

```gherkin
Scenario: ダッシュボードの確認ダイアログが focus trap を持つ
  Given tagsPanel のカテゴリ重複警告を表示する
  When ダイアログが開く
  Then Tab がダイアログ内を循環し、Esc で閉じ、起動要素へフォーカスが戻る

Scenario: utils 層から UI が呼ばれない
  Given settingsExportImport の import 拒否経路を確認する
  Then alert() は呼ばれず、拒否結果は戻り値で呼び出し側 UI に伝わる

Scenario: 既存文言とテストは不変
  Given 置換対象 11 箇所の i18n キー
  When ダイアログをアクセシブル版に置換する
  Then メッセージ本文・キーは変らず、check-i18n が PASS する
```

## 受け入れ基準

- [x] 11 箇所のネイティブダイアログ（tagsPanel ×4、customPromptManager、markdownTemplateManager、cspSettings、pendingPages、privacyConsentController、settingsExportImportUiCore、settingsExportImport）をAccessible dialog seam に置換（showConfirmDialog を utils/ui に昇格し showAlertDialog を追加）
- [x] `src/utils/settingsExportImport.ts` から `alert()` と UI 判断を除去し、拒否を戻り値/例外で伝える
- [x] i18n キー・文言は既存のものを維持（新キー不要）
- [x] check-i18n PASS・既存 dashboard/popup テスト green

## テスト戦略

- 単体: 置換した各パネルの既存テストを新契約（dialog seam 呼び出し）に追従
- 単体: focus trap / Esc / フォーカス復帰は既存 focusTrap テスト資産を再利用
- 回帰: check-i18n + dashboard/popup 全テスト

## 見積もり

1 pt（🟢低）— 既存 seam への移行のみ。tagsPanel の alert ×4 が最大の作業塊。

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] `grep -rn "\bconfirm(\|\balert(" src/dashboard src/popup src/utils` の production 経路が 0 件
- [x] コードレビュー完了
- [x] ドキュメント更新不要（DESIGN_SPEC §4.1 は既存規定の遵守）
