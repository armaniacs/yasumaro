# PBI: 2つのキューが再実装するリトライを統合し、pendingSqliteQueue に max-retry を付与する

## ユーザーストーリー
開発者として、`PendingSqliteQueue` と `OfflineNetworkQueue` が `PersistentRetryQueue.flush()` を迂回して独自の load→try→save ループを再実装している状態を解消したい。なぜなら、TTL・リトライ回数・max-retry ドロップ・サイクル上限というリトライ意味論が3箇所に散在し、`PendingSqliteQueue` は max-retry が効かないため失敗し続けるレコードが永久に滞留するから。

## ビジネス価値
- リトライ意味論を1モジュールに集約し、挙動の食い違いを排除する
- `PendingSqliteQueue` に max-retry / TTL が付与され、毒レコードの永久滞留を防ぐ
- 約50行の重複したリトライオーケストレーションを削除する

## BDD受け入れシナリオ

```gherkin
Scenario: 失敗し続ける SQLite レコードが永久滞留しない
  Given insertBatch が常に失敗するレコードがキューされている
  When flushPendingRecords が max-retry 上限回数実行される
  Then 当該レコードはキューからドロップされる

Scenario: リトライ意味論が1箇所に集約される
  Given PersistentRetryQueue.flush() が TTL・retryCount・max-retry を所有する
  When 3つのキューが flush を実行する
  Then どのキューも独自の TTL/retryCount ロジックを持たない

Scenario: 1サイクルのジョブ上限が維持される
  Given キューに MAX_JOBS_PER_CYCLE を超えるジョブがある
  When 1回のリトライパスが実行される
  Then 上限を超えたジョブは次サイクルへ持ち越される
```

## 受け入れ基準
- [ ] `OfflineNetworkQueue.retryAll()` が独自の TTL 判定・retryCount 加算・max-retry ドロップを再実装せず `flush()` に委譲している
- [ ] `PendingSqliteQueue.flushPendingRecords()` に max-retry / TTL が適用されている
- [ ] リトライ意味論の重複実装（TTL・retryCount・max-retry）が `persistentRetryQueue.ts` のみに存在する
- [ ] 既存の `offlineNetworkQueue.test.ts` / `pendingSqliteQueue.test.ts` / `persistentRetryQueue` 系テストがすべてパスする
- [ ] `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 既存のE2Eシナリオがパスすることを確認

### 統合テスト
- `PendingSqliteQueue` が max-retry 回数後に毒レコードをドロップするテスト
- `OfflineNetworkQueue` の1サイクル上限・次サイクル持ち越しの契約テスト

### 単体テスト
- `flush()` の batch 対応（後述）に対する単体テスト
- 各キューが flush() へ委譲していることを検証する委譲契約テスト

## 実装アプローチ
- **Outside-In**: まず「毒レコードが max-retry 後にドロップされる」失敗テストを書き、`PendingSqliteQueue` を flush() 経由に移行してグリーン化
- **Red-Green-Refactor**: `OfflineNetworkQueue.retryAll()` の削除に伴う差分をテストで固定しながら段階的に置換

## 見積もり
3ポイント

## 技術的考慮事項
- 依存関係: なし（独立して実装可能）。PBI-14（PendingChromeStorageQueue インスタンス化）・PBI-17（OfflineNetworkQueue DI 化）とは対象ファイルが近いが責務は別
- テスタビリティ: `ChromeStorageAdapter` は既に注入可能。InMemory アダプタで検証
- 副作用: `OfflineNetworkQueue.retryAll()` は「ジョブごとの逐次保存」で SW 終了時も retryCount 進捗を保持する設計（PBI-2026-08-01-14）。flush() への委譲でこの耐性を失わないこと

## 実装者向け注記

### 現状コードの確認
```bash
# flush() を迂回する独自ループを確認
grep -n "queue.load\|queue.save" src/background/pendingSqliteQueue.ts src/background/offlineNetworkQueue.ts
# flush() のリトライ意味論を確認
sed -n '100,151p' src/background/persistentRetryQueue.ts
# pendingSqliteQueue の maxRetryCount 未設定を確認
sed -n '31,36p' src/background/pendingSqliteQueue.ts
```

### 現状（2026-08-17 確認済み）
- `pendingSqliteQueue.ts:64-89` の `flushPendingRecords` は `queue.load()`/`queue.save()` を直接使い、`flush()` を呼ばない。キュー生成時（31-36行）に `maxRetryCount` を指定していないため、`shouldDrop()`（`persistentRetryQueue.ts:209-212`）は常に false → 毒レコードが永久滞留する
- `offlineNetworkQueue.ts:86-138` の `retryAll` は TTL 判定（88-91）、retryCount 加算（121/123）、max-retry ドロップ（127-134）、サイクル上限（96-97）を再実装。これらは `flush()` が既に提供している
- `flush()` は `handler(item) => Promise<boolean>` の1件単位。`PendingSqliteQueue` は `insertBatchResult(records[])` の50件バッチ挿入のため、そのままでは使えない
- 既実装の重複: なし（`pendingChromeStorageQueue.ts:172` は既に flush() へ委譲済み）

### 実装手順
1. `PersistentRetryQueue.flush()` に batch 対応を追加（例: `handler` が配列を受ける `flushBatch(handler, batchSize)`、またはオプション `persistPerItem: boolean`）
2. `PendingSqliteQueue` をバッチ対応 flush() 経由に移行し、`maxRetryCount` / `ttlMs` を設定。ただし `BrowsingLogRecord` は `RetryableItem` でないため、ラッパー型（`QueuedRecord = BrowsingLogRecord & RetryableItem`）で包む
3. `OfflineNetworkQueue.retryAll()` を `queue.flush()` へ委譲（ジョブは既に `OfflineJob extends RetryableItem` で条件を満たす）
4. 逐次保存の耐性が失われないよう、必要なら flush() に `persistPerItem` オプションを追加
5. 委譲契約テストを追加

### 落とし穴
- `OfflineNetworkQueue.retryAll()` の「ジョブごと逐次保存」（`offlineNetworkQueue.ts:118/132/137`）は SW 終了時に retryCount 進捗を失わないための意図的な設計。flush()（末尾で1回保存）に置き換えると、SW 終了時に未保存の進捗が失われ、retryCount が二重加算されて早期ドロップし得る。`persistPerItem` オプションで同等の耐性を確保すること
- `PendingSqliteQueue` のバッチ挿入は「チャンク単位で成功/失敗」の粒度。flush() の1件単位 handler に合わせると1件ずつ insert することになり性能が落ちる。`flushBatch` 側でチャンク粒度を保つこと
- `OfflineJob` と `QueuedRecord` の `RetryableItem` 条件（`createdAt`/`retryCount`）を満たすことを型で保証する
- `MAX_PENDING_RECORDS = 500`（`pendingSqliteQueue.ts:16`）のハードキャップを移行後も維持すること

## Definition of Done
- [ ] `OfflineNetworkQueue.retryAll()` が flush() へ委譲し、独自の TTL/retryCount/max-retry 再実装が無い
- [ ] `PendingSqliteQueue` に max-retry / TTL が適用され、毒レコードがドロップされるテストがパスする
- [ ] 逐次保存の耐性が維持されている（契約テストで固定）
- [ ] 全テストがパスし `npm run validate` が通過している
- [ ] コードレビュー完了
