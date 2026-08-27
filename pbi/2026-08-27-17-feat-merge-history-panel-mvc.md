# PBI: Dashboard History Panel の HistoryModel 統合

## ユーザーストーリー
開発者として、History Panel の5ファイル MVC 往復を `HistoryModel` に統合したい、なぜならソート1つで `Panel` → `Controller` → `State` → `View` → `Query` の5往復と `generation` ガードの初期化競合を3重で把握する必要があり、バグが `generation` 忘れや `pendingInit` タイミングに宿るから。

## 優先度
- 順位: 6 / 7
- RICEスコア: 180（Reach=30 / Impact=1.5 / Confidence=60% / Effort=0.35）
- 根拠: E2E `dashboard-diagnostics` と単体 6ファイルが重複カバー。統合でテスト保守コスト半減。Worth exploring.

## なぜなぜ分析
- なぜ往復するか: `Controller` が `historyStateReducer` 委譲 + `chrome.storage` 永続化を薄くラップし、実体が `State` にある
- なぜ漏洩するか: `pendingInit` の `activateWithTag` → `consumePendingInit` → `retryInitialLoad` が View から不可視
- 解: `HistoryModel { state, fetch, sort, pagination }` が `fetch/search/sort/selection` をカプセル化し、Panel は `model.subscribe(render)` のみに

## BDD受け入れシナリオ
Scenario: ハッピーパス — ソートが Model 内で完結する
  Given `sortChange` を発火する
  When `HistoryModel.sort` を呼ぶ
  Then `fetch` → `State` 更新 → `render` が一括で完結する

Scenario: エッジケース — 初期化競合が Model 内で解消される
  Given `activateWithTag` と `changeSort` が並行で呼ばれる
  When 両方が完了する
  Then `generation` が正しくインクリメントされ、古い fetch が破棄される

## 受け入れ基準
- [ ] `HistoryModel` が `state/fetch/sort/pagination` をカプセル化している
- [ ] `Panel` が `model.subscribe(render)` のみに縮退している
- [ ] `Controller`/`View`/`State` の重複 6ファイルが統合されている

## テスト戦略
- 単体: `HistoryModel` の `sort`/`search`/`pagination` の状態遷移テスト
- 統合: 実 `chrome.storage` + `queryHistory` での `generation` ガード検証
- E2E: `dashboard-diagnostics` でソート永続と tagFallback 通知を検証

## 見積もり
3pt（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
