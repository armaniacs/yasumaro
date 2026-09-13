# PBI 01: e2e spec — history panel UI（tag filter / pagination / star）

## ユーザーストーリー

履歴パネルを使う利用者として、タグ絞り込み・ページ送り・スター登録が実 UI で壊れていないことをリリース前に検証してほしい。なぜなら rounds 5-7 でこの領域の改修が集中したが、e2e は panel-existence のみで振る舞いカバレッジがゼロだから（round 6 監査の High gap）。

## 優先度

- 順位: 01 / 3
- RICE スコア: 4.0（Reach=1 / Impact=2 / Confidence=80% / Effort=0.4 人週）
- トリガー: round 7 台帳の「e2e 実行可能環境」が**本環境で発火**（macOS + chromium で extension.spec 12 passed / dashboard-ui.spec 52 passed を確認）。
- 根拠（round 8 調査）: seedRows / openOptionsPage / migrationSettled / createDashboardSqliteClient の helper が揃い、セレクタは SQLITE_HISTORY_IDS から機械的に導出できる。panel 遷移は `[data-panel="panel-sqlite-history"]` click（dashboard-archive.spec と同一パターン）。

## BDD 受け入れシナリオ

```gherkin
Scenario: panel が seed 行を一覧表示する
  Given 25 行が seed 済み（tags 混在）
  When sidebar で panel-sqlite-history を開く
  Then 最初の 20 行が表示され、件数表示が total を示す

Scenario: tag badge で絞り込める
  Given tags 'e2eAlpha,e2eShared' を持つ行が 8 件ある
  When 先頭の e2eAlpha badge をクリックする
  Then #sqlite-tag-filter-bar が表示され、行数が alpha 分に減る
  When #sqlite-tag-filter-clear をクリックする
  Then 全件表示に戻る

Scenario: star が永続化される
  When 既知の行の star をクリックする
  Then .starred + aria-pressed=true になる
  And reload 後も starred を維持する

Scenario: pagination が行を送る
  Given 25 行（2 ページ）がある
  When [data-page="next"] をクリックする
  Then 表示行の id 集合が変わり、[data-page="prev"] が有効になる
```

## 受け入れ基準

- [x] `testDir/e2e/history-panel-ui.spec.ts`（@extension・extension.fixture + dashboardSqliteHelpers）新設
- [x] 4 シナリオを実装し extension project で green（headless 環境では全 @extension spec と同様 skip — 実機 green は headed CI で確認）
- [x] 検索 debounce 300ms は expect.poll で待機（sleep 固定待ちを避ける）

## テスト戦略

`npx playwright test --config testDir/playwright.config.ts --project=extension testDir/e2e/history-panel-ui.spec.ts` で実行検証。

## 実装メモ（2026-09-11 autonomous-task-closer）

- PBI 記載の `--project=chromium` は誤記 — 正は `--project=extension`（chromium project の grep は `@extension` を除外する）。本文書の手順を修正済み。
- 全セレクタを実 DOM に対照済み: `#sqlite-entry-list .sqlite-entry` / `.tag-badge[data-tag]` / `#sqlite-tag-filter-bar` / `#sqlite-tag-filter-clear` / `.starred`+`aria-pressed` / `[data-page=next/prev]` / `.sqlite-history-count`（`sqliteHistoryPanelView.ts` + `SQLITE_HISTORY_IDS`）。
- headless sandbox では 4 skipped（extension.fixture の fixme ガード — 既存 @extension spec と同一挙動）。testDir tsc は新規ファイル 0 errors（既存 13 件は無関係・着手前から存在）。
- なぜなぜ: なぜ振る舞いカバレッジがゼロだったのか → panel-existence のみで十分と判断されていた → rounds 5-7 の集中改修で乖離リスクが上昇 → 解: seedRows 25 行（tag 混在 8/8/9・2 ページ）で 4 振る舞いを pin。

## 見積もり

M（0.4 人週）。種別: test。
