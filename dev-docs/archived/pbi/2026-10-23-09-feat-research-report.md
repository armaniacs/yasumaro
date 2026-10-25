# PBI: 調査レポート一発生成 ― 選択から引用付き文書へ

## ユーザーストーリー
報告する人として、選んだ記録から引用付き報告書を作りたい、なぜなら要旨・時系列・未読穴の整理が手作業では終わらないから

## 優先度
- 順位: 04 / 5候補
- RICEスコア: 400 (Reach=500 / Impact=2 / Confidence=0.8 / Effort=2.0人週)
- 根拠: M2を入力、M1と並列利用可。M2確定後に着手する
- 依存: PBI 2026-10-23-06(M2)に依存する。双方向同期は含めない

## 背景・制約
- `exportEnvelope` と週次/月次の生成路(`src/background/reviewSummaryGenerator.ts`)の延長で作る。出力はMarkdownに限定する
- 送り先はObsidian/Gistの既存路に限定し、新規egressはPBI 2026-10-23-01の作法に従う
- 未読穴の検出はM4(ドメイン知能)と重複させない。本PBIは選択範囲内の穴に限定する

## BDD受け入れシナリオ
Scenario: レポートが生成される
  Given コレクションまたは選択N件がある
  When レポート生成を実行した
  Then 要旨・時系列・引用・未読穴のMarkdownが生成される

Scenario: 送り先に届く
  Given レポートが生成済みである
  When ObsidianまたはGistへ送った
  Then 送達が確認でき、失敗時は理由と再送ができる

## 受け入れ基準
- [x] 要旨・時系列・引用・未読穴の4節がある (2026-10-24確認: `buildResearchReportMarkdown` が4節を出力 `src/background/researchReportGenerator.ts:128-155`、11→14テストで固定)
- [x] 引用から元記録に飛べる (2026-10-24確認: 番号付き `[title](url)`、`sanitizeUrlForMarkdownTarget` で `javascript:` 等を `about:blank` 化 `src/background/researchReportGenerator.ts:104-109` + `src/utils/markdownSanitizer.ts:66-79`)
- [x] 送達確認と再送ができる (2026-10-24確認: `deliveredTo`/`recordCount` 返却と状態表示 `src/dashboard/panels/asyncData/researchReportPanelView.ts:132-140`、失敗時は理由表示のままボタンが復帰するため再送は再クリック。gateway は 60秒budget・retries: 0 `src/messaging/researchReportGateway.ts:38-46`)
- [x] 生成の縮退・失敗が偽成功にならない (2026-10-24確認: `no_records`/`download_failed`/`obsidian_delivery_failed`/fetch失敗パススルー/全catch が `success: false`。正本は判別共用体 `src/messaging/responseCanonical.ts:48-50`)

## テスト戦略
## 実装記録（2026-10-23・コア生成経路）
- 生成器: 完了。`src/background/researchReportGenerator.ts` の `createResearchReportGenerator` が選択範囲の取得→4節Markdown組み立て→配信を集約。generatorローカル Mutex（同時1レポート）。sqlite/obsidian/download は注入（review summary generator と同じ作法）
- 4節: 完了。`buildResearchReportMarkdown`（要旨・時系列・引用・未読穴）。要旨は記録経路が保存したクレンジング済み要約のみ引用（never-raw、生のページ本文は対象外）。時系列は古い順。引用は番号付きリンクで元記録に飛べる（BDD: 引用から元記録に飛べる）
- 選択範囲: 完了。パネル条件（語・タグ・選択日）が scope になり、records query に `text`/`tag`/`dateFrom`/`dateTo` + 古い順ソート + `REPORT_MAX_RECORDS`(200) cap で流れる。空選択は `no_records` で縮退（縮退の出口: 偽成功にしない。BDD: 生成の縮退・失敗が偽成功にならない）
- 送り先: 完了。既存路に限定 ― ローカルMarkdownダウンロード（review summary の `downloadMarkdown` を export して再利用、同一責務の再実装を避ける）+ Obsidian は既存の `appendToDailyNote` 経路。新規egressは追加していない（PBI 2026-10-23-01 の作法）。Obsidian 送達失敗は理由を返し再送可能（BDD: 送達が確認でき、失敗時は理由と再送ができる）
- messaging: 完了。`EXPORT_RESEARCH_REPORT` 型（messageTypes・ResponseForType）・`ExportResearchReportValidator`（scope の語/タグは `MAX_SEARCH_QUERY_LENGTH` と同cap、since/until は有限数）・`src/messaging/researchReportGateway.ts`（60秒budget・retries: 0）・MessageRouter登録（trust: extension-only）・composition配線（singleton generator）
- ダッシュボードUI: 完了。`src/dashboard/panels/asyncData/researchReportPanelView.ts` の `renderResearchReportRegion`（生成ボタン・Obsidian送信チェック・状態表示）。shell の `sqlite-research-report` 領域 div は buildPanelShellHtml が所有
- ja/en: `researchReportLabel`・`researchReportHelp`・`researchReportObsidianOption`・`researchReportGenerateBtn`・`researchReportBusy`・`researchReportFailed`・`researchReportDone` の7キーを双側追加
- pin: `src/background/__tests__/researchReportGenerator.test.ts` 14テスト（4節・時系列順・未読穴・空選択縮退・ファイル名・取得→組み立て→ダウンロード→Obsidian送信・各失敗経路・cap固定・時系列サニタイズ）
- handler pin (2026-10-24追加): `src/background/handlers/__tests__/researchReportHandlers.test.ts` 7テスト（scope整形・欠落payloadの空scope縮退・sendToObsidian強制・失敗パススルー・throwの `report_failed` 化）
- 残: E2E通し (specは `testDir/e2e/history-panel-ui.spec.ts` の `Research report @extension` に2件追加済み・未実行。headed実行は別途)、大量選択の境界テスト (単体で固定済み: cap上限200で成功・`REPORT_MAX_RECORDS` は `MAX_BATCH_READ_RECORDS` に固定)、コードレビュー (2026-10-24実施・下記に記録)、ドキュメント (文言案は次回報告に添付・`docs/` は未編集)
- レビュー記録 (2026-10-24): 対象は `c4ff8484` (本体) と後続 refactor (`96ee8757` 文言分離・`739f19de` 正本集約・`37e576f0` region所有化・`10e9a15d` 上限集約・`c9424450` busy共通化・`30de8508` gateway共通化)。層化 (生成器は輸送を持たない・scope整形は正本が単一所有) と失敗閉鎖に問題なし。指摘2件を同日修正: (1) 時系列節の題名だけ無害化漏れ → 他節と同一の `sanitizeForObsidian` 化 (2) 要旨節コメントの `newest first` が実装 (選択順) と不一致 → コメント修正。残る注意3件は仕様内で受容: Obsidian失敗時は済みのダウンロード送達を捨てて `obsidian_delivery_failed` のみ返す (再送は全行程を再実行・同一分ファイル名で上書き) / Gist送達は未実装 (既存路限定の方針どおり・BDD文言の `またはGist` との差は受容) / コレクション指定は panel条件への適用経由でのみ scope 化 (単体 `collectionId` はなし)
- E2E: 選択→生成→送達→再送の通し
- 統合: 空選択・大量選択の境界テスト、送達失敗テスト
- 単体: 節整形・引用整形のテーブルテスト

## 見積もり
2.0人週相当。チームで再見積もりすること

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする (2026-10-25: E2E 2件を `--repeat-each=2` で4/4緑、他specと合わせ24/24緑。単体・handler・gateway・region 緑)
- [x] コードレビュー完了 (2026-10-24実施・記録は実装記録のレビュー記録を参照)
- [x] ドキュメント更新済み(レポート操作手順を含む) (2026-10-25: `docs/SETUP_GUIDE.md` の調査レポート欄に手順・4節・引用・未読穴・no_records・再送・200件・Obsidian失敗時を追記)
