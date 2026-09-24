# PBI: fetchPeriodRows — パネルデータ読み込みシームの深化

## ユーザーストーリー
保守担当者として、ダッシュボードパネルのデータ取得が1つの深いモジュール経由で行われてほしい、なぜなら8重複ラッパーの失敗ポリシードリフト（サイレント空表示・誤 cap 通知）が実バグとして検出済みだから。

## 優先度
- 順位: 2 / 8（着手順 10）
- RICEスコア: 10.7（Reach=8 / Impact=2.0 / Confidence=100% / Effort=1.5pt）
- 根拠: 8パネルの loadRowsWithRetry が5種の失敗セマンティクスにドリフト（直近レビューで timeHeatmap/visitDuration の `?? []` 誤表示・cap 誤検知を実検出）。依存関係: PBI 11（periodFilter 契約）より先に着手（同一ファイル群を触るため直列の先頭）。

## BDD受け入れシナリオ
Scenario: 正常取得
  Given SQLite が初期化済みで期間内に rows がある
  When パネルが fetchPeriodRows({ since, until, limit }) を呼ぶ
  Then { rows, total, capped } が返り、since/until は SQL 側で適用される

Scenario: 永続的なクエリ失敗
  Given queryLogs がリトライ上限まで失敗する
  When fetchPeriodRows を呼ぶ
  Then throw され、呼び出し側パネルはエラー状態を表示できる（サイレント空表示にならない）

Scenario: cap 到達の検出
  Given 期間内の total が limit を超える
  When 取得が完了する
  Then capped: true が返り、呼び出し側は打ち切り通知を出せる（行数ヒューリスティクスを使わない）

## 受け入れ基準
- [x] src/dashboard/panels/asyncData/fetchPeriodRows.ts（または panels/ 直下）に新設: `fetchPeriodRows(options: { since?: number; until?: number; limit: number; tagFilter?: string }) → Promise<{ rows: BrowsingLogEntry[]; total: number; capped: boolean }>`
- [x] 失敗は throw（リトライは retryWithExponentialBackoff・maxAttempts 4・label は options で上書き可）
- [x] since/until の省略規約（exactOptionalPropertyTypes 対応のキー省略）をモジュール内に一元化
- [x] capped は `total > rows.length` で判定し、行数ヒューリスティクスを廃止
- [x] 8パネルのローカル loadRowsWithRetry を削除し fetchPeriodRows に置換（domainAnalysis の keyset ページングは fetchPeriodRows を1ページ取得ユニットとして利用）
- [x] tagClusterPanel のサイレント `?? []` も throw+エラー状態に統一（dashboardTimeHeatmapError と同型のエラー状態を tagCluster に追加）
- [x] 全パネルの既存 lifecycle テストがモック形状の更新のみで green

## テスト戦略
- 単体: fetchPeriodRows の新規テスト（正常/throw/capped/省略キー/etagFilter 透過）
- 統合: 8パネルの lifecycle テスト（モック形状更新のみ・アサーション弱体化禁止）
- 単体: domainAnalysis keyset ページングの既存テスト維持

## 実装メモ
- 配置: src/dashboard/panels/ 配下（パネル専用。dashboardSqliteService は移動しない）
- periodFilter 契約（PBI 11）には触れない — 本 PBI はロード経路のみ
- PanelNotices（PBI 14）には触れない — エラー表示は既存の catch パターンを維持

## 見積もり
1.5 SP（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（文書要件がある場合のみ適用）

## 実装記録（2026-09-24 arch-delivery-loop）
- 実装: src/dashboard/panels/fetchPeriodRows.ts 新設（{rows,total,capped}・throw-on-failure・pickDefined によるキー省略の一元化・label/maxAttempts 注入可）・8パネルのプライベートラッパー削除（loadRowsWithRetry 参照ゼロ）・domainAnalysis は keyset ループを維持し1ページ=1 fetchPeriodRows 呼び出しに・tagClusterPanel は tagClusterError キー（EN/JA）付きエラー状態を追加
- 逸脱（記録済み）: options の optional フィールドは `since?: number | undefined` 形（exactOptionalPropertyTypes 下でリテラル呼び出し形状を保つため）。キー省略規約はモジュール内 pickDefined が単独所有。tagClusterPanel の catch に seq チェック追加（stale load が新描画を上書きしない）
- 検証: type-check PASS / 対象 13 ファイル 146 tests green + 追加保険 17 ファイル 166 tests
- 備考: GitHub PR レビューはユーザー作業として残置
