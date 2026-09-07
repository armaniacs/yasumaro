# PBI: legacy `panel-history` の撤去

## ユーザーストーリー
dashboard の履歴 UI を保守する開発者として、到達不能になった legacy `panel-history` を本番コード・HTML・テストから取り除きたい、なぜなら現行の SQLite History パネルと二重に存在することで「どちらが本物か」の判断コストが常に発生し、陳腐化したテスト mock（現存しない `initHistoryPanel` API を mock）が誤った安心感を与え、旧共有モジュール群の依存グラフが読み解けないままになっているから。

`3478f9d9`（2026-07）以降、`panel-history` はサイドバーからも popup からも deep-link からも navigate されないデッドコードだが、`src/dashboard/main.ts` の登録・`entrypoints/options/index.html` のセクション・3 つのテストファイルの無効な mock として残存している。

## 優先度
- 順位: 04 / 7（2026-09-07 architecture review round の候補群）
- RICEスコア: 5.25（Reach=3 / Impact=1 / Confidence=70% / Effort=0.4人週）
- 根拠: `3478f9d9`（2026-07）以降どこからも navigate されないデッドコードだが、`main.ts` 登録・HTML セクション・陳腐化したテスト mock（現存しない `initHistoryPanel` API を mock）として残存。PBI 2026-09-05-14 が「navigation 監査が必要」として legacy panel 移行を明示的に繰り越した。本調査で `panel-history` 到達不能を確認済み（監査の主要部は完了）。Confidence が 70% に留まるのは、`panel-history` にしかない機能（pending pages セクション・`chrome.storage.onChanged` ライブ更新・6 種フィルタ・タグ編集モーダル・Export all as Markdown）の移行先が現行パネルに既存かどうか未確定で、独立 PBI に分裂する可能性が残るため。
- **重要: この PBI は現時点では実装しない。03（PBI 15・tag SQL 移行）→ 04 の順で着手し、かつ両方保留とする（未解決事項の確定と PBI 15 の完了を待つ）。**

## BDD受け入れシナリオ

```gherkin
Scenario: popup の履歴ボタンから現行パネルが開く（撤去後も遷移が壊れない）
  Given legacy panel-history を撤去した dashboard
  When  popup の「履歴」ボタンを押して options.html?tab=history に遷移する
  Then  panel-sqlite-history がアクティブになり、履歴一覧が表示される

Scenario: サイドバーの History ボタンから現行パネルが開く
  Given legacy panel-history を撤去した dashboard
  When  サイドバーの History ボタン（旧「SQLite History」）を押す
  Then  panel-sqlite-history がアクティブになり、履歴一覧が表示される

Scenario: ?tab=history deep-link が現行パネルに着地する
  Given legacy panel-history を撤去した dashboard
  When  options.html?tab=history を直接開く
  Then  panel-sqlite-history がアクティブになる

Scenario: 撤去後も pending pages を引き続き閲覧できる
  Given chrome.storage に pendingPages が存在する状態
  And   legacy panel-history を撤去した dashboard
  When  履歴 UI（panel-sqlite-history）を開く
  Then  記録待ちページ（pending pages）が一覧に表示される

Scenario: pendingPages のライブ更新が反映される
  Given 履歴 UI（panel-sqlite-history）を開いている状態
  When  別コンテキストで chrome.storage の pendingPages が更新される
  Then  再読み込みなしで一覧が更新される

Scenario: 「Export all as Markdown」機能が引き続き利用できる
  Given legacy panel-history を撤去した dashboard
  When  履歴 UI で全件 Markdown エクスポートを実行する
  Then  従来と同じエクスポート結果が得られる

Scenario: 撤去された panel-history 関連の陳腐化テストが除去されている
  Given 撤去後のテストスイート
  When  vi.mock('../historyPanel.js', () => ({ initHistoryPanel: ... })) を grep する
  Then  該当行が存在しない（現行 historyPanel は createHistoryPanel をエクスポートし initHistoryPanel は存在しないため、これらの mock は実体に対応せず無効だった）

Scenario: NavigationRegistry に panel-history が登録されていない
  Given 撤去後の dashboard 初期化
  When  registerPanels 完了後の NavigationRegistry を検査する
  Then  panel-history キーが存在せず、panel-sqlite-history のみが履歴パネルとして登録されている
```

## 受け入れ基準
- [ ] `src/dashboard/main.ts` の legacy `createHistoryPanel` の import と `registerPanels` 内の登録（:8 / :27 相当）が削除される
- [ ] `entrypoints/options/index.html` の `<section id="panel-history">`（:1667-1719 相当、`#historyList` / `#pendingSection` / `.history-filter-btn` / `#tagEditModal` / `#historyExportLocalMarkdownBtn` 一式）が削除される。ただし `panel-history` にしかない機能は現行パネルへの移設が完了しているか、または現行に既存であることが確認済みであること
- [ ] 陳腐化したテスト mock が削除または現行 API に合わせて修正される（`src/dashboard/__tests__/dashboard-handlers.test.ts:258`、`dashboard.test.ts:465`、`dashboard-obsidian-enabled.test.ts:176` の `vi.mock('../historyPanel.js', () => ({ initHistoryPanel: ... }))`）
- [ ] legacy 撤去で完全に未参照になった旧共有モジュールが削除される。ただし `historyFilters.ts` は削除不可（`shouldFallbackToTextSearch` を `sqliteHistoryQuery.ts:22` が使用）。未使用の `filterHistoryEntries` 等のシンボルのみ削除可
- [ ] `?tab=history` deep-link（`src/dashboard/dashboard.ts:37-39`）と popup 履歴ボタン（`src/popup/navigation.ts:54`）の着地先が `panel-sqlite-history` のまま維持される
- [ ] サイドバーの履歴ボタンのラベル・i18n キーの整理方針が決定・適用される（`historyTab` / `historyDescription` / `sqliteHistoryTab`）
- [ ] `PanelLifecycle` interface / `NavigationRegistry` は無修正（PBI 14 と同方針）
- [ ] `npm run type-check` / `npm run check-i18n` / dashboard 関連テスト / `npm run build` がすべて PASS
- [ ] 振る舞いが変更前と同一（リファクタリング + デッドコード撤去）。撤去した機能の代替が現行パネルに存在することを自動テストで担保

## テスト戦略
### 単体テスト
- `registerPanels` 後の NavigationRegistry に `panel-history` が登録されないことを検証
- 旧共有モジュールを import しているファイルが無い（依存グラフが閉じている）ことを grep ベースのガードテストで固定
- `historyFilters.ts` の `shouldFallbackToTextSearch` は現行パネル経路のテストで引き続き担保（無修正 green を確認）

### 統合テスト
- pending pages セクションの表示・`chrome.storage.onChanged`（`savedUrlsWithTimestamps` / `pendingPages` 監視）によるライブ更新が `panel-sqlite-history` 経路で機能することを検証（現行に無ければこの検証は移設 PBI 側に持ち越し）
- `auto` / `manual` / `skipped` / `masked` / `cleansed` フィルタ相当が現行パネルに存在することの棚卸しテスト

### E2E
- popup「履歴」ボタン → `?tab=history` → `panel-sqlite-history` 着地
- `?tab=history` deep-link → `panel-sqlite-history` 着地
- サイドバー履歴ボタン → `panel-sqlite-history` 着地
- pending page がある状態で履歴 UI を開き、一覧に表示されること
- 「Export all as Markdown」が現行 UI から実行できること
- Playwright の既知の注意点（`waitForSelector('.hidden')` は `{ state: 'hidden' }` を使う、StorageKeys は snake_case、storage 注入は popup オープン前）に留意

### 例外ハンドリング
- 撤去は振る舞い不変が原則。既存の pending / filter / tag-edit / export の各アサーションを現行パネル経路の契約テストとして維持

## 実装アプローチ

PBI 14 と同方針で、`PanelLifecycle` interface / `NavigationRegistry` は無修正のまま進める。

1. **navigation 監査の残りを確定**（未解決事項 1〜3）。SQLite History パネルに pending pages セクション・6 種フィルタ・`chrome.storage.onChanged` ライブ更新が既に実装されているかを精査する。無ければ本 PBI から「pending pages 移設」等の独立 PBI を切り出す
2. **依存グラフ精査**（未解決事項 4）。`historyState.ts` / `historyRenderer.ts` / `historyPendingPanel.ts` / `historyFilters.ts` / `historyTagEditModal.ts` / `historyCleansingSync.ts` / `historyEntryRow.ts` / `utils/storageUrls.ts`（`getSavedUrlEntries`）/ `utils/pendingStorage.ts` の各ファイル・シンボルについて、legacy 撤去後に完全未参照になるものと現行パネルが使うものを分類する
3. **本番コードの撤去**。`src/dashboard/main.ts` の import と登録を削除、`entrypoints/options/index.html` の `<section id="panel-history">` を削除、完全未参照モジュールを削除
4. **陳腐化テストの整理**（未解決事項 5）。`initHistoryPanel` mock が今何を検証しているかを確認し、削除または現行 API に合わせて修正
5. **i18n キーの整理**。`historyTab` / `historyDescription` / `sqliteHistoryTab` を棚卸しし、サイドバーラベルを "History" に戻すかを決定。`npm run check-i18n` PASS 維持
6. **`sqliteHistoryPanelController.ts` / `sqliteHistoryPanelState.ts` の re-export shim**（PBI-17 残置物、未解決事項 6）を本 PBI で片付けるか別 PBI にするかを実装時に判断

## 見積もり
3ポイント（0.4人週相当：navigation 監査の確定と依存グラフ精査が中心。pending pages 等の移設が必要と判明した場合は本 PBI から独立 PBI が分裂し、本体は「撤去のみ」に縮小する）

## 実装者向け注記

### パネルの現状（2026-09-07 調査）

**2 系統の履歴 UI:**
- legacy `createHistoryPanel()`（`src/dashboard/historyPanel.ts`）と現行 `createSqliteHistoryPanel()`。`src/dashboard/main.ts:21-33` の `registerPanels` で **両方登録**（:27 と :28 相当）
- `NavigationRegistry`（`src/dashboard/panels/NavigationRegistry.ts`）: `register(panel)` で `panel.id` をキーに登録、`navigate(panelId)` で遷移

**legacy `panel-history` は実質デッドコード:**
- `entrypoints/options/index.html` のサイドバーボタン（`data-panel` 18 個、:25-165 相当）に `panel-history` は無い。`panel-sqlite-history` は :130 相当
- HTML `<section id="panel-history">` は :1667-1719 相当に残置（`#historyList` / `#pendingSection` / `.history-filter-btn` / `#tagEditModal` 等の旧 UI 一式、`#historyExportLocalMarkdownBtn` は :1716 相当）
- deep-link: `src/dashboard/dashboard.ts:37-39` の `?tab=history` は **`panel-sqlite-history` を返す**
- popup: `src/popup/navigation.ts:54` の履歴ボタンは `options.html?tab=history` → `panel-sqlite-history` に着地
- `grep "'panel-history'"` の本体ヒットは `historyPanel.ts` 自身の id 定義とコメントのみ

**削除の経緯（git 履歴）:**
- `3478f9d9`（2026-07-09, v6.5.16）でサイドバーの「History」ボタンを削除し、popup ボタンの遷移先を履歴パネル（SQLite 側）へ変更
- 前史: `20513c23` "merge History panel into SQLite History" → `27872107` "revert: restore 記録履歴 panel" → `3478f9d9` で再度ボタン削除。2 回の統合試行と、間に 1 回の revert がある

**legacy panel を今も参照している箇所:**
- `src/dashboard/main.ts:8,27` 相当 — import と登録（本番）
- `entrypoints/options/index.html:1667-1719` 相当 — HTML セクション
- テスト（**旧 API 名 mock で陳腐化**）: `src/dashboard/__tests__/dashboard-handlers.test.ts:258`、`dashboard.test.ts:465`、`dashboard-obsidian-enabled.test.ts:176` が `vi.mock('../historyPanel.js', () => ({ initHistoryPanel: ... }))` としているが、現行 `historyPanel.ts` は `createHistoryPanel` をエクスポートし `initHistoryPanel` は存在しない（mock が実体に対応せず無効）
- 旧共有モジュール群: `historyState.ts` / `historyRenderer.ts` / `historyPendingPanel.ts` / `historyFilters.ts` / `historyTagEditModal.ts` / `historyCleansingSync.ts` / `historyEntryRow.ts` / `utils/storageUrls.ts`（`getSavedUrlEntries`）/ `utils/pendingStorage.ts`
  - ※ `historyFilters.ts` の `shouldFallbackToTextSearch` は新 SQLite パネル側（`sqliteHistoryQuery.ts:22`）も使用 → **ファイル全体は削除不可**

**`panel-history` にしかない機能（統合先に移すか、現行に既存か確認が必要）:**
- Pending pages セクション（`#pendingSection` / `#pendingList`、`renderPendingPage` / `renderSkippedMode` in `historyPendingPanel.ts`、`chrome.storage` の `pendingPages` を読む）
- `chrome.storage.onChanged` リスナーによる `savedUrlsWithTimestamps` / `pendingPages` のライブ更新（`historyPanel.ts:106-136` 相当）
- filter ボタン `all` / `auto` / `manual` / `skipped` / `masked` / `cleansed`（`skipped` = pending 表示モード）
- タグ編集モーダル（`initTagEditModal`）
- 「Export all as Markdown」ボタン（`#historyExportLocalMarkdownBtn`、`dashboard.ts:88` 相当で wire）

### navigation 監査 = 確認すべき遷移経路

| # | 経路 | 現状 | 撤去後の確認事項 |
|---|------|------|------------------|
| 1 | popup「履歴」ボタン → `?tab=history` | `panel-sqlite-history`（既に現行） | 変化なし |
| 2 | `?tab=history` deep-link | `panel-sqlite-history` | 変化なし |
| 3 | サイドバー | `panel-history` ボタンは存在しない、「SQLite History」ボタンのみ | 撤去後ラベルを "History" に戻すか。i18n `historyTab` は HTML :1668 相当で `panel-history` セクションが使用中 |
| 4 | Tag Cluster → `tagClusterPanel.ts:145` | `navigateTyped('panel-sqlite-history', { searchTag })`（既に現行、PBI 14 で整理済み） | 変化なし |
| 5 | Domain Search / Domain panel | `searchDomain` 経由 | `panel-sqlite-history` へ着地するか要確認 |
| 6 | `initDashboard` default | `DEFAULT_PANEL_ID = 'panel-general'`（履歴は default ではない） | 変化なし |
| 7 | `chrome.storage.onChanged` ライブ更新 | `panel-history` のみが監視 | 現行にあるか要確認（`pendingPages` 監視は必要） |
| 8 | pending page 手動記録フロー | `renderPendingPage` が `panel-history` のみ | 移行先要確認 |
| 9 | 「Export all as Markdown」ボタン | `panel-history` セクションのみ | セクション削除時に移設必要 |

### 制約
- `PanelLifecycle` interface / `NavigationRegistry` は無修正で行けるはず（PBI 14 と同方針）
- `historyFilters.ts` は削除不可（`shouldFallbackToTextSearch` を現行が使う）。未使用の `filterHistoryEntries` 等のシンボルのみ削除可
- pending pages は `chrome.storage` ベース（SQLite 化されていない可能性大）。統合後もストレージ層は据え置き見込み
- i18n キー `historyTab` / `historyDescription` / `sqliteHistoryTab` の整理。`_locales/en` と `_locales/ja` は完全同期原則、`npm run check-i18n` PASS 必須
- PBI 15（tag SQL 移行、順位 03）完了後に着手する

### 現状コードの確認
```bash
rg -n "createHistoryPanel|initHistoryPanel|panel-history" src entrypoints --glob '!**/dist/**'
rg -n "shouldFallbackToTextSearch|filterHistoryEntries" src
rg -n "historyState|historyRenderer|historyPendingPanel|historyTagEditModal|historyCleansingSync|historyEntryRow|getSavedUrlEntries" src --glob '!**/__tests__/**'
rg -n "vi.mock\('../historyPanel" src
git log --oneline -- src/dashboard/historyPanel.ts | head -20
```

## 未解決事項
1. **SQLite History パネルに pending pages セクションは既に実装されているか？** 無ければ移設は非自明な作業量 → この PBI が「pending pages 移設」という独立 PBI に分裂する可能性大
2. SQLite パネルに `auto` / `manual` / `skipped` / `masked` / `cleansed` フィルタ相当はあるか（6 種の棚卸しが必要）
3. `chrome.storage.onChanged` のライブ更新を SQLite パネルは持つか（`pendingPages` 監視は必要）
4. legacy 撤去で `historyState.ts` / `historyRenderer.ts` / `historyEntryRow.ts` / `historyTagEditModal.ts` / `historyCleansingSync.ts` / `historyPendingPanel.ts` のどれが完全に不要になるか（依存グラフ精査）
5. 陳腐化テスト（`dashboard-handlers.test.ts:258` 他の `initHistoryPanel` mock）は今何を検証しているのか、削除して良いか
6. `sqliteHistoryPanelController.ts` / `sqliteHistoryPanelState.ts` の re-export shim（PBI-17 残置物）をこの PBI で片付けるか別 PBI か

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] dashboard 関連テスト全 green（`npm run type-check` / lint / `npm run check-i18n` / `npm run build` 含む）
- [ ] 未解決事項 1〜6 が本 PBI 内または実装時に結論付けられ、記録されている（pending pages 等の移設が必要と判明した場合は独立 PBI を切り出し、本 PBI のスコープを縮小）
- [ ] コードレビュー完了
- [ ] ドキュメント更新（`dev-docs/DESIGN_SPECIFICATIONS.md` の history panel 節から legacy `panel-history` の記述を削除。PBI 2026-09-05-14 backlog の「legacy 移行は残置」条に「撤去済み」と追記。`docs/i18n-guide.md` のキー数記載を更新）
