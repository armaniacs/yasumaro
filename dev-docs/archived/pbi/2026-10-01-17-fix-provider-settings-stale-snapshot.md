# PBI: generalSettingsPanel の stale mount スナップショット修正

## 優先度・backlog 出所・依存

- 優先度: 中（RICE 10.0 — R 5 / I 2 / C 1.0 / Eff 1.0）
- backlog 出所: [2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md) NN17（順位 10, fix）。バッチB の `generalSettingsPanel` チェーン先頭。
- 依存: NN20（MutationObserver 蓄積解消）が同一ファイル `src/dashboard/panels/staticForm/generalSettingsPanel.ts` を触るため直列。本 PBI → NN20 の順で着手する。他のバッチB 候補（NN09 の `generalSettingsPanel` 部分、NN12, NN19）とはファイル非重複。

## ユーザーストーリー

dashboard の設定パネルを使うユーザーとして、パネルの再読込や別経路（popup・onboarding wizard・他パネル）による settings 更新の後でも、A↔B layout 切替時に自分が設定した最新の provider 設定がフォームに反映されてほしい。mount 時の古いスナップショットから入力が再構築され、設定が巻き戻ったように見える状態を避けたい。

## 背景（file:line 付き現状）

- `src/dashboard/panels/staticForm/generalSettingsPanel.ts:54` — mount 内で `const settings = await settingsRepository.getAll()` を取得し、以降は mount closure で保持する。
- この closure 変数が layout toggle path で使用される:
  - `generalSettingsPanel.ts:189-190` — B priority view 構築時、DOM 収集（`collectProviderPrioritySlots()`）が空だった場合のフォールバック `settings[StorageKeys.AI_PROVIDER_PRIORITY_LIST]`
  - `generalSettingsPanel.ts:192` — `createBPriorityListView(bListContainer, existingSlots, settings)`（B priority view 本体）
  - `generalSettingsPanel.ts:200` — accordion populate `loadSettingsToInputs(bAccordionContainer, settings, GENERAL_SETTINGS_SCHEMA)`
  - `generalSettingsPanel.ts:209` — B→A 後の A reload `loadSettingsToInputs(container, settings, GENERAL_SETTINGS_SCHEMA)`
- 一方、`refresh()`（`generalSettingsPanel.ts:336-343`）は `getAll()` を新ローカルに再読込して `loadSettingsToInputs` に渡すのみで、mount closure の `settings` を更新しない。
- 結果: `refresh()` や外部 settings 書き込みの後、A↔B 切替が stale スナップショットから入力を再構築する。初回 mount 後に settings が変わっていなければ影響しないが、refresh 後・外部書き込み後の切替は必ず旧値になる。
- このバグクラスは本来 `src/dashboard/settingsPipeline.ts:218-237` の empty-overwrite ガードが防ぐ対象と同型の UI-desync である。同ガードのコメント（`settingsPipeline.ts:220-221`）は「e.g. the B-layout accordion regression」と明記しており、実際起きたクラス。ただしガードは provider connection フィールドの空値上書きのみを止め、stale 値での再構築までは防げない。

## BDD

### Scenario: refresh 後の A→B 切替が最新 settings から再構築する

- Given generalSettingsPanel が mount 済みで A layout を表示している
- When 外部 writer が provider 設定（例: `PROVIDER_BASE_URL`, `AI_PROVIDER_PRIORITY_LIST`）を更新する
- And パネルの `refresh()` が呼ばれる
- And ユーザーが layout toggle で B に切り替える
- Then B priority view と accordion 入力が更新後の settings から構築される（mount 時のスナップショットからではない）

### Scenario: B→A 切替で最新値が復元される

- Given B layout 表示中に外部 writer が provider 接続キーを更新した
- When ユーザーが layout toggle で A に戻す
- Then `#providerSettingsMount` の入力が更新後の値で再構築され、旧スナップショットの値に巻き戻らない

## 実装宣言・受け入れ基準

It must keep behavior: 成功経路の UI 挙動は不変 — 初回 mount・layout toggle・保存フローの表示と入力の組立は現行と同一で、「stale からの再構築」が「最新からの再構築」に置き換わるだけであること。

- [x] `refresh()` 後の A↔B 切替が最新 settings から再構築する
- [x] layout toggle path（`generalSettingsPanel.ts:189-192`, `:200`, `:209`）が mount closure を参照せず、常に最新を読む
- [x] closure 更新漏れが構造的に起こらない形に統一されている（mount と `refresh()` が同じ module スコープの単一フィールドへ代入する）
- [x] 成功経路の UI 挙動は不変（初回 mount・トグル・保存フローの見た目は変わらない）
- [x] 既存テスト green（`npm run validate`）
- [x] NN20 は本 PBI 完了後に同一ファイルへ着手する（直列順守）

## テスト戦略

- ユニットテスト（Vitest + jsdom、`src/dashboard/panels/staticForm/__tests__/generalSettingsPanel.test.ts` および `generalSettingsPanel-bLayout.test.ts` の既存 `vi.mock` パターンに倣う）:
  - mount 後に `settingsRepository.getAll()` の返り値を差し替え、`refresh()` を呼び、layout toggle を実行して、入力が差し替え後の値から再構築されることを検証する
  - B build の stored フォールバック（`generalSettingsPanel.ts:188-191`）が新 snapshot を参照することを検証する
  - リアルタイム待ちを入れない。完了シグナルは Promise / イベントで待つ（[TEST_RULE](../dev-docs/TEST_RULE.md) § 実時間待ちの禁止と代替手段）
- regression ゲート: `generalSettingsPanel.test.ts`, `generalSettingsPanel-bLayout.test.ts`, `src/dashboard/__tests__/settingsPipeline.test.ts`, `src/dashboard/__tests__/aiProviderLayoutManager.test.ts`
- 定義済み DoD に従い、修正テストは `npx vitest run <file> --repeats=20` で flake がないことを確認する

## 実装内容

1. `src/dashboard/panels/staticForm/generalSettingsPanel.ts` の module スコープ（`panelContainer` と同層、`generalSettingsPanel.ts:48` 付近）に可変フィールドを 1 つ追加する（例: `let mountedSettings: <snapshot 型> | null = null`）。
2. `mount()`（`generalSettingsPanel.ts:54`）の `const settings` を撤去し、module フィールドへ代入する。toggle path（`:189-192`, `:200`, `:209`）はフィールドを読むよう変更する。
3. `refresh()`（`generalSettingsPanel.ts:336-343`）で `getAll()` の結果を同じフィールドへ再代入してから `loadSettingsToInputs` に渡す。
4. フィールドの型は `GENERAL_SETTINGS_SCHEMA` の load 入力と `createBPriorityListView` の第 3 引数が要求する型に合わせる。
5. 変更はこの 1 ファイルとそのテストに留める。`settingsRepository`・`loadSettingsToInputs`・ビュー API（`createBPriorityListView` / `createBProviderAccordionView`）には触れない。

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate`（type-check + test）が green
- [x] 新規ユニットテストが追加され、`npx vitest run <file> --repeats=20` で flake なし
- [ ] `git diff` が `src/dashboard/panels/staticForm/generalSettingsPanel.ts` とそのテストのみに留まっている
- [x] コードコメントは非自明な WHY のみ（CLAUDE.md 規約）
- [ ] NN20 の着手条件（本 PBI 完了）が台帳上で明示されている

## 実装記録（2026-10-02）

### 変更点

- `src/dashboard/panels/staticForm/generalSettingsPanel.ts` — mount 時の `const settings` を、factory closure 内の可変フィールド `currentSettings: Settings` に置き換えた。`mount()` と `refresh()` の両方が `currentSettings = await settingsRepository.getAll()` で上書きし、layout toggle path（B priority view の stored フォールバック・`createBPriorityListView`・accordion populate・B→A 後の A reload）はすべて `currentSettings` を読む。`panelContainer` と同じ closure スコープに置いたので、インスタンスごとに 1 つのスナップショットが共有される。
- `StorageKeys` の import に `type Settings` を追加。旧 :189 にあった二重キャスト（`settings[...] as unknown as typeof existingSlots | undefined`）は削除。`Array.isArray(stored)` がそのまま絞るため閉塞が必要なくなった。
- `settingsRepository`・`loadSettingsToInputs`・ビュー API（`createBPriorityListView` / `createBProviderAccordionView`）には触れていない。

### 追加したテスト

- `src/dashboard/panels/staticForm/__tests__/generalSettingsPanel-bLayout.test.ts` に 66 行追加。mount 後に `settingsRepository.getAll()` の返り値を差し替え、`refresh()` → layout toggle の順で実行して、入力が差し替え後の値から再構築されることを検証する。stored フォールバックが新スナップショットを参照する分岐も対象。
- `npx vitest run <batch-B の 11 ファイル> --repeats=20` → 11 files / 301 tests 全回 green。`npm run validate` も green。

### 逸脱・未達

- **フィールドの位置。** 受け入れ基準 3 と「実装内容」1 は `module スコープ` を指示していたが、実際の `panelContainer` は `createGeneralSettingsPanel()` の closure 内にあり、PBI が挙げた `generalSettingsPanel.ts:48` 付近には存在しない。実装は `panelContainer` の隣（factory closure）に置いた。基準の意図である「mount と `refresh()` が単一フィールドへ代入する」は満たしている。
- **`git diff` の範囲（未達）。** NN17 自身の変更は `generalSettingsPanel.ts` と `generalSettingsPanel-bLayout.test.ts` の 2 ファイルに限定されているが、同一ファイル `generalSettingsPanel.ts` を NN09（purge エラー境界）と NN20（wizard observer）でも触るため、コミット 1 に 3 PBI 分が同梱された。PBI 単位の分割は interactive partial staging を必要とするため行っていない。
- **台帳（未達）。** NN20 の着手条件の台帳への明示は `pbi/00-INDEX.md` への追記を要するため、archive ＆台帳更新のステップに委ねている。
