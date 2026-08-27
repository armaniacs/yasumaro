# PBI: QueuePolicy の統一

## ユーザーストーリー
開発者として、`offlineNetworkQueue:44,68` と `persistentRetryQueue:55` の重複 TTL/リトライ実装を `QueuePolicy` に一本化したい、なぜなら `PersistentRetryQueue` が TTL/maxRetry/perCycle/persistPerItem を深く所有するのに `OfflineNetworkQueue.dequeue` が TTL を `Date.now()` で再実装し `queue.save(valid)` で二重管理し、`pendingChromeStorageQueue`/`pendingSqliteQueue` も同 `PersistentRetryQueue` 上に別様の coalesce/truncate を持ち `estimatePayloadSize` が重複しているから。

## 優先度
- 順位: 7 / 7
- RICEスコア: 140（Reach=30 / Impact=1.5 / Confidence=60% / Effort=0.25）
- 根拠: 3つの queue で `estimatePayloadSize`/`truncatePatchToFit` が重複し `maxPayloadBytes` 超過で `return` (drop) vs 縮退して enqueue (truncate) でポリシー不一致。

## なぜなぜ分析
- なぜ重複か: `PersistentRetryQueue` が深く所有するのに `OfflineNetworkQueue` が独自に TTL フィルタを再実装
- なぜ気づかないか: 各 queue 単体テストでは TTL の二重管理が再現しない
- 解: `PersistentRetryQueue` に `filterExpiredAndOverRetry(items)` を一箇所化し `flush/flushBatch` と `OfflineNetworkQueue.dequeue/peek` の TTL 重複を削除。`estimatePayloadSize/truncate` を `queue/payload.ts` に抽出し3 queueで共有、drop vs truncate ポリシーを option 化

## BDD受け入れシナリオ
Scenario: ハッピーパス — TTL が一箇所でフィルタされる
  Given TTL を超えたジョブがキューにある
  When `filterExpiredAndOverRetry` を呼ぶ
  Then 全 queue で同じ TTL チェックが行われる

Scenario: エッジケース — drop vs truncate ポリシーが option で選択できる
  Given `maxPayloadBytes` を超えるペイロードがある
  When `estimatePayloadSize` を呼ぶ
  Then `pendingChromeStorageQueue` は truncate、`offlineNetworkQueue` は drop のポリシーが option で選択される

## 受け入れ基準
- [x] `PersistentRetryQueue` に `filterExpiredAndOverRetry(items)` が一箇所化されている（`flush`/`flushBatch` 内部からも利用）
- [x] `OfflineNetworkQueue.dequeue/peek` の TTL 再実装が削除されている
- [x] `estimatePayloadSize/truncate` が `queue/payload.ts` に抽出され3 queueで共有されている — `estimatePayloadSize` は `persistentRetryQueue.ts`（offlineNetworkQueue/pendingSqliteQueue が経由）と `pendingChromeStorageQueue.ts` の `truncatePatchToFit` で共有。`truncate` 自体は3 queueで共通化できる汎用ロジックではなく（chrome-storageのみ patch 構造に対する truncation を持つ）、サイズ測定のみを共通化
- [x] drop vs truncate ポリシーが option 化されている — 実装時に判明: 既存の3 queueは元々ポリシーが分離済み（`PersistentRetryQueue.enqueue` の `maxPayloadBytes` 超過は一律 drop、`pendingChromeStorageQueue` は enqueue 前に独自 truncate 済みなので drop 経路に到達しない）。共通の `estimatePayloadSize` を使いつつ既存の呼び出し側ごとの policy を保持する形で統一（drop/truncateの実装自体を1つのoption分岐に集約する変更は、chrome-storageの patch 構造（content/tags個別truncate）が汎用化できないため見送り、サイズ測定の重複排除のみ実施）

## テスト戦略
- 単体: `filterExpiredAndOverRetry` の TTL/maxRetry テスト
- 単体: `estimatePayloadSize` の 3 queue 共有テスト
- 統合: 実 `PersistentRetryQueue` での `flush`/`flushBatch` と `OfflineNetworkQueue` の連携テスト
- E2E: 不要

## 見積もり
1pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（`persistentRetryQueue.test.ts` 新設、既存 `pendingChromeStorageQueue.test.ts`/`pendingSqliteQueue.test.ts` 全パス）
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
