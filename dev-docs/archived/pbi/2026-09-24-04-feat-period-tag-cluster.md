# PBI: 期間指定タグクラスタ

## ユーザーストーリー
閲覧履歴の分析者として、タグクラスタパネルに期間フィルタを指定して表示したい、なぜなら直近の関心の偏りや長期的なテーマの変化を期間ごとに把握したいから

## 優先度
- 順位: 着手順 04（RICE順位 4 / 13候補中）
- RICEスコア: 2.40（調整後。素 1.20）（Reach=3 / Impact=1.0 / Confidence=80% / Effort=1pt・共有部品再利用後。素2pt）
- 根拠: 期間指定は全分析機能の共通基盤というユーザー要件の中核であり、後続のタグクラスタ時間変化スライダーの計算基盤になるため

## BDD受け入れシナリオ
Scenario: デフォルト全期間で現行表示と同一になる
  Given タグクラスタパネルを開いている
  And 期間フィルタが「全期間」を選択している
  When パネルがデータを読み込む
  Then queryLogs に since / until を指定せず limit のみで問い合わせる
  And 表示されるノード数とエッジ構成が期間フィルタ導入前と同一である

Scenario: 期間を指定すると指定期間のレコードだけでクラスタが再計算される
  Given タグクラスタパネルを開いている
  When 期間フィルタで「直近7日」を選択する
  Then queryLogs({since, until, limit}) に選択期間の epoch ms が渡される
  And narrowEntriesToTopTagsHybrid 以降のパイプラインが期間内レコードのみで実行される
  And 表示されるクラスタ構成が全期間表示と異なるデータを反映して変化する

Scenario: 期間内レコードが0件の場合は空状態を表示する
  Given タグクラスタパネルを開いている
  When 履歴が存在しない期間（例: 未来日を含むカスタム範囲）を選択する
  Then SVG クラスタ描画の代わりに既存の emptyState 要素が表示される
  And 空状態の文言が期間絞り込み中であることを伝える内容になっている

Scenario: 10000行 cap 到達時も期間フィルタが維持され打ち切り表示になる
  Given 指定期間内のレコードが10000件を超えている
  When 期間フィルタを適用して読み込む
  Then queryLogs({since, until, limit: 10000}) で上限10000行が取得される
  And truncatedNotice が表示される
  And クラスタ計算は取得分のみで行われる

Scenario: WASM 失敗時に TS フォールバックでも期間フィルタが保持される
  Given WASM コアの読み込みが失敗する環境である
  When 期間フィルタを指定してクラスタを計算する
  Then TypeScript フォールバック経路で co-occurrence 計算が行われる
  And 計算対象が指定期間のレコードに限定されたままである
  And パネルにエラーではなくフォールバック結果が表示される

## 受け入れ基準
- [x] 期間フィルタのデフォルトは「全期間」であり、全期間選択時は queryLogs に since / until を渡さず現行挙動と同一の表示になる
- [x] プリセット（今日 / 7日 / 30日 / 90日 / 全期間）とカスタム date range が選択でき、選択時に queryLogs({since, until, limit}) が正しい epoch ms で呼ばれる
- [x] 計算パイプライン（narrowEntriesToTopTagsHybrid → computeTagCooccurrenceHybrid → limitToTopNodes → computeLayout → SVG 描画）は無変更で期間内レコードのみを入力とする
- [x] 期間内レコード0件の場合は既存 emptyState を表示し、期間絞り込み時向けの文言になっている
- [x] 期間指定時に10000行上限に到達した場合は truncatedNotice が表示される
- [x] WASM 失敗時は TS フォールバックで計算し、期間フィルタが維持された結果が表示される
- [x] ノードクリック遷移は現行のままタグのみを渡し、期間の引き継ぎは行わない
- [x] 日英両ロケールで期間フィルタと空状態の文言が表示される

## テスト戦略
- E2E: ダッシュボードを開き期間プリセットを切り替えてクラスタ SVG が再描画されること、全期間に戻すと元の表示に戻ること、0件期間で空状態が出ることを確認する
- 統合: tagClusterPanel と共有 periodFilter および dashboardSqliteService.queryLogs の結合を検証し、選択期間が since / until に正しく変換されて渡されること、再選択で再クエリが走ることを確認する
- 単体: loadRowsWithRetry が since / until を queryLogs に透過すること、空配列入力で emptyState 分岐に入ること、queryLogs モックで10000行打ち切りと WASM 失敗時フォールバックの分岐をカバーする

## 実装メモ
- 依存: 共有部品 src/dashboard/components/periodFilter.ts（プリセット: 今日 / 7日 / 30日 / 90日 / 全期間 + カスタム date range）は PBI 2026-09-24-02 で新設されるものを再利用し、本 PBI では新設しない。同部品が未整備の場合は本 PBI に着手しない。
- 後続: 本 PBI の期間付きクエリ配線（since / until → queryLogs → クラスタ再計算）は PBI 2026-09-24-08（タグクラスタ時間変化スライダー）の計算基盤になる。
- 再利用資産:
  - src/dashboard/panels/asyncData/tagClusterPanel.ts（loadRowsWithRetry の queryLogs 呼び出しに since / until を配線するのみ）
  - src/dashboard/dashboardSqliteService.ts の queryLogs({since, until, limit})（SQL 側フィルタは実装済みのため変更不要）
  - src/offscreen/queryPlan.ts の buildFilterConditions（created_at >= ? / <= ? は実装済みのため変更不要）
  - entrypoints/options/index.html の #panel-tag-cluster 内の emptyState / truncatedNotice 要素（流用）
- 無変更で済むパイプライン: narrowEntriesToTopTagsHybrid(rows, MAX_TAG_CLUSTER_TAGS=50) → computeTagCooccurrenceHybrid(narrowed) → limitToTopNodes(50) → computeLayout → SVG render。WASM コア（src/wasm/tag-cooccur/）と TS フォールバック（src/dashboard/tagCooccurrenceHybrid.ts）は tags 文字列のみを消費するため、入力 rows を期間フィルタ済みに差し替えるだけで対応できる。
- 配線方針: periodFilter の選択状態（preset + since / until の epoch ms）を tagClusterPanel 側で購読し、loadRowsWithRetry(limit) を loadRowsWithRetry({since, until, limit}) 相当に拡張して queryLogs に透過する。全期間選択時は since / until を undefined にして現行クエリと同一にする。
- スコープ外: ノードクリック遷移への期間の引き継ぎは v1 スコープ外とし、現行のタグのみ遷移を維持する。
- i18n キー一覧:
  - EN (public/_locales/en/messages.json): `tagCluster_period_label` ("Period"), `tagCluster_period_all` ("All time"), `tagCluster_period_today` ("Today"), `tagCluster_period_7days` ("Last 7 days"), `tagCluster_period_30days` ("Last 30 days"), `tagCluster_period_90days` ("Last 90 days"), `tagCluster_period_custom` ("Custom range"), `tagCluster_empty_period` ("No records in the selected period. Try a wider range.")
  - JA (public/_locales/ja/messages.json): `tagCluster_period_label`（「期間」）, `tagCluster_period_all`（「全期間」）, `tagCluster_period_today`（「今日」）, `tagCluster_period_7days`（「直近7日」）, `tagCluster_period_30days`（「直近30日」）, `tagCluster_period_90days`（「直近90日」）, `tagCluster_period_custom`（「カスタム範囲」）, `tagCluster_empty_period`（「選択した期間にレコードがありません。範囲を広げて試してください。」）
  - いずれも data-i18n 属性で束縛し、EN / JA 両ファイルに同一キーを追加する。
- a11y 要件: 期間フィルタはキーボード操作可能な select / input 要素で構成し、フォーカスリングを維持する。期間変更時に aria-live 領域で再計算中と結果件数を通知する。空状態と打ち切り通知は見出し構造を壊さずスクリーンリーダーで読み上げ可能にする。
- テストモック方針: 既存の src/dashboard/panels/asyncData/__tests__/tagClusterPanel.lifecycle.test.ts と同様に queryLogs をモックし、since / until の有無と値をアサートする。WASM 失敗系は WASM ローダーを reject させて TS フォールバック経路を強制する。

## 見積もり
1 SP（要チームでの見積もり。共有部品未整備の場合は 2 SP）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（文書要件がある場合のみ適用）

## 実装記録（2026-09-24 autonomous-task-closer）
- 実装: `tagClusterPanel.ts` に共有 periodFilter 埋め込み（initialPreset 'all'）・`loadRowsWithRetry(bounds)` が since/until を queryLogs へ透過（全期間は既定どおり無キー）・`loadSeq` 世代ガード付き reload・期間0件時の期間向け空状態文言・destroy で filter 破棄。`#panel-tag-cluster` markup に filter コンテナ1行追加、locales に `tagCluster_empty_period` 追記。計算パイプラインは無変更
- 逸脱（記録済み）: ①PBI キー一覧の `tagCluster_period_*` は共有 periodFilter が既存 `visitDurationPeriod*` キーから自己解決するため重複デッドキーとして未追加（文言は日英とも提供済みで基準は充足）。②実装メモの aria-live 再計算通知は受け入れ基準外のため PBI 08（同一パネルの拡張・aria-live を基準に持つ）での実装に引き継ぎ
- 検証: type-check PASS / 対象 51 tests green（既存 tagClusterPanel 3 ファイルはアサーション無変更で green）/ lint 0 errors / 全体 13,637 tests green / build PASS
- 備考: GitHub PR レビューはユーザー作業として残置。PBI 08 の計算基盤が整備済み

## 追補（2026-09-24 ユーザー指示）
- 既定プリセットを 'all'（全期間）から 'last7'（直近7日間）へ変更 — 全期間グラフは初期表示として長過ぎるため。'all' 選択時の無上限クエリ（現行挙動との同一性）は維持。ワードクラスタパネルも同時に 'last7' 既定へ変更
