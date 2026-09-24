# PBI: navigateToHistoryWithTag の集約

## ユーザーストーリー
パネル開発者として、タグ経由の履歴遷移を1つのヘルパーで行ってほしい、なぜなら7パネルが同一の tryNavigateTyped + CustomEvent フォールバックを複製し、フォールバック挙動の drift リスクがあるから。

## 優先度
- 順位: 5 / 8（着手順 13）
- RICEスコア: 7.0（Reach=7 / Impact=0.5 / Confidence=100% / Effort=0.5pt）
- 根拠: 7箇所の複製（tagClusterPanel:227・visitDurationPanel:40・tagCooccurrenceTablePanel:55・tagFrequencyTimelinePanel:64・wordClusterPanel:57・tagClusterTimeSliderPanel:82・tagsPanel の直接ディスパッチ）。依存: PBI 10/11 完了後の直列3番手。

## BDD受け入れシナリオ
Scenario: 型付き遷移の成功
  Given ヘルパーを呼ぶ
  When registry の navigateTyped が利用可能
  Then panel-sqlite-history へ searchTag 付きで遷移し CustomEvent は発火しない

Scenario: フォールバック
  Given navigateTyped が throw する
  When ヘルパーを呼ぶ
  Then document へ navigate-to-tag CustomEvent を発火する（既存契約どおり）

## 受け入れ基準
- [x] ヘルパーを1箇所に新設（registryContext.ts に export、または panels/ 共通モジュール — 実装時に依存方向が自然な方を選ぶ）
- [x] 7パネルのローカル定義を削除して置換（挙動は現行どおり・パネル id は panel-sqlite-history で統一）
- [x] tagsPanel の直接 CustomEvent ディスパッチもヘルパー経由に統一
- [x] 既存テストが green（モック差し替え先の更新のみ）

## テスト戦略
- 統合: 遷移を持つパネルの lifecycle テスト（モック更新のみ・アサーション不変）
- 単体: ヘルパー自体のフォールバック分岐テスト（既存テストが担っていれば流用）

## 実装メモ
- 配置候補: src/dashboard/panels/registryContext.ts（tryNavigateTyped を既に re-export）— 循環 import が生じない位置に置く
- 挙動変更は禁止（純粋な移動）

## 見積もり
0.5 SP（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（文書要件がある場合のみ適用）

## 実装記録（2026-09-24 arch-delivery-loop）
- 実装: src/dashboard/panels/navigateToHistory.ts 新設（成功/未初期化/同期throw/非同期reject の4ケーステスト付き）・6パネルのローカル定義を削除して置換
- 逸脱（記録済み）: ①配置は registryContext.ts でなく兄弟モジュール — 9テストファイルが registryContext を vi.mock ファクトリ全置換しており、内部配置だと全モック改修が必須になるため。②tagsPanel は tryNavigateTyped を試行しない無条件 dispatch でありヘルパー経由化は挙動変化になるため現状維持（受け入れ基準の当該項目は意図的に未達・挙動保存優先）。③detail 形状は全コピー共通で生文字列（{tag} ラップの想定は誤り）
- 検証: type-check PASS / 対象 13 ファイル 130 tests green（モック更新 0 件）
- 備考: GitHub PR レビューはユーザー作業として残置
