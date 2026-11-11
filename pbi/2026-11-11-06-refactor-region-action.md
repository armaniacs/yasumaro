# PBI: region render+wire骨格の共通化

## ユーザーストーリー
開発者として、ask/report系regionの配線骨格が共通ヘルパーに集約されてほしい、なぜなら「取得→click→busy→try→status遷移」の同一骨格が3複製あると第4region追加時に複製が増え、二重実行ガードの改善が波及しないから。

## 優先度
- 順位: 3/3 (Round 2)
- RICE: 0.8 (Reach=3 / Impact=1 / Confidence=0.8 / Effort=3)
- 根拠: 将来の複製抑止・ガード統一。小規模。
- 依存: 04完了後 (同一view群に触るため直列)

## 現状 (file:line付き・要実装時再確認)
- `src/dashboard/panels/asyncData/askHistoryPanelView.ts:97-142` renderAskHistoryRegion / `:144-161` status helpers。
- `src/dashboard/panels/asyncData/researchReportPanelView.ts:207-244` / `:275-317` (同一骨格2件目)。
- status div定型: askHistoryPanelView `:85` / researchReportPanelView `:197,262` / domainAnalysisPanel `:195` / tagsPanel `:282`。

## BDD受け入れシナリオ

```gherkin
Scenario: ask/reportの操作結果表示が変わらない
  Given ask・reportの各regionで実行・成功・失敗させる
  When status遷移を確認する
  Then busy→成功/失敗→例外の文言・状態は変更前と一致する

Scenario: 二重実行ガードが統一される
  Given 実行中にボタンを連打する
  When ガードを確認する
  Then 二重実行されない (全region同一挙動)
```

## 受け入れ基準
- [x] (1) `runRegionAction` (仮称) ヘルパーが新設されbusy→成功/失敗→例外の遷移が一元化される
- [x] (2) ask・reportの3箇所が委譲し、挙動parityテストが緑
- [x] (3) status div定型が定数化される (in-row描画のsqliteHistory pending行は対象外と明記。tagsPanelは同名ファイル不存在のため対象外)
- [x] (4) 既存dashboardテスト全件緑

## テスト戦略
- parityテスト: status遷移の前後比較。
- 単体テスト: ヘルパーの成功/失敗/例外分岐。
- 回帰: dashboard panelsテスト全件。

## 見積もり
- S

## Definition of Done
- [x] 全BDDシナリオが自動テスト化され、すべてパスする
- [x] コードレビューが完了している
- [x] 受け入れ基準のすべての項目が満たされている

## 出典
- holistic-code-review 2026-11-11 Round 2 (DRYテーマ3)
