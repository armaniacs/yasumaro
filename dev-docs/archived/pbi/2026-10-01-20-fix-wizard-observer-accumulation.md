# PBI: onboarding wizard wiring の MutationObserver 蓄積解消

## 優先度・backlog 出所・依存

- 優先度: 中（RICE 8.0 — R 4 / I 1 / C 1.0 / Eff 0.5）
- backlog 出所: [2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md) NN20（順位 13, fix）。バッチB の `generalSettingsPanel` チェーン末尾。
- 依存: NN17（stale mount スナップショット修正）が同一ファイル `src/dashboard/panels/staticForm/generalSettingsPanel.ts` を触るため直列。NN17 完了後に着手する。他候補と非重複。

## ユーザーストーリー

onboarding wizard を再オープンするユーザーとして、何回 wizard を再オープンしても、backdrop 同期のための MutationObserver が 1 個だけに保たれてほしい。クリックのたびに監視インスタンスが積み上がり、同一要素に対する監視が無限に蓄積する状態を避けたい。

## 背景（file:line 付き現状）

- 所在は grep `observeWizard` で確認済み。対象は `src/dashboard/panels/staticForm/generalSettingsPanel.ts`。
- `generalSettingsPanel.ts:228-231` — `syncBackdrop`: `#wizardBackdrop` の display を `#onboardingWizard` の class（`hidden` の有無）に同期する。
- `generalSettingsPanel.ts:233-240` — `observeWizard()`: `#onboardingWizard` と `#wizardBackdrop` が存在するたびに `new MutationObserver(syncBackdrop)` を構築し（`:237`）、`wizardEl` の class 変更を observe する（`:238`）。
- `generalSettingsPanel.ts:241-249` — `reopenWizard()`: `delete wizard.dataset.initialized` → `initOnboardingWizard(true)` → `observeWizard()`（`:247`）→ `syncBackdrop()`。
- `generalSettingsPanel.ts:250-251` — `reopenWizard` は `#reopenWizardBtn` / `#reopenWizardBtnTop` の click に bind されている。
- `disconnect()` はどこからも呼ばれない → `#reopenWizardBtn` / `#reopenWizardBtnTop` をクリックするたびに、同一要素・同一 `attributeFilter` を監視する observer が新しいインスタンスとして蓄積する。`syncBackdrop` 自体は冪等だが、N 回クリックで N 個の生きた observer が残り続ける。

## BDD

### Scenario: N 回クリックで observer は 1 個

- Given generalSettingsPanel が mount 済みで `#onboardingWizard` と `#wizardBackdrop` が存在する
- When `#reopenWizardBtn` を N 回クリックする
- Then 生成された `MutationObserver` は 1 個のみである（2 回目以降は既存インスタンスを再利用する、または再接続前に `disconnect()` する）

### Scenario: class 変更の backdrop 同期は現状どおり

- Given observer が 1 個接続済みである
- When `#onboardingWizard` の class から `hidden` が外れる
- Then `#wizardBackdrop` の display が `block` に同期される（現行の `syncBackdrop` 挙動と同一）

## 実装宣言・受け入れ基準

It must keep behavior: `syncBackdrop` による class → backdrop display 同期の動作は現状どおりであること。変更は observer インスタンスの生成・接続の管理方法に限り、`reopenWizard` の他の処理（`dataset.initialized` の削除、`initOnboardingWizard(true)` 呼び出し）と UI 表示は不変であること。

- [x] `#reopenWizardBtn` / `#reopenWizardBtnTop` を N 回クリックしても、生成される `MutationObserver` は 1 個である
- [x] class 変更 → `#wizardBackdrop` display 同期の動作は現状どおり
- [x] `mount()` が再実行されても蓄積しない（observer は 1 回だけ生成する）
- [x] 既存テスト green（`npm run validate`）

## テスト戦略

- ユニットテスト（Vitest + jsdom、`src/dashboard/panels/staticForm/__tests__/generalSettingsPanel.test.ts` / `generalSettingsPanel-bLayout.test.ts` の既存 `vi.mock` パターンに倣う）:
  - グローバル `MutationObserver` を生成回数を数える mock に差し替え、`#reopenWizardBtn` を N 回クリックして生成回数が 1 であることを検証する
  - click 完了は `dispatchEvent` / handler の await で待ち、リアルタイム待ちを入れない（[TEST_RULE](../dev-docs/TEST_RULE.md)）
- regression ゲート: `generalSettingsPanel.test.ts`, `generalSettingsPanel-bLayout.test.ts`, `src/dashboard/__tests__/dashboardLegacyPanelFactories.test.ts`
- 定義済み DoD に従い、`npx vitest run <file> --repeats=20` で flake がないことを確認する

## 実装内容

1. observer を 1 つにする。推奨案（案A）: module スコープ（`generalSettingsPanel.ts:48` 付近の `panelContainer` 同層）で 1 回だけ `new MutationObserver(syncBackdrop)` を生成し、`observeWizard()` は要素が存在する場合に既存インスタンスの `observe(wizardEl, { attributes: true, attributeFilter: ['class'] })` を呼ぶ。同一 observer・同一 target に対する再 `observe` は登録の上書きであり、蓄積しない。
2. 代替案（案B）: 接続前に既存 observer を `disconnect()` してから新規生成する。いずれの案でも「生成回数 = 1」を満たすこと。
3. `syncBackdrop`（`:228-231`）と `reopenWizard`（`:241-249`）の他の処理は不変。
4. NN17 完了後、同一ファイル `src/dashboard/panels/staticForm/generalSettingsPanel.ts` へ着手する（直列依存）。変更はこの 1 ファイルとそのテストに留める。

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] observer 生成回数を検証するユニットテストが追加され、`npx vitest run <file> --repeats=20` で flake なし
- [x] `npm run validate`（type-check + test）が green
- [ ] `git diff` が `src/dashboard/panels/staticForm/generalSettingsPanel.ts` とそのテストのみに留まっている
- [x] コードコメントは非自明な WHY のみ（CLAUDE.md 規約）

## 実装記録（2026-10-02）

### 変更点

案A（module スコープで 1 回だけ生成して再利用）を採用。

- `src/dashboard/panels/staticForm/generalSettingsPanel.ts`
  - `syncBackdrop` を module スコープへ hoist し、`syncWizardBackdrop` に改名。本文（`#wizardBackdrop` の display を `#onboardingWizard` の `hidden` class に同期する 3 行）は変更なし。observer を module スコープに置くには callback が module スコープに必要だったため。
  - module スコープに `wizardClassObserver` / `wizardClassObserverTarget` と、observer 設定定数 `WIZARD_CLASS_OBSERVER_INIT`（`{ attributes: true, attributeFilter: ['class'] }`）を追加。
  - `observeWizardClasses(wizardEl)` を新設。`wizardClassObserverTarget !== wizardEl` のときだけ既存 observer を `disconnect()` して target を差し替え、observer 自体が無いときだけ `new MutationObserver(syncWizardBackdrop)` する。つまり **生成は 1 回**、`disconnect()` は対象要素の同一性が変わったときだけ走る。
  - `reopenWizard()` 内のローカル `syncBackdrop` 定義を削除し、`observeWizard()` は `observeWizardClasses(wizardEl)` を呼ぶだけになった。`delete wizard.dataset.initialized` → `initOnboardingWizard(true)` → observe → 同期、という `reopenWizard` の他処理は不変。
- `disconnect()` による全破棄を避けているのは、同一要素への再 `observe` が登録の上書きであり、切断が不要な場合に不要な副作用（observable の作り直し）を起こさないため。

### 追加したテスト

- `src/dashboard/panels/staticForm/__tests__/generalSettingsPanel-wizardObserver.test.ts`（新規）— グローバル `MutationObserver` の生成回数を数える mock に差し替え、`#reopenWizardBtn` を N 回クリックして生成回数が 1 であること、さらに class 変更で backdrop の display が同期されることを確認。`waitForMock` で完了を待ち、実時間待ちを入れていない。
- `npx vitest run <batch-B の 11 ファイル> --repeats=20` → 11 files / 301 tests 全回 green。`npm run validate` も green。

### 逸脱・未達

- **`git diff` の範囲（未達）。** NN20 自身の変更は `generalSettingsPanel.ts` と `generalSettingsPanel-wizardObserver.test.ts` の 2 ファイルに限定されているが、同一ファイルを NN09・NN17 と共有するためコミット 1 に 3 PBI 分が同梱された。
