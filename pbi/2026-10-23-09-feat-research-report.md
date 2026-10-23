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
- [ ] 要旨・時系列・引用・未読穴の4節がある
- [ ] 引用から元記録に飛べる
- [ ] 送達確認と再送ができる
- [ ] 生成の縮退・失敗が偽成功にならない

## テスト戦略
## 実装記録（2026-10-23・コア生成経路）
- 生成器: 完了。`src/background/researchReportGenerator.ts` の `createResearchReportGenerator` が選択範囲の取得→4節Markdown組み立て→配信を集約。generatorローカル Mutex（同時1レポート）。sqlite/obsidian/download は注入（review summary generator と同じ作法）
- 4節: 完了。`buildResearchReportMarkdown`（要旨・時系列・引用・未読穴）。要旨は記録経路が保存したクレンジング済み要約のみ引用（never-raw、生のページ本文は対象外）。時系列は古い順。引用は番号付きリンクで元記録に飛べる（BDD: 引用から元記録に飛べる）
- 選択範囲: 完了。パネル条件（語・タグ・選択日）が scope になり、records query に `text`/`tag`/`dateFrom`/`dateTo` + 古い順ソート + `REPORT_MAX_RECORDS`(200) cap で流れる。空選択は `no_records` で縮退（縮退の出口: 偽成功にしない。BDD: 生成の縮退・失敗が偽成功にならない）
- 送り先: 完了。既存路に限定 ― ローカルMarkdownダウンロード（review summary の `downloadMarkdown` を export して再利用、同一責務の再実装を避ける）+ Obsidian は既存の `appendToDailyNote` 経路。新規egressは追加していない（PBI 2026-10-23-01 の作法）。Obsidian 送達失敗は理由を返し再送可能（BDD: 送達が確認でき、失敗時は理由と再送ができる）
- messaging: 完了。`EXPORT_RESEARCH_REPORT` 型（messageTypes・ResponseForType）・`ExportResearchReportValidator`（scope の語/タグは `MAX_SEARCH_QUERY_LENGTH` と同cap、since/until は有限数）・`src/messaging/researchReportGateway.ts`（60秒budget・retries: 0）・MessageRouter登録（trust: extension-only）・composition配線（singleton generator）
- ダッシュボードUI: 完了。`src/dashboard/panels/asyncData/researchReportPanelView.ts` の `renderResearchReportRegion`（生成ボタン・Obsidian送信チェック・状態表示）。shell の `sqlite-research-report` 領域 div は buildPanelShellHtml が所有
- ja/en: `researchReportLabel`・`researchReportHelp`・`researchReportObsidianOption`・`researchReportGenerateBtn`・`researchReportBusy`・`researchReportFailed`・`researchReportDone` の7キーを双側追加
- pin: `src/background/__tests__/researchReportGenerator.test.ts` 11テスト（4節・時系列順・未読穴・空選択縮退・ファイル名・取得→組み立て→ダウンロード→Obsidian送信・各失敗経路）
- 残: E2E通し（選択→生成→送達→再送）、大量選択の境界テスト、コードレビュー、ドキュメント更新（レポート操作手順を含む）
- E2E: 選択→生成→送達→再送の通し
- 統合: 空選択・大量選択の境界テスト、送達失敗テスト
- 単体: 節整形・引用整形のテーブルテスト

## 見積もり
2.0人週相当。チームで再見積もりすること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み(レポート操作手順を含む)
