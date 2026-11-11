# PBI: collection-target selectビルダー重複の解消

## ユーザーストーリー
開発者として、コレクション選択UIのoptions構築が一箇所に集約されてほしい、なぜなら「全件option+保存列挙+escapeHtml」の同一式が3箇所に複製されていると表示変更・XSS対策が3倍コストになるから。

## 優先度
- 順位: 1/3 (Round 2)
- RICE: 2.0 (Reach=4 / Impact=1 / Confidence=1.0 / Effort=2)
- 根拠: 3箇所の表示統一・XSS面単一化。低難易度。
- 依存: R1-02完了後 (`sqliteHistoryChromeWiring.ts` の競合回避)

## 現状 (file:line付き・要実装時再確認)
- `src/dashboard/panels/asyncData/askHistoryPanelView.ts:72-73` options構築 / `:79` select。
- `src/dashboard/panels/asyncData/researchReportPanelView.ts:248-249` options構築 / `:255` select (CSSクラス・i18nキー以外同型)。
- `src/dashboard/panels/asyncData/sqliteHistoryChromeWiring.ts:42-45,59` sort select options + escapeHtml map join (同パターン3件目)。

## BDD受け入れシナリオ

```gherkin
Scenario: 3箇所の選択肢表示が変わらない
  Given 各パネルのselectを開く
  When 選択肢一覧が描画される
  Then 文言・順序・選択状態は変更前と一致する (golden)

Scenario: 新規パネルは共通ビルダーで作れる
  Given 新たにcollection selectが必要になった
  When 共通ビルダーを呼ぶ
  Then escape済みoptions付きselectが得られる
```

## 受け入れ基準
- [x] (1) `buildCollectionOptionsHtml` + `buildSelectHtml` (仮称) が新設モジュールに切り出される
- [x] (2) 3箇所が委譲し、描画golden一致が検証される
- [x] (3) selected付与 (ChromeWiringのみ) が引数で吸収される
- [x] (4) escapeHtml経路が維持されXSSテストが緑
- [x] (5) 既存dashboardテスト全件緑

## テスト戦略
- goldenテスト: 置換前後のselect HTMLをpin。
- 単体テスト: ビルダーのescape・selected分岐。
- 回帰: dashboard panelsテスト全件。

## 見積もり
- S

## Definition of Done
- [x] 全BDDシナリオが自動テスト化され、すべてパスする
- [x] コードレビューが完了している
- [x] 受け入れ基準のすべての項目が満たされている

## 出典
- holistic-code-review 2026-11-11 Round 2 (DRYテーマ1)
