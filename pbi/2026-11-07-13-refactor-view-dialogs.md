# PBI: sqliteHistoryPanelView の dialog/wiring 移動による見通し改善

## ヘッダ

- rank: 4/5
- RICE: 0.64 (R4 / I1 / C0.8 / E5)
- 依存: なし
- テーマ: sqliteHistoryPanelView.ts 1195行の build/wire/show 混在
- 種別: refactor
- 日付: 2026-11-07

## ユーザーストーリー

開発者として、`sqliteHistoryPanelView.ts` の confirm dialog 系と calendar/sort wiring 系を別ファイルへ移動したい。なぜなら 1195 行の単一 View に build と wire と show/hide が混在し、変更時の見通しが悪いから。

## 背景

対象は `src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts` (1195行、確認済み) である。`export function` は 35 件を確認した。内訳の提案値 (build 10 / wire 6 / show/hide 10 / render 3 / wrapper 2、計約 30) とは件数が合わないため要確認。

- Controller は `src/dashboard/panels/asyncData/sqliteHistoryPanelController.ts` (28行、確認済み) で、`sqliteHistoryModel.ts` への shim である。State は `src/dashboard/panels/asyncData/sqliteHistoryPanelState.ts` (15行、確認済み) で、同様に re-export shim である。どちらも既に薄い。
- `buildEntryListHtml:89`、`buildPaginationHtml:160`、`buildSortControlHtml:172` を確認済み。
- `wireEntryList:801`、`wirePagination:878` を確認済み。`wirePanelShell:981` を確認済み (次関数は `wireDataRegions:1053` のため末尾は 1051 付近)。
- `showDeleteConfirm:564`、`showStarConfirm:590`、`showStarUndo:623` を確認済み。付随する hide/is 系 (`hideDeleteConfirm:572`、`isDeleteConfirmVisible:579`、`hideStarConfirm:606`、`isStarConfirmVisible:613`、`hideStarUndo:632`) と `setHandoffReason:644`、`clearHandoffReason:650` を確認済み。
- 非公開関数の `wireDataRegions:1053`、`renderFull:1073`、`updateDynamicRegions:1094` を確認済み。公開 render 系は `renderPendingRegion:471` と `render:527` を確認済み。
- `buildCleansingProgressBarHtml:32` と `formatDiagnosticMetadataHtml:84` は `historyEntryPresentation.ts` の `renderCleansingBar` / `renderEntryDiagnostics` への薄い adapter であり、移動対象外とする (コメントで確認済み)。
- `wireSortControl:895` と `wireCalendarNav:914` を確認済み。

提案は function-move のみであり、file 分割の意味変更はない。confirm dialog 系 (show/hide 10 件) を `sqliteHistoryConfirmDialogs.ts` へ、calendar/sort wiring を `sqliteHistoryChromeWiring.ts` へ移す。全面書き直しはしない。UI の振る舞いは同一とする (目視確認)。

## BDD受け入れシナリオ

```gherkin
Scenario: confirm dialog の移動後も削除確認が同じ見た目で動く
  Given パネルがマウントされ履歴が表示されている
  When 削除ボタンを押して `showDeleteConfirm` 系の移動後関数を呼ぶ
  Then 従来と同じ確認 UI が表示され Yes/No の動作が変わらない

Scenario: confirm dialog の移動後も star 確認と undo が同じ見た目で動く
  Given 複数件を選択した状態である
  When star ボタンを押して `showStarConfirm` 系の移動後関数を呼ぶ
  Then 件数表示を含む確認 UI が従来と同じである
  And 確定後に `showStarUndo` の undo 表示が従来と同じである

Scenario: chrome wiring の移動後も calendar と sort が動く
  Given パネルがマウントされている
  When calendar の日付選択と sort 変更を行う
  Then 移動後の wiring 経由で従来と同じ絞り込みと並び替えが行われる
```

## 受け入れ基準

- [ ] 移動のみであり、ロジック変更や全面書き直しを含まない
- [ ] show/hide 10 件が `sqliteHistoryConfirmDialogs.ts` に移り、旧 import が新経路に付け替わる
- [ ] calendar/sort wiring (`wireCalendarNav`、`wireSortControl` と関連 build) が `sqliteHistoryChromeWiring.ts` に移る
- [ ] `buildCleansingProgressBarHtml` と `formatDiagnosticMetadataHtml` は移動せず adapter のまま残る
- [ ] UI の見た目と操作感が移動前と同一である (目視確認)
- [ ] 既存の dashboard/panel テストが green である
- [ ] `npm run type-check` と lint が通る

## テスト戦略(t_wada式)

Outside-Inで進める。移動前後で振る舞いが変わらないことを既存テストで押さえ、最後に目視で確認する。

### E2Eテスト

- 対象外。見た目同一の確認は目視で行う。

### 統合テスト

- 既存の dashboard/panel 系スイートで回帰確認する。対象は `sqliteHistory` 系の panel/view テストである。

### 単体テスト

- 移動後の dialog 関数の表示/非表示の往復テストが既存分で通ること。
- 移動後の wiring 関数の no-op ガード (region 不在時) が既存分で通ること。

### 型チェック

- `npm run type-check` が通ること。

### lint

- `npm run lint` が通ること。

## 見積もり

- 5SP

## Definition of Done

- [ ] 全BDDシナリオが確認されパスする
- [ ] 既存の dashboard/panel テストがパスする
- [ ] `npm run type-check` がパスする
- [ ] `npm run lint` がパスする
- [ ] UI の振る舞い同一を目視で確認した
- [ ] コードレビュー完了
