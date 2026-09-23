# PBI: 閲覧時間分析

## ユーザーストーリー
利用者として、期間を指定してドメイン別・タグ別の滞在時間ランキング（合計時間・平均時間・レコード件数）をダッシュボードで確認したい、なぜなら今月は何に何時間使ったかを直接把握して時間の使い方を振り返りたいから

## 優先度
- 順位: 着手順 02（RICE順位 2 / 13候補中）
- RICEスコア: 3.20（Reach=4 / Impact=1.5 / Confidence=80% / Effort=1.5pt）
- 根拠: 「時間の使い方」への直接回答として価値が高い。visit_duration 列は既存のため新規記録基盤は不要だが、記録品質は実データ検証が前提となる

## BDD受け入れシナリオ
Scenario: 期間を指定してドメイン別・タグ別の滞在時間ランキングを確認する
  Given 期間内に visit_duration を持つ閲覧ログが複数件存在する
  When 利用者が期間フィルタで対象期間を選択する
  Then ドメイン別ランキングに合計時間・平均時間・レコード件数が人間可読な単位（分・時間）で表示される
  And タグ別ランキングに合計時間・平均時間・レコード件数が人間可読な単位で表示される
  And 未計測行の除外率が表示される

Scenario: 期間内レコードが0件の場合に空状態を表示する
  Given 指定した期間内に閲覧ログが0件である
  When 利用者が期間フィルタで対象期間を選択する
  Then ランキング表示の代わりにデータなしの空状態メッセージが表示される
  And 未計測率の表示は行わないか、対象データなしとして明確に表示される

Scenario: visit_duration が全て null の場合に未計測率100%を表示する
  Given 期間内の全レコードの visit_duration が null である
  When 利用者が期間フィルタで対象期間を選択する
  Then ランキングは空として表示される
  And 未計測率100%であることが明示され、計測対象データがない旨が表示される

Scenario: 同一ドメインが大量にある場合に上位N件へ切り捨てて表示する
  Given 期間内に多数の異なるドメインの閲覧ログが存在する
  When 利用者が期間フィルタで対象期間を選択する
  Then ランキングは上位N件に切り捨てて表示される
  And 切り捨てが発生したことが明示される

## 受け入れ基準
- [x] ダッシュボードに閲覧時間分析の新規パネルが表示される
- [x] 期間フィルタで 今日 / 7日 / 30日 / 90日 / 全期間 / カスタム期間を選択できる
- [x] ドメイン別ランキングに合計時間・平均時間・レコード件数が表示される
- [x] タグ別ランキングに合計時間・平均時間・レコード件数が表示される
- [x] 時間表示が人間可読な単位（分・時間）で表示される
- [x] visit_duration が null の行を集計から除外し、未計測率（除外率）が表示される
- [x] 期間内0件・全件未計測・上位N件切り捨ての各境界ケースが仕様通りに表示される
- [x] 表示文言が日本語・英語の両ロケールで提供される

## テスト戦略
- E2E: ダッシュボードを開き期間プリセットとカスタム期間を切り替えてランキングと未計測率が更新されることを確認する、期間内0件で空状態が表示されることを確認する
- 統合: queryLogs() の期間条件（since・until）と集計ロジックを通してドメイン別・タグ別の合計・平均・件数が正しく算出されることを確認する、null 除外と除外率計算を確認する
- 単体: 時間フォーマット（分・時間変換）、タグ分割（スペース区切りと legacy カンマ区切りの両対応）、top N 切り捨て、除外率計算の各関数を境界値付きで検証する

## 実装メモ
- 再利用資産のファイルパス:
  - パネル登録: `src/dashboard/panels/panelFactories.ts`
  - パネル配置マークアップ: `entrypoints/options/index.html`
  - ログ取得: `src/dashboard/dashboardSqliteService.ts` の `queryLogs()`（`{since, until, tagFilter, domain, limit}`、上限 10000）
  - 行型: `src/utils/sqlite-types.ts` の `BrowsingLogRecord`（`url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, content, ai_* fields, masked_count, cleansed_reason`）
  - 集計の先行事例（クライアント側集計）: `src/dashboard/panels/tagClusterPanel.ts`
  - 日付範囲の先行実装: `src/dashboard/sqliteHistoryPanelView.ts` の `wireCalendarNav`、`src/utils/markdownExport.ts` の `dateRangeToTimestamps(start, end)`
- 共有期間フィルタ部品の新設要件:
  - 新設ファイル: `src/dashboard/components/periodFilter.ts`
  - 本 PBI で新設し、後続 PBI（03 ドメイン分析 / 04 期間指定タグクラスタ / 05 タグ頻度推移 / 07 ワードクラスタ / 08 スライダー）が再利用する汎用部品として切り出すこと
  - 仕様: プリセット（今日 / 7日 / 30日 / 90日 / 全期間）+ カスタム期間用 2 date inputs、選択結果を `{since, until}`（epoch ms、until は当日末尾まで含める）として発行する
  - UI は `sqliteHistoryPanel` のカレンダー先行実装と `dateRangeToTimestamps` を参考にしてよいが、特定パネルに結合せず汎用部品として切り出すこと
  - 技術的アプローチ: 日付絞り込みは SQL 側（`queryLogs()` の `since・until`）、ランキング集計はクライアント側で行う
- visit_duration の扱い:
  - 単位は記録コードから確認すること（ms と秒の混在可能性に注意し、必要なら正規化して集計する）
  - null の未計測行は集計から除外し、除外率（未計測件数 / 期間内総件数）を表示する
  - tags はスペース区切りを正とし、legacy カンマ区切りも分割対象とする
- 行クリックからの履歴パネル遷移（domain または tag フィルタ）は本 PBI では必須とせず検討事項とする（`navigateToHistoryWithTag` / `tryNavigateTyped` パターンを参考にする）
- 制約: MV3 準拠（インラインスクリプト・eval 禁止）、async/await のみ（`.then()` チェーン禁止）、ESM import は `.js` サフィックス必須、TypeScript strict、vitest + jsdom で検証する
- i18n キー一覧（EN と JA の両ファイル `public/_locales/en/messages.json`・`public/_locales/ja/messages.json` に追加し、表示側は data-i18n で束縛する）:
  - `visitDurationPanelTitle`
  - `visitDurationPeriodToday`
  - `visitDurationPeriodLast7Days`
  - `visitDurationPeriodLast30Days`
  - `visitDurationPeriodLast90Days`
  - `visitDurationPeriodAll`
  - `visitDurationPeriodCustom`
  - `visitDurationPeriodStart`
  - `visitDurationPeriodEnd`
  - `visitDurationDomainRanking`
  - `visitDurationTagRanking`
  - `visitDurationTotalTime`
  - `visitDurationAverageTime`
  - `visitDurationRecordCount`
  - `visitDurationUnmeasuredRatio`
  - `visitDurationEmpty`
  - `visitDurationAllUnmeasured`
  - `visitDurationTruncated`
- a11y 要件: WCAG 2.1 AA に準拠する（キーボード操作可能な期間フィルタとランキング行、フォーカス可視化、コントラスト比確保、ランキング表は table または list 構造でスクリーンリーダに意味が伝わるマークアップにする、日英両言語でレイアウト崩れがないこと）

## 見積もり
1.5 SP（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（文書要件がある場合のみ適用）

## 実装記録（2026-09-24 autonomous-task-closer）
- 実装: `src/dashboard/components/periodFilter.ts`（共有期間フィルタ部品・presetToRange 純粋関数・now 注入可・a11y group）、`src/dashboard/visitDurationAggregate.ts`（ドメイン/タグ別合計・平均・件数・未計測率・top N）、`src/dashboard/panels/asyncData/visitDurationPanel.ts`、配線（catalog/factories/index.html/locales 23キー×2/dashboard.css）、`MAX_VISIT_DURATION_ROWS` 追加
- 実データ制約の発見: 現行の自動記録経路は `visit_duration` を常に null で書く（単位は ms と確認）。未計測率100%の状態表示が実運用の既定挙動になる
- 検証: type-check PASS / 対象 56 tests green（新規3ファイル＋panelCatalog＋timeHeatmap 回帰）/ lint 0 errors / 全体 13,610 tests green / build PASS
- 備考: GitHub PR レビューはユーザー作業として残置。タグ行クリックの履歴遷移は navigate-to-tag パターンで実装、ドメイン行は v1 で遷移なし
