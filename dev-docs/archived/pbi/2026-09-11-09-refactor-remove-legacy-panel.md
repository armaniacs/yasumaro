# PBI 09: legacy panel-history を撤去する（PBI 2026-09-07-16・PBI-P 完了後）

## ユーザーストーリー

拡張機能を保守する開発者として、どこからも到達不能な UI とその依存チェーン（〜1,500 LOC）が消え、履歴画面が SQLite パネル 1 本である状態を望む。なぜなら `panel-history` はナビゲーション経路ゼロ（sidebar 18 パネル、`?tab=history` は sqlite パネルへ解決済み — catalog test で pin）で、維持だけがコストだから。

> 元 PBI: `pbi/2026-09-07-16-refactor-remove-legacy-history-panel.md`（本 PBI がそれを置き換える — 依存の PBI 15 / PBI-P が完了したため着手可能。`main.ts` に関する旧 DoD は panel catalog 化で陳腐化しており、実際の登録箇所は `panelCatalog.ts:62` と `panelFactories.ts:16,29`）

## 優先度

- 順位: 09 / 10
- RICE スコア: 6.7（Reach=2 / Impact=1 / Confidence=100% / Effort=0.3 人週）
- 依存: **PBI 02（PBI-P: pending pages 移設）の完了が前提**。前提達成済みなら撤去は機械作業。

## 製品判断（本 PBI で記録する・2026-09-11 診断時点の決定）

1. **6 フィルターモード（all/auto/manual/skipped/masked/cleansed）は撤去** — pending は専用セクション化（PBI-P）で skipped モードの役割終了。auto/manual/masked/cleansed の SQL フィルタ化は follow-up PBI（必要になった時点で）
2. **タグ編集モーダルは撤去** — タグ「フィルタ」は SQLite パネルに既存、編集 UI は follow-up（`#tagEditModal` は body-level のため HTML からも削除、`historyTagEditModal.ts` と共に）
3. **Export all as Markdown ボタンの新居は Export Logs パネル**（PBI-P で移設済み — 本 PBI では legacy セクション削除のみ）

## BDD 受け入れシナリオ

```gherkin
Scenario: legacy パネルが到達不能かつ未登録になる
  Given PBI-P 完了後のコードベース
  When panelCatalog を確認する
  Then 登録パネルは 18 件で 'panel-history' を含まない
  And sidebar / deep link / popup から panel-history への経路が無い

Scenario: 撤去後も sqlite パネルの全機能が動く
  Given legacy チェーン削除後
  When dashboard を開く
  Then 履歴表示・タグフィルタ・pending セクション・star・削除・export が動く
  And grep ガードテストが createHistoryPanel / panel-history の再出現を検出する
```

## 受け入れ基準

- [x] `panelCatalog.ts:62`（legacy 1 行）と `panelFactories.ts:16,29`（import + factory 1 行）を削除
- [x] `index.html` から `<section id="panel-history">`（:1667-1719）と body-level `#tagEditModal`（:2207-2238）を削除
- [x] prod 削除: `historyPanel.ts` / `historyState.ts` / `historyRenderer.ts` / `historyPendingPanel.ts` / `historyTagEditModal.ts` / `historyEntryRow.ts` / `historyCleansingSync.ts` / `historyUtils.ts` / `historyBadges.ts`
- [x] `historyFilters.ts` を `shouldFallbackToTextSearch` 1 関数に slim（唯一の現役 caller は `sqliteHistoryQuery.ts` — 検証済み）
- [x] 共有 keep 確認: `cleansingStatsView.ts`（aiSummaryCleansingPanel が使用）/ `storageUrls.ts` / `pendingStorage.ts` は無変更
- [x] dead vi.mock 3 箇所削除（`dashboard-handlers.test.ts:261` / `dashboard.test.ts:470` / `dashboard-obsidian-enabled.test.ts:176` — 存在しないパスと export 名を mock する no-op）+ `historyPanel.lifecycle.test.ts` + legacy 単体 spec 11 件削除（`historyFilters.test.ts` は shouldFallbackToTextSearch ケースを残す）
- [x] `panelCatalog.test.ts` を 18 パネルに更新（legacy case 削除）
- [x] grep ガードテスト新設（`panel-history` / `createHistoryPanel` / `initHistoryPanel` が PBI docs 外に出現したら失敗）
- [x] DESIGN_SPECIFICATIONS / ARCHITECTURE_MAP / docs/i18n-guide の該当箇所更新
- [x] type-check / check-i18n / dashboard テスト / build 全 green

## テスト戦略

削除系は既存テストの削除 + panelCatalog 更新 + grep ガード。現役経路は既存テストで担保。

## 見積もり

M（0.3 人週・機械的削除が主）。種別: refactor。

## 実装アプローチ

1. PBI-P 完了確認 → HTML セクション・catalog・factory 削除
2. prod モジュール 9 件削除 + historyFilters slim + テスト整理
3. grep ガード + docs 更新

## 実装メモ（2026-09-11 round 5）

- 削除: panelCatalog 1 行 + panelFactories import/factory 2 行 + index.html の panel-history セクション（1667-1719）と tagEditModal（2213-2243）+ prod 9 モジュール（historyPanel/State/Renderer/PendingPanel/TagEditModal/EntryRow/CleansingSync/Utils/Badges）+ legacy テスト 12 ファイル + stale vi.mock 3 箇所。
- `historyFilters.ts` を `shouldFallbackToTextSearch` 1 関数に slim（唯一の caller は sqliteHistoryQuery）。テストも 4 ケースに更新。
- panelCatalog.test を 18 パネルに更新 + legacy 未登録 pin + grep ガード `legacy-panel-removal-guard.test.ts`（識別子再出現 + ファイル不在を検出）。
- 検証: type-check 0 errors / dashboard 939 tests green / panel sections 18。
