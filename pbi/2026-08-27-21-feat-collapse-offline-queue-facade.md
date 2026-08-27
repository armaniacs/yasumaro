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
- [ ] `OfflineNetworkQueue` が `PersistentRetryQueue<OfflineJob>` の type alias に縮退している
- [ ] `dequeue`/`peek` の TTL 再実装が削除され `PersistentRetryQueue` に一本化されている
- [ ] `QueuePort` interface で `NoOp` が DI 可能になっている
- [ ] `AlarmScheduler` が `sessionAlarmsManager` と `logger/flushScheduler` から抽出されている

## テスト戦略
- 単体: `QueuePort` の `NoOp` 差し替えテスト
- 単体: `PersistentRetryQueue` の TTL/`maxRetryCount`/`maxJobsPerCycle` の一本化テスト
- 統合: `chrome.storage.local` の `persistPerItem:true` での Service Worker 終了耐性テスト
- E2E: 不要

## 見積もり
1pt（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
