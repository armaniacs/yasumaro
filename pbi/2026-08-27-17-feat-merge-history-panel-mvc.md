# PBI: Dashboard History Panel の HistoryModel 統合

## ユーザーストーリー
開発者として、History Panel の5ファイル MVC 往復を `HistoryModel` に統合したい、なぜならソート1つで `Panel` → `Controller` → `State` → `View` → `Query` の5往復と `generation` ガードの初期化競合を3重で把握する必要があり、バグが `generation` 忘れや `pendingInit` タイミングに宿るから。

## 優先度
- 順位: 6 / 7
- RICEスコア: 180（Reach=30 / Impact=1.5 / Confidence=60% / Effort=0.35）— 再評価で 6ファイル全面統合は 4.5pt に膨張。`Controller(417)+State(265)` のみに縮小すれば 3pt で収まる。`Query(344)` と `View(358)` は God Module 化を招くため現状維持が適正。
- 根拠: E2E `dashboard-diagnostics` と単体 6ファイルは重複ではなく Controller(jsdom不要) vs Panel(jsdom要) の二重防御。縮小案で `generation`/`pendingInit` の2ガードを Model に集約すればテスト保守コスト半減。Worth exploring のまま。

## なぜなぜ分析
- なぜ往復するか: `Controller` が `historyStateReducer` 委譲 + `chrome.storage` 永続化を薄くラップし、実体が `State` にある。`Query` は FTS5→enrichment→tagFallback を内包し `View` は CSP-safe HTML 生成で Model に吸収すると 700行超の God Module に逆戻り
- なぜ漏洩するか: `pendingInit` の `activateWithTag` → `consumePendingInit` → `retryInitialLoad` が View から不可視で、Panel の `updateDynamicRegions` 差分パスと `renderState` 全量パスの二重レンダーが `isPanelMounted` で分離され、デバウンス検索がさらに状態を持つ
- 解: 縮小案: `Controller+State` のみを `HistoryModel` に集約し、`Query/View` は委譲維持。`historyStateReducer` を内部で再利用し `subscribe` は `onStateChange` の薄いエイリアスに。`updateDynamicRegions` 差分パスは Model 化後も維持

## BDD受け入れシナリオ
Scenario: ハッピーパス — ソートが Model 内で完結する
  Given `sortChange` を発火する
  When `HistoryModel.sort` を呼ぶ
  Then `fetch` → `State` 更新 → `render` が `subscribe` 経由で一括で完結する。`Query`/`View` は委譲先として維持

Scenario: エッジケース — 初期化競合が Model 内で解消される
  Given `activateWithTag` と `changeSort` が並行で呼ばれる
  When 両方が完了する
  Then `generation` が `++requestGeneration` と `generation !== requestGeneration` の2箇所で正しくインクリメントされ、古い fetch が破棄され `loading` 永久スピナーが残らない

## 受け入れ基準
- [ ] 縮小案: `HistoryModel` が `Controller(417)+State(265)` の `generation/pendingInit/sort永続` をカプセル化し、`Query`/`View` は委譲維持
- [ ] `Panel` が `model.subscribe(render)` に縮退しつつ、`updateDynamicRegions` 差分パスは維持されている
- [ ] `historyStateReducer` が Model 内部で再利用され、`Controller`/`View`/`State` の全面統合 (6ファイル) ではない

## テスト戦略
- 単体: `HistoryModel` の `sort`/`search`/`pagination` の状態遷移テスト。State の30パターン純粋テストは Model 単体に移管
- 統合: 実 `chrome.storage` + `queryHistory` での `generation` ガード検証。`panel-generation` の jsdom テストは Model subscribe 経路に差し替え
- E2E: `dashboard-diagnostics` でソート永続と tagFallback 通知を検証。`TAG_FILTER_FETCH_LIMIT=5000` の暗黙制約を PBI に明記し対象外と宣言

## 見積もり
3pt（縮小案, 要チームでの見積もり） — 全面案は 4.5-5pt

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
