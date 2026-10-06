# PBI: `PanelCatalogId` が `string` に退化し、`panelFactories` が主張する型ガードが実在しない

## ユーザーストーリー

パネルを追加する開発者として、カタログと factory の対応を型で守りたい。`panelFactories.ts` 冒頭が「行を足して factory を足し忘れると type-check が落ちる」と謳うのに、実際は `string` に退化して実行時の起動失敗でしか検出されないから。

## 優先度

- 順位: 21/32
- RICE: 3.0（R3 / I1 / C1.0 / E1）
- 根拠: 新規パネル追加時に発火する。同点ではこちらを先行
- 依存: なし

## 背景（file:line 現状）

- `src/dashboard/panels/panelCatalog.ts:41`: `export const PANEL_CATALOG: readonly PanelCatalogEntry[] = [ ... ] as const;` の**明示アノテーションが `as const` を上書き**して、`typeof PANEL_CATALOG` が初期値ではなくアノテーション型になる
- `:21`: `PanelCatalogEntry.id` が `readonly id: string` のため、`:70` の `export type PanelCatalogId = (typeof PANEL_CATALOG)[number]['id']` は **`string`** に解決される
- 結果: `src/dashboard/panels/panelFactories.ts:30` の `Record<Exclude<PanelCatalogId, StaticFormPanelId>, ...>` も `Record<string, ...>` になる。`:6-7` が謳う「カタログに行を足して factory も static spec も足さないと type-check が落ちる」ガードは実在しない
- `:51` の `as Record<string, (() => PanelLifecycle) | undefined>` キャストと panelCatalog の `:83, :89` の `as PanelCatalogId` キャストは、この退化の産物（string 同士のため無意味）
- `src/dashboard/panels/DashboardBootstrapper.ts:35` の `createPanel: (id: PanelCatalogId) => PanelLifecycle` も実質 `string` 受け
- 現状の唯一の実行時兜底: `src/dashboard/panels/__tests__/panelCatalog.test.ts:239-249`（`createPanelById` の throw を固定）
- 影響: カタログに行を足して factory を足し忘れても型エラーが出ず、レジストリ登録ループがモジュール評価時に走るためダッシュボード全体の起動失敗になり得る

## BDD受け入れシナリオ

```gherkin
Scenario: factory の欠けが型エラーになる
  Given カタログに行を足して factory を足し忘れた状態
  When tsc --noEmit を実行する
  Then 型エラーで落ちる

Scenario: 実行時の値と型が変わらない
  Given 整理後の panelCatalog
  When 実行時とテストを実行する
  Then 値・順序・sidebar 表示は不変で、golden list テストが green のままである

Scenario: 無意味なキャストが消える
  Given 整理後の panelFactories
  When createPanelById と resolve 系を確認する
  Then as Record<string,...> と as PanelCatalogId のキャストが不要になっている
```

## 受け入れ基準

- [x] アノテーションを外して `as const satisfies readonly PanelCatalogEntry[]` にし、`export const PANEL_CATALOG: readonly PanelCatalogEntry[] = CATALOG_ROWS;` と `export type PanelCatalogId = (typeof CATALOG_ROWS)[number]['id'];` に分離されている
- [x] 実行時の値・型は不変で、`DIRECT_FACTORIES` の欠けが型エラーになる
- [x] `:51` のキャストと `:83, :89` のキャストが削除可能になっている
- [x] `SIDEBAR_PANELS` のフィルタと `panelCatalog.test.ts` の golden list は型が変わっても通り続ける
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 型テスト: factory 欠けの型エラー（`@ts-expect-error` による pin）
- 既存テストが green。実時間待ちは使わない

## 見積もり

1 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/dashboard/panels/panelCatalog.ts`（CATALOG_ROWS 分離 + union 復元 + resolve の `as` 削除）、`src/dashboard/panels/panelFactories.ts`（`as Record<string,...>` 削除 + static 判定の先行）、`src/dashboard/panels/DashboardBootstrapper.ts`（ループのみ CATALOG_ROWS 化）、`src/dashboard/panels/__tests__/panelCatalog.test.ts`（網羅ループのみ CATALOG_ROWS 化）
- 統合修正: `as const` 化で行型がリテラルに狭まり `resolvePanelIdForTab` / `resolvePanelIdForSection` で型エラー（tabParam の不存在・tuple への includes）が出たため、find の述語引数を `PanelCatalogEntry` に widen して統合側で修正。戻り値の union は維持
- ゲート: 対象 18 tests green / type-check PASS / lint 0 errors
