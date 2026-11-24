# ADR: 開発中 4 機能の正式版での扱いの判定材料と裁定

## ステータス
提案中

## 日付
2026-11-24

## コンテキスト

サイドバーの「In Development」区分にある 4 機能(保存済みコレクション、履歴に聞く、調査レポート、webhook export)を正式版で昇格させるか開発中のまま残すか決める。判定そのものは owner の裁定で、本 ADR は同じ判定基準の材料をそろえて裁定欄を用意する。PBI は `pbi/2026-11-24-02-feat-ga-dev-feature-graduation.md`。

4 機能はすべて `sidebarSection: 'experimental'`(`src/dashboard/panels/panelCatalog.ts:76,79,82,85`)で、`entrypoints/options/index.html:300` に `experimentalSection` の見出しがある。

## 判定基準(全機能共通)

| 項目 | 確認する内容 | 昇格の目安 |
|---|---|---|
| テスト網羅 | 単体・統合・E2E の有無と、主要な BDD シナリオがテストで検証されているか | 単体と E2E の両方があり、主要シナリオが緑 |
| 既知の不具合 | 未完了の PBI、GitHub Issues、handoff の未解決事項 | 利用者影響のある未解決の不具合がない |
| データ損失リスク | 保存形式(storage キー・SQLite)の版管理、移行の有無、削除・上書きの経路 | 保存形式に版があり、上書き・削除で既存データを失わない |
| 外部送信の有無 | 送信先、送信内容、既定値(オプトインか)、PRIVACY.md / PERMISSIONS.md への記載 | 外部送信なし、またはオプトインで文書に記載済み |
| ドキュメント有無 | README(日英)、docs/ の利用者向けガイド、i18n(en/ja) | 日英の README と利用者向けの説明がある |

## 判定材料(2026-11-24 時点、`1124a`)

### テスト網羅

単体は worktree(`1124a` 基点)で実行しすべて緑。E2E は `OW_E2E_PROBE=1` ビルドの `dist/chromium-mv3` に対し `--project=extension` で実行しすべて緑。

| 機能 | 単体 | E2E |
|---|---|---|
| 保存済みコレクション | 6 ファイル 75 件緑(`savedCollections` / `savedCollectionsRepository` / `savedCollectionsPanel` / `savedCollectionsRegionRender` / `savedCollectionsFirstCondition` の 59 件 + `savedCollectionQuery` の 16 件)。`collectionQueryV2` の直接のテストファイルは未特定(関連候補は `collectionScopeResolver.test.ts` 等、要確認)。gateway/handler 相当の統合はなし(panel + repository のみ) | `saved-collections-panel.spec.ts` 5 件緑(出現・recall / rename・duplicate / `?tab=collections` / history handoff / rule 追加・reload 永続) |
| 履歴に聞く | 5 ファイル 55 件緑(`askHistoryPanel` / `askHistoryPanelView` / `askHistoryHandlers` / `askHistoryGateway` の 33 件 + `askHistoryEvidence.realEngine` の 22 件)。handler + gateway で統合相当あり | `ask-history.spec.ts` 3 件 + `ask-history-panel.spec.ts` 2 件、計 5 件緑 |
| 調査レポート | 5 ファイル 58 件緑(`researchReportPanel` / `researchReportPanelView` / `researchReportGenerator` / `researchReportHandlers` / `researchReportGateway`)。handler + gateway + generator で統合相当あり | `research-report-panel.spec.ts` 2 件緑(report target / `?tab=research-report`) |
| webhook export | 7 ファイル 86 件緑(`webhookExportDestinations` / History / Payload / Sender / Settings / `webhookExportStep` / `webhookExportSettings-seam`)。保存と送信の同一判定源は `webhookExportDestinations.test.ts` の全 URL 一致テストで固定 | `webhook-egress.spec.ts` 3 件緑(CSP 遮断 / send gate / save pre-flight)。実 UI 経由(PBI 11-24-06 で完了) |

### 既知の不具合

- GitHub の open issue は 5 件(#215 閲覧ログインポート緩和、#214 DB エクスポート最大サイズ制限 bug、#160 Firefox HTTPS Obsidian bug、#154 旧形式 DB 互換終了のお知らせ、#153 レガシー移行コード sunset)。タイトルのみで判断する限り 4 機能に直接言及するものはない(本文の精査は要確認)
- 4 機能に言及する未完了 PBI は、webhook 周り(11-21-03 要素整理、11-21-01/05 listen・form binding、11-23-03 pre-flight の受け入れ充足状態は要確認)と、調査レポートの Obsidian 追記に影響し得る 11-24-05(412 通知、本 ADR 作成時点で実装済み・`1124a` に取込済み)がある。11-01 系の子 PBI(01 保存、02 履歴に聞く、03 レポート、04 slimming、06 handoff)は `dev-docs/archived/pbi/` に移動済みで完了状態は要確認
- handoff の未解決事項として、webhook の文言(`options/index.html` の `webhookExportDescription` 既定文と `messages.json`)の見送り分が監査 run-3(07)の確認項目に回っている

### データ損失リスク

| 機能 | 保存形式・版 | 削除・上書き経路 |
|---|---|---|
| 保存済みコレクション | chrome.storage.local(SQLite ではない)。キー `saved_collections`(`src/utils/storage/types.ts:44`、`SAVED_COLLECTIONS`)で版接尾辞なし。`settingsMigration.ts` に移行記述なし。読むときは `normalizeSavedCollections` で破損時も有効部分だけ残す縮退読み。書くときは map 全体を `repo.set` で上書き(read-modify-write)。CAS は `persistMerged` + `StorageTransaction` に委譲 | 個別削除は存在しない id なら no-op(`savedCollections.ts:70-76`)。`upsert` は同 id の `createdAt` を維持し `updatedAt` を更新。全体削除は `clearAllLocalData()`(`chrome.storage.local.clear()`)で、ダッシュボードの全削除 UI から到達する。版なしが仕様かは要確認 |
| 履歴に聞く | 新規の永続キーなし。`askHistoryHandlers.ts` は `StorageKeys` を import せず、SQLite の既存記録の読み取りと端末内モデルの回答だけ。回答は使い捨てで永続化しないためデータ損失の対象外(コード上の `set/remove` の有無の完全監査は要確認) | 該当なし |
| 調査レポート | 自身の storage なし(`researchReportGenerator.ts:1-19` に明記)。読むのは sqlite と `LOCAL_MARKDOWN_EXPORT_PATH` のみ。削除済み pin は `excludedCount` として数える | 生成物はローカル Markdown ダウンロードと Obsidian デイリーノート追記(任意)のみで、拡張機能内に永続状態を残さない。Obsidian 追記の上書き・重複条件と、生成済みファイルの全削除時の扱いは要確認 |
| webhook export | 版付きキー `webhook_export_settings_v1`(`webhookExportSettings.ts:39`)と `webhook_export_history_v1`(`webhookExportHistory.ts:37`)。`settingsMigration.ts` に移行記述なし。履歴の件数上限・保持期間は要確認。設定値に URL 全文(token を含み得る)が平文で入る点は監査 run-3(07)の監査項目 | 保存 UI は全体置換。空 URL は判定対象外で機能 OFF/クリア。全体削除は `clearAllLocalData()` で消える(キー一覧の明示的列挙の有無は要確認) |

### 外部送信の有無

| 機能 | 送信先・内容・既定値 | 文書 |
|---|---|---|
| 保存済みコレクション | 追跡した範囲(repository/types/panel)では storage のみで fetch なし(パネル全体の fetch 監査は要確認) | PRIVACY.md / PERMISSIONS.md / SECURITY.md に 3 機能名での言及なし(2026-11-24 に grep で確認)。保存済みコレクションの記載の有無は別名での記載も含め要確認 |
| 履歴に聞く | 外部送信なし。`askHistoryHandlers.ts:5` の冒頭コメントと `:187-190` で `mode: 'local_only'` を強制し、代替 AI も端末内モデルのみ | README 日英に「外部には送信しません / Nothing is sent externally」あり。端末内モデル依存のため Firefox 版の制限(ブラウザ内蔵 AI 非対応)との関係は要確認 |
| 調査レポート | 新規 egress なし(`researchReportGenerator.ts:8-9`)。配送は既存のローカル Markdown ダウンロードと Obsidian `appendToDailyNote`(任意)のみ。Obsidian は利用者設定の Local REST(既定 127.0.0.1) | 単独の記載は要確認。Obsidian 送信の任意性は README の機能行に記載あり |
| webhook export | 利用者設定の https 宛先へマスク済みタイトル・要約・タグ・URL のみ POST。既定 OFF のオプトイン。https-only(新規)、許可リスト 31 件、PII マスキング・privacy verdict 必須・本文 never(`webhookExportPayload.ts:4-8,19,38,108-110`) | `docs/PRIVACY.md:426`、`SECURITY.md:34`、`MCP_BRIDGE_RECIPE.md:11-16,56-70`、`PERMISSIONS.md:184,194` に記載あり。ただし `PERMISSIONS.md` の Reviewer Notes 2「宣言されていない宛先は遮断」は旧方式のまま(07 の洗い出し対象)。設定の平文 token の評価は 07 に回送済み |

### ドキュメント有無

- README 日本語 115-117 で 3 機能(保存・履歴に聞く・調査レポート)に「(開発中の機能)」付き。webhook export は機能一覧に項目なし。英語 378-380 では 3 機能に開発中の注記なし(日英で非対称)。webhook はセキュリティ節(557、31 patterns 記述)と MCP レシピ往復リンク(586,619)のみに登場
- `docs/` の利用者ガイド: `MCP_BRIDGE_RECIPE.md`(日英併記)が webhook 経由ブリッジを文書化。保存・履歴に聞く・調査レポートの専用利用者ガイドは未発見
- i18n: 4 機能の表示名は日英とも存在(ja `messages.json:4616,4619,4622,6071`、en `:4735,4738,4741,6089`)

## 09(必須 host_permissions の最小化)の裁定材料

- 配布 manifest は `host_permissions` 31 件 / `optional_host_permissions` 32 件 / content_scripts `<all_urls>`(`entrypoints/content/index.ts:7`)。必須 31 件の内訳はローカル 16 件 + AI 14 件 + Gist 1 件。`wxt.config.ts:335-342` の WAR は content script が全 http(s) で動くためのもの
- Chrome では導入時に content_scripts の一致により「すべてのサイトのデータの読み取りと変更」警告が出て、必須権限を減らしても警告は変わらない可能性が高い。`webhook-egress.spec.ts` の pin で `chrome.permissions.contains` が example.com に true になることが固定済み
- Firefox の扱い・更新時の付与残存・警告の有無はすべて要確認で、効果が未確定のため材料段階では保留相当

## owner の裁定(裁定者が記入する。実装者は代行しない)

| 機能 | 裁定(昇格/開発中のまま/保留) | 昇格の前提として確認すべきこと(保留の場合) |
|---|---|---|
| 保存済みコレクション | (未記入) | |
| 履歴に聞く | (未記入) | |
| 調査レポート | (未記入) | |
| webhook export | (未記入) | |
| 09 host_permissions 最小化 | (GA に含める/GA 直後に回す/見送る) | |

## 昇格した場合の後続作業(04 と 08 が参照する)

- サイドバー区分の移動は `panelCatalog.ts` と `entrypoints/options/index.html` の両方で行う(片方だけだと整合テストが赤)
- README の「(開発中の機能)」表記を外し、英語側の機能一覧と対称にする。webhook export を昇格する場合は機能一覧に項目を追加する
- ストア掲載文への追加(掲載文の管理場所は 04 で確定する)
- `experimental` から外した機能に `tabParam` があると既存のディープリンクが残る。移動先区分でも `?tab=` が動くかを確認する(保存済みコレクション `?tab=collections`、履歴に聞く `?tab=ask-history`、調査レポート `?tab=research-report` の E2E が材料として緑である)
- webhook export の古い説明(上記の `PERMISSIONS.md` Reviewer Notes 2、`webhookExportSettings.ts` と `webhookExportPayload.ts` のコメントは 06 で修正済み、`options/index.html` と `messages.json` は見送り中)を新方式に合わせる
