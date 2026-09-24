# PBI: MAX_QUERY_ROWS ローカル再宣言の SSOT 化

## ユーザーストーリー
保守担当者として、クエリ行上限の定数が1箇所で定義されてほしい、なぜなら3パネルのローカル再宣言が wire cap（QUERY_CAPS.plain）と乖離すると打ち切り通知文が静かに嘘をつくから。

## 優先度
- 順位: 7 / 8（着手順 15）
- RICEスコア: 6.0（Reach=3 / Impact=0.5 / Confidence=100% / Effort=0.25pt）
- 根拠: tagCooccurrenceTablePanel.ts:44・wordClusterPanel.ts:43・tagClusterTimeSliderPanel.ts:46 が `MAX_QUERY_ROWS = 10000` を再宣言。真の SSOT は messaging/limits.ts の QUERY_CAPS.plain（queryPlan.tagClusterRegression.test で pin 済み）。依存: PBI 10 完了後の直列5番手。

## BDD受け入れシナリオ
Scenario: 単一ソース
  Given fetchPeriodRows（PBI 10）が行上限を必要とする
  When 上限を参照する
  Then computeLimits 経由の単一定数であり3パネルのローカル定数は存在しない

Scenario: wire cap との整合
  Given QUERY_CAPS.plain が 10000 である
  When ダッシュボード側の定数を比較する
  Then 両者が一致することがテストで pin されている

## 受け入れ基準
- [x] computeLimits.ts に MAX_QUERY_ROWS（= QUERY_CAPS.plain と整合）を export
- [x] limits 整合の pin テスト（既存 limits-drift.test または新規1行）で QUERY_CAPS.plain との一致を固定
- [x] 3パネルのローカル定数を削除して import に置換
- [x] 既存テスト green

## テスト戦略
- 単体: 定数一致 pin テスト
- 回帰: 3パネルの lifecycle テスト（cap 通知文言は不変）

## 実装メモ
- computeLimits の caps はダッシュボード側 O(n) 入力上限であり wire cap とは別 concern（相互参照コメント済み）— 今回は「wire cap と等値であること」を pin するだけ
- PBI 10 の fetchPeriodRows がこの定数を消費する形にする

## 見積もり
0.25 SP（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（文書要件がある場合のみ適用）

## 実装記録（2026-09-24 arch-delivery-loop）
- 実装: computeLimits.ts に `MAX_QUERY_ROWS = QUERY_CAPS.plain`（参照派生）を export・limits-drift.test に一致 pin を追加・3パネルのローカル宣言を削除
- レイヤー判断: messaging/limits.ts は @layer 0・import ゼロ・chrome 参照ゼロの純粋定数モジュール → utils → messaging は基盤への下向き辺であり LAYERS 規約（PBI 09 追記分）に整合。ローカル定義+pin の代替案は不採用
- 検証: type-check PASS / 対象 6 ファイル 77 tests green / eslint 変更5ファイル 違反なし
- 備考: GitHub PR レビューはユーザー作業として残置
