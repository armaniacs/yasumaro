# PBI: Model私設ガードの共有seam注入化

## ユーザーストーリー
開発者として、sqliteHistoryModelの世代ガードが注入可能であってほしい、なぜならModelが私設の `new ReloadGuard()` を抱えたままだと10パネルが収束した共有ringと二重実装になり、競合・破棄規約の改善が波及しないから。本PBIは全面分割ではなくring寄せの前提 (注入化) に限定する。

## 優先度
- 順位: 1/1 (Round 3)
- RICE: 1.2 (Reach=3 / Impact=1 / Confidence=0.8 / Effort=2)
- 根拠: 将来のring統一の前提作り。挙動不変の小幅変更。
- 依存: なし (Model本体のみ。PanelView側は触らない)

## 現状 (file:line付き・要実装時再確認)
- `src/dashboard/panels/asyncData/sqliteHistoryModel.ts:40`: `import { ReloadGuard } from './reloadGuard.js'`。
- `src/dashboard/panels/asyncData/sqliteHistoryModel.ts:608`: `const guard = new ReloadGuard();` 私設。
- 対照: `src/dashboard/panels/asyncData/asyncDataPanelLifecycle.ts:107-160` はring内でガードを所有し10パネルが採用。

## BDD受け入れシナリオ

```gherkin
Scenario: 既定では従来通り動作する
  Given ガードを指定せずModelを生成する
  When 並行リロードを発生させる
  Then 古い世代の結果が破棄され、表示は最新のみになる (従来通り)

Scenario: ガードを注入できる
  Given 共有ガード (またはモック) をdepsに渡す
  When Modelを生成してリロードする
  Then 渡したガードが使用される
```

## 受け入れ基準
- [x] (1) `SqliteHistoryModelDeps` に `reloadGuard?` が追加され、未指定時は従来通り私設生成される
- [x] (2) 既存の全呼び出しが変更なしで動作する (既定引数のみ)
- [x] (3) 注入ガード使用の単体テストが追加され緑
- [x] (4) 既存のModel系テスト全件緑
- [x] (5) PanelView・ChromeWiring側の変更なし

## テスト戦略
- 単体テスト: 注入ガードの使用検証 (モックで世代破棄を確認)。
- 回帰: sqliteHistoryModel系テスト全件。

## 見積もり
- S

## Definition of Done
- [x] 全BDDシナリオが自動テスト化され、すべてパスする
- [x] コードレビューが完了している
- [x] 受け入れ基準のすべての項目が満たされている

## 出典
- holistic-code-review 2026-11-11 Round 1 (SoCテーマ3の段階着手)
