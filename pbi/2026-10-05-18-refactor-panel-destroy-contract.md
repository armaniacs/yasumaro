# PBI: `PanelLifecycle.destroy` は一度も呼ばれず、`deactivate` は実装者がゼロ — 契約と実装が逆向きにずれている

## ユーザーストーリー

パネルを追加する開発者として、ライフサイクル契約を実態に合わせたい。「リスナ解除・onChanged 解除・timer クリア」の掃除経路が全部手書きされながら本番到達不能で、テストが緑のまま「リーク対策済み」という誤った確信を与えるから。

## 優先度

- 順位: 20/32
- RICE: 3.2（R4 / I2 / C0.8 / E2）
- 根拠: 契約を実態に合わせるか実態を契約に合わせるかの設計裁定が残る。NN29 の先行（destroy 到達路の確定）
- 依存: なし（NN29 の先行）

## 背景（file:line 現状）

- `src/dashboard/panels/types.ts:6-8`: 「activate/deactivate/destroy are optional hooks that the registry calls at...」と説明。`:16` に `activate?`、`:18` に `deactivate?`、`:19` に `destroy?`
- `src/dashboard/panels/NavigationRegistry.ts:64`: `current?.deactivate?.()` が deactivate の唯一の呼び出し。`:58, :110` は `init ?? activate`
- **`destroy` の呼び出しは NavigationRegistry.ts の 137 行全体に存在しない**（統合側 grep で確認）
- destroy 実装 13 箇所: `asyncData/asyncDataPanelLifecycle.ts:101`、`asyncData/sqliteHistoryPanel.ts:478-497`、`asyncData/domainSearchPanel.ts:43`、`asyncData/tagClusterPanel.ts:160`、`asyncData/tagClusterTimeSliderPanel.ts:517`、`asyncData/researchSessionsPanel.ts:381`、`asyncData/timeHeatmapPanel.ts:136`、`asyncData/tagFrequencyTimelinePanel.ts:474`、`asyncData/wordClusterPanel.ts:238`、`asyncData/tagCooccurrenceTablePanel.ts:288`、`asyncData/revisitInsightsPanel.ts:418`、`asyncData/domainAnalysisPanel.ts:233`、`diagnostic/diagnosticsPanel.ts:685`
- 委譲型 destroy の 0 呼び出し: `src/dashboard/recordingConditionsSettings.ts:347`、`src/dashboard/settings/customPromptManager.ts:630`、`src/dashboard/settings/trustSettings.ts:734`、`src/dashboard/markdownTemplateManager.ts:476`（`sharedManager.destroy()` / `sharedController.destroy()` を呼ぶが、この関数自体が誰からも呼ばれない）
- deactivate の production 実装はゼロ（`src/dashboard` 非テストを `deactivate` で走査し types.ts / NavigationRegistry / コメントのみ）
- static-form は destroy を構造的に出せない: `src/dashboard/panels/staticForm/staticPanelAdapter.ts:36-45`（mount/init/load のみ返す）
- テストは逆方向を固定: `src/dashboard/panels/__tests__/NavigationRegistry.test.ts:15, :54-72, :125-126`
- 影響: リスナー解除・`chrome.storage.onChanged` 解除・debounce timer クリア・`AbortController` abort・period filter 解放・`model.onNavigateOut()` が本番未到達。新規パネル作者は `deactivate` と `destroy` のどちらを書くべきか判断できない

## BDD受け入れシナリオ

```gherkin
Scenario: destroy が実際に呼ばれる（案A）
  Given ページ離脱（pagehide）が発生する
  When main.ts から destroyAll が呼ばれる
  Then mountedPanels の全 panel.destroy が呼ばれ、types.ts の説明と一致する

Scenario: 契約が実態と一致する（案B）
  Given PanelLifecycle の定義を読む
  When deactivate の扱いを確認する
  Then deactivate が削除されるか destroy に一本化され、StaticPanelSpec にも destroy がある

Scenario: 既存の掃除ロジックが生きる
  Given 各 destroy 内の try/catch・null ガード
  When 案A・案B のいずれかを実施する
  Then 掃除ロジックはそのまま各 destroy 内に残り、表示遷移の挙動は変わらない
```

## 受け入れ基準

- [x] 案A・案B のいずれか 1 つに裁定され、実装されている（案A: `NavigationRegistry` に `destroyAll()` を追加し `pagehide` で main.ts から 1 回だけ呼ぶ + types.ts:7 の説明を「destroy はページ離脱時のみ」に修正。案B: `deactivate` を PanelLifecycle と registry:64 から削除し、destroy に「離脱フック」としての位置づけを types.ts に明記 + StaticPanelSpec に destroy を追加）
- [x] どちらも外部挙動不変（表示遷移は変わらず、ページ離脱時のみ掃除が走る）
- [x] 既存の try/catch・null ガードは各 destroy 内に残り、`registryContext` / `staticPanelAdapter` の try/catch 範囲は不変
- [x] NavigationRegistry のテストが裁定後の契約を固定する
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 裁定後の契約テスト（destroyAll 呼び出し or deactivate 削除の pin）
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

2 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 裁定: 案A（案B は 13 箇所の destroy を到達不能のまま残すため不採用）
- 変更ファイル: `src/dashboard/panels/NavigationRegistry.ts`（`destroyAll()` 追加。遷移経路は不変）、`src/dashboard/panels/types.ts`（コメント修正）、`src/dashboard/main.ts`（`pagehide` で 1 回だけ呼ぶ）、`src/dashboard/panels/__tests__/NavigationRegistry.test.ts`（契約 3 件追加）
- ゲート: 対象 21 tests green / type-check PASS / lint 0 errors
