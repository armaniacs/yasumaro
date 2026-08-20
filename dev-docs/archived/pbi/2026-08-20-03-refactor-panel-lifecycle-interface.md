# PBI: Panel Lifecycle Interface — 25ダッシュボードパネルの共通寿命サイクル定義

## ユーザーストーリー
開発者として、25のダッシュボードパネルが2つのアドホックなインターフェース（`AsyncDataPanel`、`StaticFormPanel`）とレガシーシェイプを実装している状態を解消したい。なぜなら、`NavigationRegistry`と`DashboardBootstrapper`が各シェイプを特別扱いしており、パネルの動作を理解するのにパネルファイル＋レジストリ＋ブートストラッパーの3ファイルを読む必要があるからだ。

## 優先度
- 順位: 03 / 5
- RICEスコア: (Reach=8 × Impact=2 × Confidence=0.8) / Effort=4 = 3.2
- 根拠: Impact 2（25パネルのテスト可能性向上）。ADR-2026-07-13 Candidate #1がこの問題を特定し「Panel抽象を先に定める」と結論。#5(Settings Schema)はこの後に着手する方が効果的

## BDD受け入れシナリオ
Scenario: 新規パネルがPanelLifecycleインターフェースを実装する
  Given 開発者が新しいダッシュボードパネルを作成する
  When `PanelLifecycle` interface（init, mount, load, destroy）を実装する
  Then ブートストラッパーが自動的にパネルを登録・ナビゲーション可能にする

Scenario: 既存パネルがレガシーシェイプのまま動作する
  Given `AsyncDataPanel` または `StaticFormPanel` を実装する既存パネルがある
  When ブートストラッパーがパネルを処理する
  Then レガシーシェイプを `PanelLifecycle` に変換するアダプタが内部的に適用される

Scenario: パネルのdestroy時にリソースが解放される
  Given ユーザーがパネルを切り替える
  When 現在のパネルの `destroy()` が呼出される
  Then イベントリスナーキャッシュ、ストレージリスナー、タイマーが解放される

## 受け入れ基準
- [ ] `PanelLifecycle` interface（init, mount, load, destroy）が定義される
- [ ] `NavigationRegistry` と `DashboardBootstrapper` が `PanelLifecycle` のみに依存する
- [ ] レガシーパネル用のアダプタが `PanelLifecycle` に変換する
- [ ] 25パネルすべてが動作し続ける（レガシー アダプタ経由でも可）
- [ ] 新規パネルは `PanelLifecycle` の実装が必須になる

## テスト戦略
- E2E: ダッシュボード起動→パネル切り替え→destroy時リソース解放の確認
- 統合: `NavigationRegistry` × `PanelLifecycle` × `DashboardBootstrapper`
- 単体: レガシーアダプタの変換ロジック、パネルの各ライフサイクルメソッド

## 見積もり
4人日

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
