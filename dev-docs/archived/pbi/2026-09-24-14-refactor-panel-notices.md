# PBI: PanelNotices — 通知/空状態モジュール

## ユーザーストーリー
パネル開発者として、空状態・エラー・通知の表示を1つの深いモジュールに委ねてほしい、なぜなら8パネルの手動配線が5種の失敗ポリシーにドリフトし false-empty / stale-notice バグが実検出済みだから。

## 優先度
- 順位: 6 / 8（着手順 14）
- RICEスコア: 6.4（Reach=8 / Impact=1.5 / Confidence=80% / Effort=1.5pt）
- 根拠: setEmptyStateMessage ×5・hideNotices + リセットダンス ×8（~30行/パネル）。依存: PBI 10 完了後（fetchPeriodRows が capped/throw を所有するため通知はそれを消費する形に）。直列4番手。

## BDD受け入れシナリオ
Scenario: 空状態の表示
  Given PanelNotices に empty 要素が登録されている
  When notices.showEmpty() を呼ぶ
  Then empty 要素が data-i18n='…Empty' の通常文言で表示される

Scenario: エラー状態への切替
  Given 直近の load が throw した
  When notices.showError('…Error', fallback) を呼ぶ
  Then 同一要素がエラー文言に切り替わって表示される

Scenario: 次回 load 開始時のリセット
  Given エラー状態が表示されている
  When 新しい load が始まる
  Then notices.reset() で通常の data-i18n 結合に戻り全通知が隠れる

## 受け入れ基準
- [x] PanelNotices モジュール新設: 要素の名前付き登録、show/hide/setMessage、data-i18n 属性同期の所有
- [x] empty と error を同一要素の2モードとして統一（リセットで通常文言に復帰）
- [x] 8パネルの hideNotices / リセットダンス / setEmptyStateMessage を PanelNotices 経由に置換
- [x] 失敗ポリシーの統一: 永続失敗時はエラー文言、0行時は空文言（fetchPeriodRows の throw/capped と組み合わせ）
- [x] 特殊通知（未計測率・除外数・truncation）は per-panel 表示のまま PanelNotices の hide 管理に登録できる
- [x] 全パネル lifecycle テスト green（文言アサーションは現行どおり）

## テスト戦略
- 単体: PanelNotices の新規テスト（show/hide/setMessage/reset・冪等性）
- 統合: 8パネル lifecycle テスト（エラー状態・空状態・通知リセットのアサーション追加）

## 実装メモ
- 配置: src/dashboard/panels/（asyncData 専用としない — sidebar 系パネルも将来的に利用可）
- MV3 CSP: data-i18n 属性の書き換えは既存パターン（textContent + setAttribute）を踏襲
- domainAnalysis の (unknown) 通知など fetch スコープ通知の「再集計で消さない」要件（tagCooccurrenceTablePanel 先例）を hide 管理で表現できること

## 見積もり
1.5 SP（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（文書要件がある場合のみ適用）

## 実装記録（2026-09-24 arch-delivery-loop）
- 実装: src/dashboard/panels/PanelNotices.ts 新設（register/show/hide/hideAll/setEmptyMessage/showEmpty/showError/reset/resetForReaggregate/clear・textContent+setAttribute のみ）・8パネルの hideNotices/リセットダンス/setEmptyStateMessage 群を置換・失敗ポリシー統一（cooccurrenceTable/timeline/domainAnalysis の false-empty をエラー文言に変更、新 i18n キー3種×2 locale）・reset()=フルリセット / resetForReaggregate()=fetchScoped 生存の2モード契約を docstring に明文化
- 逸脱（記録済み）: tagCluster の truncatedNotice が reload 開始で隠れていなかった stale ドリフトを reset() 統一により修正・wordCluster の reset 後到達不能な冗長 hidden 操作を削除
- 検証: type-check PASS / 対象 14 ファイル 158 tests green（PanelNotices 11 含む）
- 備考: GitHub PR レビューはユーザー作業として残置
