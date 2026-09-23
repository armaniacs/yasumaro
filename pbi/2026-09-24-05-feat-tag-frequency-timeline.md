# PBI: タグ頻度の期間推移

## ユーザーストーリー
履歴を振り返りたいユーザーとして、期間内で出現数上位のタグの週次/月次の記録数推移を積み上げ折れ線グラフで見たい、なぜならタグごとの興味変遷を数字で追えるようにするためだから

## 優先度
- 順位: 着手順 05（RICE順位 5 / 13候補中）
- RICEスコア: 2.40（Reach=3 / Impact=1.5 / Confidence=80% / Effort=1.5pt）
- 根拠: 時間変化を追いたいというニーズをクラスタ計算より安価に満たせる。tags と created_at のみで実現できる。同点の候補との順序は、着手順04が分析基盤でありユーザー要求の中核を担うこと、着手順06が最も工数が小さいことによる。

## BDD受け入れシナリオ
Scenario: 週次粒度で上位タグの推移が表示される（ハッピーパス）
  Given 期間内に複数のタグ付き記録が存在する
  And 粒度に「週」が選択されている
  And 表示タグ数に「10」が設定されている
  When パネルが期間フィルタの範囲で集計を実行する
  Then 出現数上位10タグの週別記録数が積み上げ折れ線グラフで表示される
  And グラフと同値の数値テーブルが表示される

Scenario: タグが0件の期間では空状態が表示される（境界ケース）
  Given 指定期間内の記録に表示可能なタグが存在しない
  When パネルが集計を実行する
  Then グラフの代わりに空状態メッセージが表示される
  And 数値テーブルは空行ではなく空状態の説明を示す

Scenario: 期間が粒度境界で割り切れない場合は端数週を切り捨てずに集計する（境界ケース）
  Given 期間の開始日が日曜以外または終了日が週の途中である
  When 週次粒度で集計を実行する
  Then 先頭と末尾の端数週も1バケットとして集計される
  And バケットのラベルに実際の日付範囲が明示される

Scenario: 上位N件から漏れたタグは「その他」にまとめられる（境界ケース）
  Given 期間内の distinct タグ数が表示設定 N を上回る
  When 集計を実行する
  Then 上位Nタグが個別系列として表示される
  And N位以下のタグの記録数は「その他」系列に合算される
  And 数値テーブルにも「その他」行が含まれる

Scenario: 粒度を週から月に切り替えると再集計される（切替ケース）
  Given 週次粒度のグラフが表示されている
  When 粒度を「月」に切り替える
  Then 月バケットで再集計されたグラフが表示される
  And 数値テーブルも月バケットの値に更新される

Scenario: 10000行の取得上限を超える期間では上限内の記録で集計される（上限ケース）
  Given 指定期間内の記録が10000件を超える
  When パネルが queryLogs で記録を取得する
  Then 最新10000件を上限として集計が実行される
  And 上限に達した旨の注記がパネルに表示される

## 受け入れ基準
- [ ] 期間内で出現数上位のタグ（既定10、表示数は設定変更可能）の週別/月別の記録数が積み上げ折れ線または積み上げ面グラフで表示される
- [ ] 粒度切替（週/月）が動作し、切替のたびに再集計される
- [ ] 週の開始はローカル時刻の日曜であり、 UI 上に明記される
- [ ] 共有の期間フィルタ部品の選択範囲に連動して集計範囲が変わる
- [ ] グラフと同値の数値テーブルが提供され、キーボードのみで粒度・表示数・テーブルの参照が操作できる
- [ ] 上位N件から漏れたタグは「その他」系列に合算され、凡例とテーブルに明示される
- [ ] タグ0件・端数週・取得上限到達の各状態が空状態または注記として表示される
- [ ] 日英両ロケールで文言が表示され、コントラスト等の外観がデザイントークンに準拠する

## テスト戦略
- E2E: ダッシュボードを開き、期間フィルタと粒度切替を操作してグラフと数値テーブルが連動すること、空状態が表示されることを確認する
- 統合: queryLogs の取得結果から週/月バケット集計・上位N抽出・その他合算までの一連の流れが共有期間フィルタと連動して動作することを確認する
- 単体: バケット境界計算（週開始日曜・ローカル時刻・端数週・月境界）、タグ分割と頻度カウント、上位N切り捨てとその他合算、10000行上限時の注記判定を検証する

## 実装メモ
- 再利用資産: `src/utils/sqlite-types.ts`（BrowsingLogRecord の tags と created_at）、`src/dashboard/panels/panelFactories.ts`（PanelLifecycle に準拠したパネル登録）、`entrypoints/options/index.html`（パネル用マークアップ）、`src/dashboard/components/periodFilter.ts`（共有の期間フィルタ、利用可能であることが前提。未整備の場合は本 PBI に着手しない）、`src/utils/computeLimits.ts`（narrowEntriesToTopTagsHybrid と MAX_TAG_CLUSTER_TAGS=50 による上位タグ絞り込み、または同型の頻度カウント）、`src/utils/tagUtils.ts`（parseTagsForDisplay によるタグ分割表示、空白区切りと旧形式カンマ区切りの吸収）、集計のクライアントサイド実装の前例（tagClusterPanel.ts）
- グラフ方針: チャートライブラリの導入は禁止。新規依存を増やさず、既存のタグクラスタパネルと同様に createElementNS による軽量 SVG を自作する。積み上げ折れ線を基本とし、積み上げ面での表現も許容する。系列色は `dev-docs/DESIGN_TOKENS.md` のトークンに準拠する
- 集計バケット定義: 粒度は週と月の2種。時刻判定はローカル時刻で行う。週バケットは日曜開始とし、期間の先頭と末尾に生じる端数週は切り捨てず1バケットとして扱う。月バケットは暦月単位とする。各バケットのラベルには実際の日付範囲を示す。1記録に複数タグがある場合は含まれる各タグに1件ずつ計上する
- データ取得: queryLogs の `{since, until, limit}` を用い、上限10000件を超える場合は最新10000件での集計である旨をパネル内に注記する
- i18n キー一覧（EN と JA の両方の `public/_locales/en/messages.json` と `public/_locales/ja/messages.json` に追加）: `dashboardTagTimelineTitle`、`dashboardTagTimelineDescription`、`dashboardTagTimelineGranularityWeek`、`dashboardTagTimelineGranularityMonth`、`dashboardTagTimelineTopNLabel`、`dashboardTagTimelineSeriesOther`、`dashboardTagTimelineEmpty`、`dashboardTagTimelineCapNote`、`dashboardTagTimelineTableCaption`、`dashboardTagTimelineWeekStartNote`
- a11y 要件: WCAG 2.1 AA に準拠する。グラフの代替として同値の数値テーブルを提供する。粒度切替と表示数設定はキーボード操作可能とし、フォーカス可視化を行う。SVG には title と説明を付与し、凡例とテーブルの対応関係が読み上げで追える構成にする。ESM import は `.js` サフィックス付きとし、MV3 の制約（動的コード実行禁止、Service Worker の状態保持禁止）を守る

## 見積もり
1.5 SP（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（文書要件がある場合のみ適用）
