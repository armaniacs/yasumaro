# PBI: ローカル SQLite 集計失敗の誤エラーコードを是正

## ユーザーストーリー
障害調査をする開発者として、ローカル DB の集計失敗が外部 API 失敗と区別されて記録されてほしい。なぜなら `API_REQUEST_FAILURE` 混入はアラート・集計の誤分類を招き、真の外部障害を見逃す原因になるから。

## 優先度
- 順位: 07 / 11
- RICEスコア: 4.0（Reach=4 / Impact=0.5 / Confidence=1.0 / Effort=0.5）
- 根拠: ログ分類のみの修正。10箇所の機械的置換＋既存テスト緑で閉じる。

## 背景
`src/dashboard/panels/asyncData/` の 9 パネル＋`asyncDataPanelLifecycle.ts`（計10箇所：`domainAnalysisPanel.ts:207`、`researchSessionsPanel.ts:337`、`tagCooccurrenceTablePanel.ts:253`、`timeHeatmapPanel.ts:125`、`revisitInsightsPanel.ts:390`、`tagClusterPanel.ts:139`、`tagFrequencyTimelinePanel.ts:416`、`wordClusterPanel.ts:195`、`tagClusterTimeSliderPanel.ts:190`、`asyncDataPanelLifecycle.ts:155`）がローカル SQLite 集計の失敗を `ErrorCode.API_REQUEST_FAILURE` で記録している。レビュー指摘 Low #8（SRE/Ops）。

## BDD受け入れシナリオ
Scenario: ローカル集計失敗はローカル系コードで記録される
  Given いずれかの asyncData パネルで SQLite 集計が失敗する
  When 構造化ログを検査する
  Then `API_REQUEST_FAILURE` ではなくローカル系の ErrorCode（既存の STORAGE/SQLITE 系、なければ最小限の新設）で記録される

Scenario: ログの検索性は維持される
  Given 同上の失敗
  When ログを検査する
  Then パネル名・source・エラー内容の引数は従来どおり含まれる

## 受け入れ基準
- [x] 10箇所の `API_REQUEST_FAILURE` がローカル系コードに置換される（`STORAGE_READ_FAILURE` / `STRG_RD_001`、10/10 置換済み）
- [x] 新設コードがある場合は `ErrorCode` 定義側の命名規約に従う（新設なし：既存コードを採用）
- [x] asyncData パネル系テストが全緑（`npx vitest run src/dashboard/panels/`：87ファイル・929テスト全パス）

## テスト戦略
- 単体: エラーコード断定の既存テストがあれば期待更新、なければ代表1件追加
- 既存: `npx vitest run src/dashboard/panels/` 全緑

## 見積もり
0.5 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（`asyncDataPanelLifecycle.test.ts` の構造化ログ断定を `STORAGE_READ_FAILURE` に厳格化、Red/Green 確認済み）
- [x] コードレビュー完了（差分点検済み：第3引数の置換のみ、引数維持）
- [x] ドキュメント更新済み（不要ならその旨を記録）（新設コードなしのため `ERROR_CODES.md` 更新不要。既存 `STRG_RD_001` の説明は記載済み）
