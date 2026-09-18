# PBI: dashboard → popup 層越境の解消（refactor）

優先度: 台帳 RICE 3.0（Reach 3 / Impact 1 / Confidence 1.0 / Effort 1pt）
backlog: [2026-09-18-00-backlog-holistic-0918c.md](2026-09-18-00-backlog-holistic-0918c.md)（台帳、候補 C3）
依存: なし

## ユーザーストーリー

UI 層の境界を保守する開発者として、dashboard から popup モジュールへの直接 import を解消してほしい、なぜなら escapeHtml の SSOT は utils にあるのに popup の re-export 経由で参照されており、共有ウィザードも popup に置かれたまま両 UI から越境参照されているから。

## 背景（現状と課題）

実測済みの dashboard → popup import は3件:

1. `src/dashboard/markdownTemplateManager.ts`（20行目付近）— `import { escapeHtml } from '../popup/errorUtils.js'`。実体は popup/errorUtils 内の re-export（`export { escapeHtml } from '../utils/htmlEscape.js'`）で、SSOT は `src/utils/htmlEscape.ts`
2. `src/dashboard/settings/customPromptManager.ts`（27行目付近）— 同上
3. `src/dashboard/panels/staticForm/generalSettingsPanel.ts`（27行目付近）— `import { initOnboardingWizard } from '../../../popup/onboardingWizard.js'`。onboardingWizard は utils のみに依存する中立 DOM コンポーネント（実測: import 全部が utils/*）で、popup.ts と dashboard の両方から使用される。`utils/ui/focusTrap.js` が先例の中立配置

対応方針:
- escapeHtml 2件は `../../utils/htmlEscape.js` / `../../../utils/htmlEscape.js` 直参照に変更
- `src/popup/onboardingWizard.ts` を `src/utils/ui/onboardingWizard.ts` へ `git mv` し、popup.ts・generalSettingsPanel.ts・テストの import を更新。テストは移動先に合わせ `src/utils/ui/__tests__/onboardingWizard.test.ts` へ移動（popup.test.ts からの参照がある場合はその import も更新）

対象外: `LAYERS.md` の分類表・lint ルール（utils-layer-boundary）は本 PBI では変更しない（dashboard→popup は同ルールの管轄外であり、規定追加は別議題）。

## BDD受け入れシナリオ

```gherkin
Scenario: dashboard から popup への直接 import がなくなる
  Given escapeHtml 直参照化と onboardingWizard 移動を適用した状態
  When grep で dashboard 配下の popup import を検索する
  Then 該当が0件になる

Scenario: onboardingWizard の挙動が不変である
  Given 移動後の onboardingWizard
  When shouldShowWizard / completeWizard / initOnboardingWizard を呼ぶ
  Then 応答は移動前と同一である
```

## 受け入れ基準

- [x] markdownTemplateManager・customPromptManager が `utils/htmlEscape.js` から escapeHtml を import している
- [x] `src/utils/ui/onboardingWizard.ts` が存在し、旧 `src/popup/onboardingWizard.ts` が無い
- [x] popup.ts・generalSettingsPanel.ts・テストの import が移動後に追従している
- [x] dashboard 配下の popup import が 0 件（grep で機械確認）
- [x] `npm run type-check` が green
- [x] popup・dashboard・onboardingWizard の関連 vitest が green

## テスト戦略

- 移動は git mv による履歴保持 + import 更新のみ。既存テストの期待値は無変更
- onboardingWizard の単体テストを移動先で実行し、popup.test.ts も実行する

## 見積もり

1pt（git mv 1件 + import 更新5ファイル + escapeHtml 2ファイル）。

## 実装ガイド

- 着手時点での確認ポイント: `grep -rn "from '.*popup/" src/dashboard` の全件（本 PBI 作成時に3件を実測）、onboardingWizard.test.ts の import 形式
- onboardingWizard の内容・エクスポート名は一切変更しないこと（移動のみ）
- git 操作・pbi 編集は統合側が行う（ただし onboardingWizard の git mv 自体は本 PBI の作業範囲）
