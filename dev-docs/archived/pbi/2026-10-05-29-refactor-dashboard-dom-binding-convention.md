# PBI: 「import 時モジュールスコープで DOM を捕捉する」旧規約が残存し、domainFilter では死んだレガシー tab UI が二重実装になっている

## ユーザーストーリー

dashboard の保守担当者として、DOM バインディングの規約を新規約へ寄せたい。旧規約は import 時に DOM が無ければ全バインドが恒久的に null になり無音で何も起きないうえ、死んだタブ機構が現行実装と二重に見えるから。

## 優先度

- 順位: 32/32
- RICE: 1.33（R4 / I1 / C1.0 / E3）
- 根拠: 死コードの削除と規約統一。規模 L。NN18 で destroy 到達路が決まっていると新規約の `destroy()` が実際に生きる
- 依存: NN18

## 背景（file:line 現状）

- import 時にモジュールスコープで `getElementById` する旧規約: `src/dashboard/exportImport.ts:27-38`（12 バインド）、`src/dashboard/settings/domainFilter.ts:20-45`（26 バインド）、`src/dashboard/settings/privacySettings.ts:19-20`、`src/dashboard/main.ts:15`
- 新規約（`createXxx()` クロージャ + `init()` 内解決 + `teardown` 配列）: `src/dashboard/recordingConditionsSettings.ts:60-100, :307-313, :341-349`、`src/dashboard/markdownTemplateManager.ts:431-460, :470-478`、`src/dashboard/settings/trustSettings.ts:678-682, :712-736`、`src/dashboard/settings/customPromptManager.ts:605-631`
- 死コード（統合側が `entrypoints/options/index.html` で id 出現ゼロを grep 確認済み。generalTab / domainTab / promptTab / privacyTab / generalPanel / domainPanel / promptPanel / privacyPanel / tabList すべて 0 件）:
  - `domainFilter.ts:20-28`: 存在しない id 8 個の捕捉
  - `:50-74`: 4 つの死んだタブリスナ
  - `:99-133`: `#tabList` キーボードナビ（存在せず）
  - `:139-189`: `showTab()`（唯一の呼び出し元が死んだリスナ）。active/aria-selected/inert/focus を扱い、`DashboardBootstrapper.#setActiveTab`（`src/dashboard/panels/DashboardBootstrapper.ts:53-62`、クリック配線 `:144-170`）と**同じ役割の別実装**
  - `:195-198` / `:233-237`: `domainTagArea` 恒在による早期 return、else 分岐は到達不能
- 影響: 旧規約はモジュール import 時点で DOM が無ければ全バインドが恒久的に null になり、`?.` ガードによって無音で何も起きない（テストでフィクスチャを後から入れた場合がその典型）。読み手は「どれが生きているか」を実行しなければ判別できない

## BDD受け入れシナリオ

```gherkin
Scenario: 死んだタブ機構が削除される
  Given 整理後の domainFilter.ts
  When タブリスナ・キーボードナビ・showTab を探す
  Then 存在せず、Bootstrapper の #setActiveTab だけが残る

Scenario: 旧規約が新規約に寄る
  Given exportImport / privacySettings / domainFilter
  When createXxx() + init() の形に寄せる
  Then 解決は init 内で行われ、destroy() で teardown される

Scenario: live 部分の挙動が変わらない
  Given filter ラジオ / uBlock 切替 / 保存 / loadDomainSettings / saveDomainLists / toggleFormatUI
  When 操作する
  Then 従来と同一に動作する
```

## 受け入れ基準

- [x] 旧規約 3 ファイル（exportImport / privacySettings / domainFilter）が `createXxx()` + `init()` に寄っている
- [x] domainFilter の死んだタブ機構（上記 5 ブロック）が削除されている
- [x] 残すのは filter ラジオ（:77-81）/ uBlock 切替（:84-87）/ 保存（:95-97）/ `loadDomainSettings` / `saveDomainLists` / `toggleFormatUI` の live 部分
- [x] `#domainTagArea` 存在時の legacy 非表示は HTML の `hidden` 属性側に残る
- [x] `loadDomainSettings()` の null ガードと `domainTagArea` 判定は live 部分にそのまま維持される
- [x] 外部挙動不変
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 既存テストが green。削除した死コードを参照するテストがあれば整理
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

3 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/dashboard/settings/domainFilter.ts`（create + init 内解決 + teardown。死んだタブ機構 5 ブロックを削除。`ensureDom()` で未 init の直接呼び出しにも対応）、`src/dashboard/settings/privacySettings.ts` / `src/dashboard/exportImport.ts`（同形式へ移行。公開シグネチャ維持 + destroy 追加）、`src/dashboard/main.ts`（sidebar のモジュール束縛を廃止）、`src/dashboard/settings/__tests__/domainFilter.test.ts`（死コード参照の 2 ブロック除去）
- ゲート: 対象 6 ファイル 133 tests green / type-check PASS / lint 0 errors
