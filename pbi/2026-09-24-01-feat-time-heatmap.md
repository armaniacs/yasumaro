# PBI: 時間帯×曜日ヒートマップ

## ユーザーストーリー
閲覧履歴を記録しているユーザーとして、曜日（7）×時間帯（24）の記録数の集中傾向をヒートマップで見たい、なぜなら自分の閲覧習慣を可視化して記録・振り返りのタイミングを改善できるから

## 優先度
- 順位: 着手順 01（RICE順位 1 / 13候補中）
- RICEスコア: 4.00（Reach=5 / Impact=1.0 / Confidence=80% / Effort=1pt）
- 根拠: created_at のみで実現でき工数最小であり、全記録ユーザーを対象とした習慣可視化として波及が広い。外部依存や他パネルへの依存がなく単独で着手できる

## BDD受け入れシナリオ
Scenario: 直近12ヶ月の記録傾向がヒートマップで見える
  Given 直近12ヶ月以内に複数の閲覧記録が保存されている
  When ダッシュボードの時間帯×曜日ヒートマップパネルを開く
  Then 曜日7行×時間帯24列のグリッドが表示され、記録数が多いマスほど濃い色で表示される

Scenario: 各マスの内訳がホバーで確認できる
  Given ヒートマップが表示されている
  When 特定の曜日・時間帯のマスにホバーまたはフォーカスを当てる
  Then その曜日・時間帯・件数がテキストで表示される

Scenario: 記録が0件の場合は空状態が表示される
  Given 直近12ヶ月以内に閲覧記録が1件もない
  When ヒートマップパネルを開く
  Then 空のグリッドではなく記録がない旨のメッセージが表示される

Scenario: 日付の境界付近の記録がローカル時刻で正しく集計される
  Given ローカルの深夜0時前後にまたがる閲覧記録がある
  When ヒートマップパネルを開く
  Then 各記録はローカル時刻の日付・時間帯に集計され、日付のずれなく表示される

Scenario: 取得上限に達した場合は注意表示が出る
  Given 直近12ヶ月の記録が取得上限の10000行を超えている
  When ヒートマップパネルを開く
  Then ヒートマップは表示された上で、上限に達して一部のみ集計している旨の注意が表示される

## 受け入れ基準
- [ ] ダッシュボードに新規パネルとして曜日7×時間帯24の記録数ヒートマップが表示される
- [ ] 集計対象は直近12ヶ月の rolling window に固定され、期間ピッカーは表示されない
- [ ] 色の強度は件数に比例し、強度スケールは design tokens の定義に従う
- [ ] ホバーまたはフォーカスで曜日・時間帯・件数がテキスト表示される
- [ ] ヒートマップと同等の内容を持つ数値テーブルが提供され、キーボードのみで閲覧できる
- [ ] 記録0件の場合は空状態メッセージが表示される
- [ ] 10000行の取得上限到達時は上限に関する注意表示が出る
- [ ] 日英両言語で表示文言が正しく切り替わる

## テスト戦略
- E2E: ダッシュボードを開いてヒートマップ表示、ホバーでの内訳表示、0件時の空状態表示を確認する
- 統合: queryLogs から取得した created_at をローカル時刻に変換して7×24に集計する流れと、上限到達時の注意表示条件を確認する
- 単体: epoch ミリ秒から曜日・時間帯への変換、深夜境界の振り分け、空配列・上限超過時の分岐、件数から色強度への対応付けの境界値を検証する

## 実装メモ
- 再利用資産: PanelLifecycle 構成（`src/dashboard/panels/panelFactories.ts`、`src/dashboard/panels/panelCatalog.ts`、マークアップは `entrypoints/options/index.html` に追加）、データ取得は `src/dashboard/dashboardSqliteService.ts` の queryLogs（`{since, until, limit}`、上限10000）を利用、日付絞り込みはSQL側（`src/offscreen/queryPlan.ts`）に寄せ、曜日×時間帯への集計はクライアント側で行う（前例 `src/dashboard/panels/asyncData/tagClusterPanel.ts` の fetch 後集計パターン）、再試行が必要な場合は `src/dashboard/utils/retry.ts` の retryWithExponentialBackoff、上限値は `src/utils/computeLimits.ts` に寄せる
- 技術的アプローチ: v1 の since は現在時刻から12ヶ月前で固定し、queryLogs で created_at を取得してブラウザのローカル時刻で曜日・時間帯に変換して7×24セルに加算する。GitHub contributions 風グリッドで描画し、色強度は `dev-docs/DESIGN_TOKENS.md` の強度スケールに従う。期間ピッカーは付けない。後続候補で共有部品化される期間フィルタとは別物であり本PBIの範囲外とする
- 制約: MV3 準拠（インラインスクリプト・eval 禁止、async/await のみ）、ESM import は `.js` サフィックス必須、TypeScript strict、パネル描画の文言は data-i18n 属性経由で解決する
- 必要な i18n キー一覧（EN+JA ともに `public/_locales/en/messages.json` と `public/_locales/ja/messages.json` に追加）: `dashboardTimeHeatmapTitle`（パネル見出し）、`dashboardTimeHeatmapDescription`（直近12ヶ月固定の説明）、`dashboardTimeHeatmapEmpty`（0件時の空状態文言）、`dashboardTimeHeatmapCellLabel`（ホバー・フォーカス時の曜日・時間帯・件数表示用）、`dashboardTimeHeatmapTableCaption`（数値テーブルのキャプション）、`dashboardTimeHeatmapLimitNotice`（10000行上限到達時の注意文言）、曜日名・時間帯表記の短縮形キー
- a11y 要件: `docs/ACCESSIBILITY.md` の WCAG 2.1 AA に準拠する。色の濃淡だけで情報を伝えない。視覚に依存しない数値テーブルを同一パネル内に提供し、グリッドセルとテーブルはキーボードでフォーカス・閲覧できる。ホバー表示と同内容をフォーカス時にもテキストで提示する

## 見積もり
1 SP（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（文書要件がある場合のみ適用）
