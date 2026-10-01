# PBI: reload 競合ガードの ReloadGuard 単一 module 化

## ユーザーストーリー

保守担当の開発者として、reload の staleness 判定を 1 module に集めたい、なぜなら `asyncDataPanelLifecycle`・`sqliteHistoryModel`・`NavigationRegistry` が同形の generation counter を別々に持ち、どの load が勝つかを 1 箇所で答えられないから。

## 優先度

- 順位: 2 / 7（2026-10-01 arch-delivery-loop ラウンド。全体像は [00-backlog-archloop-1001](2026-10-01-00-backlog-archloop-1001.md)）
- RICEスコア: 19.2（Reach=12 / Impact=2 / Confidence=0.8 / Effort=1.0）
- 根拠: history・9 async-data panel・diagnostics・registry の supersede-navigate を 1 対策で束ねる。依存なし。

## 背景

- `src/dashboard/panels/asyncData/asyncDataPanelLifecycle.ts`（`loadSeq`・`isStale()`）、`src/dashboard/panels/asyncData/sqliteHistoryModel.ts`（`requestGeneration`・`invalidateCache`・`onNavigateIn/Out`）、`src/dashboard/panels/NavigationRegistry.ts`（`navGeneration`）、`src/dashboard/panels/diagnostic/diagnosticsPanel.ts`（ガードなし・`loadAndPopulate` が割込み可能）、`tagClusterTimeSliderPanel.ts`（独自 two-half fetch＋`isStale` 受渡し）。

## BDD受け入れシナリオ

```gherkin
Scenario: 古い load の描画が捨てられる
  Given guard から取った token で fetch している
  When 新しい load が start してから古い fetch が解決する
  Then 古い結果は描画されず新しい結果だけが残る

Scenario: diagnostics の連打が直列化される
  Given diagnostics の load に guard を適用している
  When 短時間に 2 回 loadAndPopulate が呼ばれる
  Then 先行の collect 結果は描画されず後行だけが描画される
```

## 受け入れ基準

- [x] `ReloadGuard` module を新設し interface は `{ start(): LoadToken; isCurrent(t): boolean; invalidate(): void }` のみとする（`asyncData/reloadGuard.ts`）
- [x] `asyncDataPanelLifecycle` は outer-ring owner のまま guard を消費する（`loadSeq` 除去・`destroy` は `invalidate()`）
- [x] `sqliteHistoryModel.fetchData` の `requestGeneration` を guard に置換（cache policy・query 順序は不変）。各 model instance が独自 guard を持つ（仕様: 同一 guard の共有は行わず counter の形だけを共有する。ring/model/registry の責務境界を保つため）
- [x] `NavigationRegistry.#navigateInternal` の `navGeneration` を guard に置換
- [x] `diagnosticsPanel.loadAndPopulate` に guard を適用する（collect 後の render 前に `isCurrent` 判定）
- [x] timer 操作なしに競合をテストできる（新規 `reloadGuard.test.ts` 4 件）

## 実装記録

- 既存の generation 系テスト（lifecycle・history generation・controller）は無変更で green。panel 全体 72 files / 818 tests green。
- `tagClusterTimeSliderPanel.ts` の独自 two-half fetch は対象外とし exemption とする（panel 内完結の局所 counter のため）。

## テスト戦略

- 単体: guard 契約テスト（start→invalidate→isCurrent が偽、token なし load の破棄）
- 既存: `asyncDataPanelLifecycle.test.ts` と `sqliteHistoryModel.test.ts` の generation 系テストを guard 契約へ寄せる
- 統合: `npm run validate` が通ること

## 見積もり

1 SP（要チームでの見積もり）

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test / build が通る
- [x] コードレビュー完了
