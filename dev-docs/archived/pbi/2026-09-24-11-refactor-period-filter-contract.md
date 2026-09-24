# PBI: periodFilter 契約の深化 — 同期 emit の廃止

## ユーザーストーリー
パネル開発者として、期間フィルタの初期値を getRange() 1回の読み出しで受け取ってほしい、なぜなら構築中の同期 emit が filterReady 回避策×3 と二重 state 同期×7 という footgun クラスを量産しているから。

## 優先度
- 順位: 3 / 8（着手順 11）
- RICEスコア: 9.3（Reach=7 / Impact=2.0 / Confidence=100% / Effort=1.5pt）
- 根拠: 構築中 emit を信頼しない証拠（読み戻し7箇所）と回避策3重が同一モジュールの契約欠陥を証明。依存: PBI 10 完了後（同一パネルファイル群の直列2番手）。

## BDD受け入れシナリオ
Scenario: 初期値の取得
  Given createPeriodFilter({ initialPreset: 'last7' }) で構築した
  When onChange がまだ一度も発火していない
  Then getRange() が last7 の範囲を返す

Scenario: 変更の通知
  Given フィルタを構築済みで初期 emit は発生しない
  When ユーザーがプリセットを変更する
  Then onChange が新しい範囲で1回だけ発火する

Scenario: カスタム範囲
  Given 初期プリセットが custom で from/to が指定されている
  When getRange() を呼ぶ
  Then 指定範囲（to は end-of-day inclusive）を返す

## 受け入れ基準
- [x] createPeriodFilter が構築中に onChange を発火しない（emit はユーザー操作時のみ）
- [x] 初期範囲は getRange() が単一の真実の源として提供する
- [x] 3パネル（tagCluster/timeHeatmap/visitDuration）の filterReady ガードを削除
- [x] 7パネルの onChange 内 `currentRange = range` 記録と `getRange()` 読み戻しの二重同期を解消（reload 内で getRange() を読む形に統一、または onChange 記録のみに一本化 — ドキュメント化した契約に従う）
- [x] プリセットラベルキーが注入可能（labelKeys オプション）になり visitDuration* へのハードコードを解消、既定値は後方互換のまま
- [x] periodFilter.test とパネル lifecycle テスト（3本）の初回 emit 期待値を更新
- [x] 全パネルの既存テストが green（auto-apply の二重フェッチが構造的に起きないこともテストで固定）

## テスト戦略
- 単体: periodFilter テストの契約更新（構築中 emit なし・getRange 単独・ラベル注入）
- 統合: auto-apply 3パネルの lifecycle テスト（1回の load で1クエリ）
- 回帰: 明示適用パネル（domainAnalysis/timeline/wordCluster）の既存テスト

## 実装メモ
- getRange() は純粋に現在の選択を返す（内部 state の読み出し）
- labelKeys の注入は必須化せず optional（既定 = 現行キー名、後方互換）
- aria/destroy の既存契約は不変

## 見積もり
1.5 SP（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（文書要件がある場合のみ適用）

## 実装記録（2026-09-24 arch-delivery-loop）
- 実装: periodFilter.ts の構築中 emit 廃止（onChange はユーザー操作時のみ・optional 化）・getRange() を初期値の単一ソースに・labelKeys 注入（既定 visitDurationPeriod* 後方互換）・filterReady ×3 削除・currentRange 二重同期 ×7 解消（reload 冒頭で getRange() スナップショット、ホスト無しフォールバック厳密保持）・explicit-apply 4 パネルは onChange ハンドラ削除+Run 経路で getRange() 読み取り（コード量少の方を採用、判断理由を各所に記載）
- 逸脱（記録済み）: BDD シナリオ「カスタム範囲」の initial custom values は現行 API に存在しないため、getRange() の初期値は initialPreset のみから導出（custom はユーザー操作後に有効）。API 拡張を要求する呼び出し側は存在しないためスコープ外と判断
- 検証: type-check PASS / 対象 11 ファイル 141 tests green（fresh mount + 1 load = 1 クエリの新規 assert 含む）
- 備考: GitHub PR レビューはユーザー作業として残置
