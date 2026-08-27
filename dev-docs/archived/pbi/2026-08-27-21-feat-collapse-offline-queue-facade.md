# PBI: OfflineNetworkQueue Facade の QueuePort 統一

## ユーザーストーリー
開発者として、`OfflineNetworkQueue` の `PersistentRetryQueue` への薄いラッパーと重複した TTL/リトライ実装を `QueuePort` に統一したい、なぜなら `dequeue`/`peek` で独自に TTL フィルタ (`jobs.filter(j=> now-createdAt>JOB_TTL_MS)`) を再実装し `flush`/`flushBatch` の `maxRetryCount`/`maxJobsPerCycle` と二重管理され、`NoOpOfflineNetworkQueue` が継承でテスト用に null 化するアンチパターンになっているから。

## 優先度
- 順位: 3 / 3
- RICEスコア: 157（Reach=30 / Impact=1.5 / Confidence=70% / Effort=0.20）
- 根拠: オフラインキューは Service Worker 終了耐性 (`persistPerItem:true`) と `MAX_JOBS_PER_CYCLE` (PBI-2026-08-01-15) のバグ修正でレバレッジ中だが、現状の facade はテストで `chrome.storage.local` を毎回触る必要がある。

## なぜなぜ分析
- なぜ二重か: `OfflineNetworkQueue` は 20行の facade だが `dequeue:68-80` と `peek:90-96` で TTL 期限切れを独自にフィルタし `queue.save(valid)` で compaction しつつ、`PersistentRetryQueue.flush` でも同一 TTL チェックを再実装
- なぜ継承か: `NoOpOfflineNetworkQueue:106-126` が具象キューを継承して null 化するテスト用フェイク。`QueuePort` interface があれば DI で差し替え可能
- 解: `OfflineNetworkQueue` を `PersistentRetryQueue<OfflineJob>` の type alias + `OfflineJobFactory` (純粋 `create(payload)`) に縮退し、`QueuePort` で `NoOp` を DI。`AlarmScheduler` を `sessionAlarmsManager` と `logger/flushScheduler` から抽出

## BDD受け入れシナリオ
Scenario: ハッピーパス — TTL 期限切れが一箇所で処理される
  Given TTL を超えたジョブがキューにある
  When `flush` を呼ぶ
  Then `PersistentRetryQueue` のみで TTL チェックが行われ、`OfflineNetworkQueue` の `dequeue` 側では再実装しない

Scenario: エッジケース — NoOp が継承なしで差し替えられる
  Given テストで `QueuePort` を `NoOp` 実装に差し替える
  When `OfflineNetworkQueue` を使用する
  Then 継承なしで `queue.save` が呼ばれない

## 受け入れ基準
- [x] `OfflineNetworkQueue` が `PersistentRetryQueue<OfflineJob>` の type alias に縮退している — 実装時に検証: `dequeue`/`peek`（TTL照会＋compaction）と外部呼び出し元での `enqueue`/`retryAll`/`getQueueSize` 直接呼び出しが残るため、完全な type alias 化は既存契約（`__tests__/offlineNetworkQueue.test.ts`、`MessageRouter.test.ts` での直接 `new` 呼び出し）を壊す。代わりに `QueuePort<OfflineJob>` を注入するファサードクラスに縮退し、TTL/リトライ判定自体は `PersistentRetryQueue.filterExpiredAndOverRetry` に一本化（実質的な意図＝ロジック二重化の解消は達成）
- [x] `dequeue`/`peek` の TTL 再実装が削除され `PersistentRetryQueue` に一本化されている
- [x] `QueuePort` interface で `NoOp` が DI 可能になっている（`NoOpQueuePort` をコンストラクタ注入、継承オーバーライドなし）
- [ ] `AlarmScheduler` が `sessionAlarmsManager` と `logger/flushScheduler` から抽出されている — 対象外・見送り: 実コード確認の結果、`src/background/sessionAlarmsManager.ts` と `src/utils/logger/flushScheduler.ts` は既に別々のスケジューラ抽象（`LogFlushScheduler` 等）を持つ独立実装として存在しており、本PBIが触るキュー4ファイルの範囲外。統合は session timeout / logger flush の挙動に影響する別スコープのリファクタリングとして別PBIで扱うべき

## テスト戦略
- 単体: `QueuePort` の `NoOp` 差し替えテスト
- 単体: `PersistentRetryQueue` の TTL/`maxRetryCount`/`maxJobsPerCycle` の一本化テスト
- 統合: `chrome.storage.local` の `persistPerItem:true` での Service Worker 終了耐性テスト
- E2E: 不要

## 見積もり
1pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（`persistentRetryQueue.test.ts` 新設 + 既存 `offlineNetworkQueue.test.ts`/`MessageRouter.test.ts` 全パス）
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
