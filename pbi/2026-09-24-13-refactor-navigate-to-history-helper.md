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
- [ ] ヘルパーを1箇所に新設（registryContext.ts に export、または panels/ 共通モジュール — 実装時に依存方向が自然な方を選ぶ）
- [ ] 7パネルのローカル定義を削除して置換（挙動は現行どおり・パネル id は panel-sqlite-history で統一）
- [ ] tagsPanel の直接 CustomEvent ディスパッチもヘルパー経由に統一
- [ ] 既存テストが green（モック差し替え先の更新のみ）

## テスト戦略
- 統合: 遷移を持つパネルの lifecycle テスト（モック更新のみ・アサーション不変）
- 単体: ヘルパー自体のフォールバック分岐テスト（既存テストが担っていれば流用）

## 実装メモ
- 配置候補: src/dashboard/panels/registryContext.ts（tryNavigateTyped を既に re-export）— 循環 import が生じない位置に置く
- 挙動変更は禁止（純粋な移動）

## 見積もり
0.5 SP（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（文書要件がある場合のみ適用）
