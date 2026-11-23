# PBI: 日時フォーマット4系統の正規seam集約

## ユーザーストーリー
開発者として、日時表示が正規seamに集約されてほしい、なぜなら同一責務が4実装+各所inlineに分散しているとi18n・タイムゾーン不整合が起き、修正が全画面に波及しないから。

## 優先度
- 順位: 2/3 (Round 2)
- RICE: 1.28 (Reach=8 / Impact=1 / Confidence=0.8 / Effort=5)
- 根拠: 全画面の日付一貫性・i18n。中難易度だが波及大。
- 依存: なし (R1-02のformatDate付け替えと競合しないよう、R1-02完了後に差分確認して着手)

## 現状 (file:line付き・要実装時再確認)
- `src/utils/localeUtils.ts:71` formatDate / `:121` formatDateTime (正規系)。
- `src/utils/pendingRowRenderer.ts:27-29` formatTimestamp (独自toLocaleString)。
- `src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts:72` formatDate (YYYY-MM-DD系・カレンダーdata-date契約)。
- `src/popup/statusChecker.ts:53-101` formatTimeAgo (手組み)。
- inline分散: researchSessionsPanel (190,330,451) / cleansingFeedbackView / ublockImport uiRenderer / exportImport / diagnosticsPanel / archiveSessionPanel。

## BDD受け入れシナリオ

```gherkin
Scenario: 全画面の日付表示が変わらない
  Given 各画面で日時を表示する
  When 集約後のコードで描画する
  Then 表示文字列は変更前と一致する (locale固定のgolden)

Scenario: data-date契約が壊れない
  Given sqliteHistoryカレンダーを開く
  When 日付セルを描画する
  Then data-date属性はYYYY-MM-DDのまま

Scenario: 相対時刻表示が維持される
  Given popupステータスを確認する
  When formatTimeAgo相当を呼ぶ
  Then 従来と同一文字列が返る
```

## 受け入れ基準
- [x] (1) localeUtilsが正規seamとして固定される (formatDate/formatDateTime/formatTimeAgo集約または再export)
- [x] (2) pendingRowRenderer.formatTimestamp・sqliteHistoryPanelView.formatDateが委譲ラッパー化 (公開名維持。sqliteHistoryPanelViewはR1-02成果のため無改変維持)
- [x] (3) inline toLocaleString/toISOString().sliceがseam呼び出しに置換される (archiveSessionPanelのUTC表示1箇所は仕様変更のため見送り→台帳送り)
- [x] (4) popup formatTimeAgoがlocaleUtilsへ移動しstatusCheckerは再export (公開名維持)
- [x] (5) YYYY-MM-DDのdata-date契約テストが緑
- [x] (6) 既存テスト全件緑

## テスト戦略
- goldenテスト: locale固定での表示文字列pin (置換前後比較)。
- 契約テスト: data-date形式の明示テスト。
- 回帰: utils・popup・dashboardテスト全件。

## 見積もり
- M

## Definition of Done
- [x] 全BDDシナリオが自動テスト化され、すべてパスする
- [x] コードレビューが完了している
- [x] 受け入れ基準のすべての項目が満たされている

## 出典
- holistic-code-review 2026-11-11 Round 2 (DRYテーマ2)
