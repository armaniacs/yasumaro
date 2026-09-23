# PBI: タグ共起ペアランキング

## ユーザーストーリー
分析利用者として、タグ共起ペア top 20 を表形式で確認したい、なぜならグラフが苦手でも数字でタグ間の共起構造を把握できるから

## 優先度
- 順位: 着手順 06（RICE順位 6 / 13候補中）
- RICEスコア: 2.40（Reach=3 / Impact=1.0 / Confidence=80% / Effort=1pt）
- 根拠: 既存 WASM 出力の別表現であり計算ロジックの新規実装が不要で工数最小。グラフ描画が苦手な利用者に数字で共起構造を提供できる

## BDD受け入れシナリオ
Scenario: 期間全体の共起ペア top 20 を表で確認する
  Given 履歴レコードが複数タグ付きで保存されている
  When 利用者がタグ未選択・期間未指定でランキングを開く
  Then ペア（#A × #B）/ 共起数 / Aの個別出現数 / Bの個別出現数の4列で上位20件が共起数の降順に表示される

Scenario: 特定タグ選択時に共起相手の一覧を確認する
  Given タグ「読書」を含むレコードが存在する
  When 利用者がタグ「読書」を選択する
  Then 「読書」を含むペアのみが共起数降順で表示され、個別出現数も正しく表示される

Scenario: 共起ペアが存在しない場合は空状態を表示する
  Given 全レコードが単一タグのみで構成されている
  When 利用者がランキングを開く
  Then 空状態メッセージが表示され、表本体は表示されない

Scenario: 選択タグに共起相手が存在しない場合は空状態を表示する
  Given 選択したタグを含む全レコードが単一タグのみである
  When 利用者がそのタグを選択する
  Then 共起相手なしの旨の空状態メッセージが表示される

Scenario: 同件数タイは決定的な順序で表示される
  Given 共起数が同一のペアが複数存在する
  When ランキングを表示する
  Then 共起数降順、同数の場合はペア名の辞書順で安定した順序になる

Scenario: top 20 を超えるペアは切り捨てを通知する
  Given 共起ペアが21件以上存在する
  When ランキングを表示する
  Then 上位20件のみ表示され、切り捨て発生の通知が表示される

Scenario: 10000行 cap を超えるデータでも期間絞り込みで表示できる
  Given 履歴が10000件を超えて保存されている
  When 利用者が期間フィルタで対象を10000件以内に絞る
  Then 絞り込んだ範囲の共起ペア top 20 が表示される

## 受け入れ基準
- [x] タグ未選択時は全体を対象に共起数降順の top 20 が表形式で表示される
- [x] タグ選択時は選択タグを含むペアのみが対象となり、期間フィルタ（任意）と組み合わせできる
- [x] 表の列はペア（#A × #B）/ 共起数 / Aの個別出現数 / Bの個別出現数の4列である
- [x] 同件数タイは共起数降順＋ペア名辞書順の決定的な順序で表示される
- [x] 行クリックでペアの最初のタグにより navigateToHistoryWithTag で履歴へ遷移する（両タグの AND 絞り込みは v1 スコープ外）
- [x] MAX_TAG_CLUSTER_TAGS=50 による事前絞り込みで切り捨てが発生した場合は truncatedNotice パターンで通知される
- [x] top 20 切り捨て発生時は切り捨て通知が表示される
- [x] 共起ペア 0 件時は空状態メッセージが表示され、表本体は表示されない

## テスト戦略
- E2E: Dashboard でランキングを開き、タグ選択・期間指定・行クリックによる履歴遷移・空状態・切り捨て通知の表示を確認する
- 統合: queryLogs の since / until / tagFilter / limit（cap 10000）による絞り込み結果が表の入力となり、期間フィルタ部品との連携が動作することを確認する
- 単体: edges の降順ソート・タイ時の辞書順・top 20 切り捨て判定・個別出現数の nodes 照合・空状態分岐をテストする

## 実装メモ
- 再利用資産:
  - `src/dashboard/tagCooccurrenceHybrid.ts` の `computeTagCooccurrenceHybrid(rows)` が返す `{ nodes: [{tag, count}], edges: [{source, target, weight}] }` の `edges` をそのままランキング入力に使用する（グラフ描画・force layout は不要）
  - WASM コア `src/wasm/tag-cooccur/` と TS フォールバックは既存の Hybrid 経路で利用し、共起計算の再実装は行わない
  - 事前絞り込みは `src/utils/computeLimits.ts` の `narrowEntriesToTopTagsHybrid(rows, MAX_TAG_CLUSTER_TAGS=50)` を使用する
  - データ取得は `queryLogs()` の `{since, until, tagFilter, limit cap 10000}` を使用し、日付絞り込みは SQL 側で行う
  - 行クリック遷移は `src/dashboard/tagClusterPanel.ts` の `navigateToHistoryWithTag(tag)` / `tryNavigateTyped('panel-sqlite-history', {searchTag})` パターンを踏襲し、ペアの最初のタグを渡す
  - 切り捨て通知はタグクラスタパネルの `truncatedNotice` 要素パターンを踏襲する
- 表 UI のアプローチ:
  - 新規パネルとして table 要素で描画し、既存の tagClusterPanel.ts のようなグラフ描画は行わない
  - 列構成はペア / 共起数 / Aの個別出現数 / Bの個別出現数とし、個別出現数は `nodes` の `count` をタグ名で照合して取得する
  - 既存パネルに表描画は存在しないため新規実装とし、ソート順は共起数降順＋ペア名辞書順の決定的順序を既定とする
- 共有期間部品への依存:
  - 期間フィルタは `src/dashboard/components/periodFilter.ts`（PBI 2026-09-24-02 で新設）を再利用する
  - 当該部品が未導入の場合は本 PBI に着手しない
- i18n キー一覧（EN+JA、両方の `public/_locales/en/messages.json` と `public/_locales/ja/messages.json` に追加し、表示側は data-i18n を使用）:
  - `cooccurrenceTableTitle` / `cooccurrenceTableDescription`
  - `cooccurrenceTableColPair` / `cooccurrenceTableColCooccurCount` / `cooccurrenceTableColCountA` / `cooccurrenceTableColCountB`
  - `cooccurrenceTableEmpty` / `cooccurrenceTableEmptyForTag`
  - `cooccurrenceTableTruncatedTop20` / `cooccurrenceTableTruncatedTopTags`
  - `cooccurrenceTableTagFilterLabel` / `cooccurrenceTableTagFilterAll`
- a11y 要件:
  - WCAG 2.1 AA に準拠し、table に caption と th scope を付与する
  - 行クリック遷移はキーボード操作可能にする（フォーカス可能な行または行内リンク、Enter / Space で発火）
  - ソート済みであることが支援技術に伝わる構成にし、空状態と切り捨て通知は data-i18n 対応のテキストで提供する

## 見積もり
1 SP（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（文書要件がある場合のみ適用）

## 実装記録（2026-09-24 autonomous-task-closer）
- 実装: `src/dashboard/tagCooccurrenceTable.ts`（`buildCooccurrencePairRows` 純粋ヘルパー・ペア正規化・weight 降順+辞書順タイ・top-20 truncation・単一タグフィルタモード）、`src/dashboard/panels/asyncData/tagCooccurrenceTablePanel.ts`（既存 edges 再利用・グラフ描画なし・フォーカス可能行+Enter/Space で遷移・空状態3区分・truncation 通知2種）、配線（catalog/factories/index.html/locales 17キー×2/panelCatalog pinned 22→23）
- 設計決定: タグ選択は自由入力でなく取得済みノードの `<select>`（タイプミスで黙って0件にならない・個別出現数の意味論が正しく保たれる・キャッシュ O(E) 再ランキングで再取得不要）。stale 選択は All にリセット。select 切替時に pre-narrowing 通知が消える実バグを実装中に発見し修正・ライフサイクルテストで固定
- 検証: type-check PASS / 対象 78 tests green / lint 0 errors / 全体 13,694 tests green / build PASS
- 備考: GitHub PR レビューはユーザー作業として残置
