# PBI: Panel catalog の単一ソース化 — sidebar / registry / deep-link の二重管理解消

## ユーザーストーリー
options ダッシュボードにパネルを追加・改名する開発者として、「どのパネルが存在するか」が HTML（sidebar ボタン 17 個・data-panel 33 ヒット）・TS descriptor 20 件（main.ts 直登録 11 + staticPanels.ts 9）・`sectionPanelMap`（dashboard.ts）・NavigationRegistry の 4 箇所に分散しているのを、パネルカタログ 1 テーブルから派生させたい、なぜならパネル追加・改名が HTML + main.ts/staticPanels.ts + map の 3-4 点更新になり、`DashboardBootstrapper.registerPanels` は registry.register のループだけの pass-through で、deep-link（`?tab=`）の追加も 3 点同期が必要だから

## 優先度
- �順位: 06 / 6（本ラウンド）
- RICEスコア: **5.3**（Reach=2 / Impact=1 / Confidence=80% / Effort=0.3人週）
- 根拠: パネル追加は頻発しないが、改名・並び替え・i18n キー対応のたびに 4 箇所の横断修正が発生している。registryContext の迂回クリック（`privacySettingsPanel.ts:92` の `document.querySelector('.sidebar-nav-btn[...]')?.click()`）という seam 迂回が実在し、`getRegistry().navigate()` への寄せと合わせて小さく解ける。

## 背景 / なぜなぜ分析サマリ
| 疑問 | 原因 → 示唆 → 解 |
|------|------------------|
| なぜ 4 箇所に分散するのか | WXT 移行（ADR 2026-04-19）と panel lifecycle wave（ADR 2026-08-20）の過程で、HTML 静的 sidebar → TS registry → deep-link map が段階的に積み上がり、統合タイミングを逃した |
| なぜ Bootstrapper が pass-through なのか | `registerPanels` は `registry.register` の for ループだけ（interface が implementation と同等の複雑さ = 浅い）。存在価値はカタログと一体になったときに生まれる |
| なぜ迂回クリックがあるのか | `registryContext` のグローバル `tryGetRegistry` があっても、呼び出し側から registry が見えない位置（panel 内部）で DOM 直接操作に落ちた。navigation 意図を registry に明示的に寄せる API が近くにあるのに使われていない |
| なぜ今か | 2026-09-07 round 2 診断で Strong 判定。PBI 23（sqliteHistoryPanel）と触るファイルが完全に非重複で、並列バッチに入れられる |
| 解の粒度 | `{ id, sidebarLabel, sidebarIcon, section }` のカタログ 1 テーブルから sidebar（HTML はビルド時検証 or 実行時生成）・registry 登録・deep-link 解決を派生。迂回クリックを `registry.navigate()` に寄せる |

## BDD受け入れシナリオ

### Scenario: パネルカタログから registry 登録が派生する
  Given カタログ（`panelCatalog.ts` 相当）に 20 パネルが宣言されている
  When `main.ts` の配線を読む
  Then `registerPanels` への個別直書き 11 件 + `STATIC_FORM_PANELS` 9 件の二重管理が解消され、カタログ（またはカタログを参照する descriptor 定義）1 箇所から登録される

### Scenario: sidebar ボタンと HTML が同期している
  Given HTML の sidebar ボタン 17 個（`index.html:25-165` の `data-panel`）
  When カタログと HTML を突き合わせる
  Then 「HTML 静的 sidebar を維持する場合、カタログ ↔ HTML の対応をテストで検証する」か「sidebar をカタログから実行時生成する」のどちらかが採用され、不整合が検出可能になっている

### Scenario: deep-link が sectionPanelMap を経由しない
  Given `?tab=obsidian` のような deep-link
  When `resolveInitialPanelId` / `applySectionDeepLink` が呼ばれる
  Then section → panel の解決がカタログの `section` 列から派生され、`dashboard.ts:41-44` の手書き map が消えている

### Scenario: 迂回クリックが registry 経由になる
  Given `privacySettingsPanel.ts:92` の export-logs 遷移
  When 遷移を実行する
  Then `getRegistry().navigate('panel-export-logs')` 等の registry API 経由になり、DOM クリック シミュレートが消える

## 受け入れ基準
- [x] パネルカタログ（id / sidebarLabel / sidebarIcon / section / i18n キー）が 1 箇所に定義される（`src/dashboard/panels/panelCatalog.ts`、19件。実測値はPBI記載20件と1件差異→下記注記）
- [x] `main.ts` の 11 直登録 + `staticPanels.ts` 9 件の二重管理が解消される（descriptor 定義がカタログ参照 or カタログと統合）（実測で直登録は10件。`registerCatalog(createPanelById)` 1行登録＋型レベル網羅に統合）
- [x] `dashboard.ts` の `sectionPanelMap`（:41-44）と `applySectionDeepLink`（:60-72）がカタログ派生になり、手書き map が消える（`resolvePanelIdForTab/ForSection` 派生。要素固有スクロールのみ残し既知判定をカタログ由来に）
- [x] `DashboardBootstrapper.registerPanels` が pass-through のままでよいか再評価され、カタログと統合 or 明確な役割が残る（実装メモに記録）（`registerCatalog` を正規経路化し登録順序を所有。`registerPanels` はテスト互換APIとして残す。記録: whywhy/pbi25-catalog.md Why3・未解決事項4）
- [x] `privacySettingsPanel.ts:92` の DOM 迂回クリックが `registry.navigate()` 経由に置き換わる（grepで迂回ゼロを確認）
- [x] sidebar の HTML（静的）↔ カタログの同期検証テスト（または実行時生成への移行）が実装されている（静的維持＋`panelCatalog.test.ts` 16件。未解決事項1の結論は whywhy/pbi25-catalog.md に記録）
- [x] a11y（tab ロール・aria-selected・keyboard 操作）と i18n（data-i18n 属性・data-i18n-aria-label）が不変（ADR 2026-04-19 回帰なし）（a11y属性の静的ピン＋keyboard既存テスト＋programmatic navigate同期テストで担保）
- [x] 既存 dashboard テスト（DashboardBootstrapper / NavigationRegistry / dashboard 系）が green（`src/dashboard` + `src/popup`: 184ファイル3345件 green）
- [x] `npm run type-check` / `npm run lint` / dashboard テスト green（type-check clean、lint 0 errors〈changed filesに警告なし〉）

> 注記（実測とPBI記載の差異）: HTML sidebarは17個ではなく18個（`data-panel` 18ヒット）、TS descriptorは20件ではなく19件（main.ts直登録は11件ではなく10件）。受け入れ基準の「20パネル」は「カタログ全19件」と読み替えた。`tagClusterTab` は両ロケールの messages.json に未定義の既存欠落（applyI18nがHTMLフォールバックを残すため表示不変。本PBIではキー一致のみ固定しロケール追加は対象外）。

## テスト戦略
- 単体: カタログ ↔ HTML sidebar の同期検証テスト（data-panel 一致・並び順・i18n キー存在）
- 単体: deep-link 解決のテスト（section → panel の派生が現行 map と同一結果）
- 回帰: a11y keyboard 操作テスト、NavigationRegistry / Bootstrapper 系テスト green
- 非対象: パネル本体の実装変更、sidebar のビジュアル変更、popup 側 navigation

## 実装アプローチ
1. `src/dashboard/panels/panelCatalog.ts` を新設（id / section / sidebar 表示情報 / i18n キー）
2. HTML sidebar は静的維持 + 同期検証テスト（実行時生成は CSP・初期描画の観点で今回は見送り。実装メモに判断記録）
3. main.ts / staticPanels.ts の descriptor 定義をカタログ参照に寄せる
4. dashboard.ts の section 解決をカタログ派生に
5. 迂回クリックを `registry.navigate()` に置換
6. 同期検証テスト + a11y 回帰 + 全検証

## 見積もり
1.5 pt（0.3 人週相当）

## 未解決事項
1. sidebar を実行時生成するか静的維持か → 静的維持 + 同期検証テストを基本方針とする（CSP / 初期描画 / a11y の確実性優先）。生成への移行は将来判断
2. `panel-history`（legacy、PBI 16 保留中）をカタログに含めるか → 含める（現行の実在パネルとして登録維持。PBI 16 着手時にカタログ行を削除するだけになる）

## Definition of Done
- [x] 全 BDD シナリオが自動テストとして実装されパスする（カタログ派生登録 / sidebar同期 / deep-link派生 / registry経由遷移）
- [x] パネル存在の真実の源がカタログ 1 箇所になっている（main.ts / staticPanels / sectionPanelMap の手書き重複解消を grep で確認）
- [x] 迂回クリックが消えている（grep で確認）
- [x] a11y / i18n 回帰なし（テスト green）
- [ ] コードレビュー完了（未達理由: 本worktreeでの実装直後のため、レビューは別途依頼が必要）
- [x] `npm run type-check` / `npm run lint` / dashboard テスト green
