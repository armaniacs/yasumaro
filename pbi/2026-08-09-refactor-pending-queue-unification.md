# PBI: 保留キューの3実装を共通化する

**作成日**: 2026-08-07
**優先度**: 中
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（書き込みリカバリの内部実装変更。テスト要）
**種別**: 🔧非機能追加（refactor）

---

## 背景

コードレビューで、chrome.storage バックアップの保留キューの骨格（load/save/cap/flush）が3ファイルに重複していることが発見された。

### 重複の詳細

| ファイル | 行数 | 内容 | 型 |
|---------|------|------|----|
| `background/pendingSqliteQueue.ts` | 99 | SQLite書き込み失敗時のレコード保留キュー | `BrowsingLogRecord` |
| `background/pendingChromeStorageQueue.ts` | 86 | chrome.storage書き込み失敗時の保留キュー | `PendingChromeStorageWrite` |
| `background/offlineNetworkQueue.ts` | 201 | オフライン時のネットワークジョブ保留キュー | `OfflineJob` |

3つとも以下を実装する：
- `loadQueue`/`saveQueue`（`chrome.storage.local` の同一キー操作パターン）
- `enqueue` でハードキャップ（500 / 500 / 200）超過時 `splice(0, …)`
- `flush*` で `stillPending` アキュムレータ（成功を除去、失敗を残す）
- ほぼ同一のログ文字列（"failed to enqueue …", "flushed queued …"）

`pendingChromeStorageQueue.ts` のヘッダーに "Mirrors pendingSqliteQueue.ts's design" と明記されている。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
wc -l src/background/pendingSqliteQueue.ts src/background/pendingChromeStorageQueue.ts src/background/offlineNetworkQueue.ts
grep -rn "loadQueue\|saveQueue\|stillPending\|splice(0" src/background/pendingSqliteQueue.ts src/background/pendingChromeStorageQueue.ts src/background/offlineNetworkQueue.ts
grep -rn "enqueuePendingWrite\|enqueuePendingRecord\|flushPendingWrites\|flushPendingRecords" src/ --include="*.ts" | grep -v __tests__
```

## 受け入れ基準（BDD）

```gherkin
Scenario: 汎用ストレージバックキューで3種のジョブを扱える
  Given 型パラメータ付きの StorageBackedQueue<T>
  When BrowsingLogRecord, PendingChromeStorageWrite, OfflineJob をエンキューする
  Then 各型で同一の load/save/cap/flush 動作が行われる

Scenario: キュー容量の上限超過時に古い要素が捨てられる
  Given 上限を超える要素をエンキューした状態
  When flush を実行する
  Then 上限内に保たれ、古い要素から破棄される

Scenario: リトライ失敗した要素が次回フラッシュまで保持される
  Given 一部の要素がリトライ失敗する状態
  When flush を実行する
  Then 失敗分はキューに残り、成功分は除去される
```

## 受け入れ基準
- [ ] 汎用 `StorageBackedQueue<T>`（load/save/enqueue/cap/flush）を作成
- [ ] `pendingSqliteQueue.ts` を `StorageBackedQueue<BrowsingLogRecord>` ベースに書き換え
- [ ] `pendingChromeStorageQueue.ts` を `StorageBackedQueue<PendingChromeStorageWrite>` ベースに書き換え
- [ ] `offlineNetworkQueue.ts` のキュー骨格を `StorageBackedQueue<OfflineJob>` ベースに書き換え（TTL・ペイロードサイズ・リトライ回数などオフライン固有ロジックは維持）
- [ ] 各キューの単体テストがパスする
- [ ] 既存テストが全てパスする

## テスト戦略

### 単体テスト
- `StorageBackedQueue` の汎用テスト（enqueue/cap/flush/失敗保持）
- 3種の型を注入した場合のテスト

### 回帰テスト
- `pendingSqliteQueue` / `pendingChromeStorageQueue` / `offlineNetworkQueue` の既存テストがパスすることを確認

## 実装アプローチ
- 汎用キュー実装 → 3ファイルを型注入で書き換え → テスト更新
- `offlineNetworkQueue` はオフライン固有ロジック（TTL, payload size, retryCount, MAX_JOBS_PER_CYCLE）が多いため、骨格のみ共通化

## 見積もり
2pt（汎用キュー + 3実装の書き換え + テスト）

## 技術的考慮事項
- 依存: `src/background/pendingSqliteQueue.ts`, `pendingChromeStorageQueue.ts`, `offlineNetworkQueue.ts`
- `offlineNetworkQueue.ts` は class 実装（`OfflineNetworkQueue`）のため、共通骨格を継承/委譲で組み込む
- `pendingChromeStorageQueue` の `MAX_PENDING_WRITES` と `pendingSqliteQueue` の `MAX_PENDING_RECORDS` はともに500。定数を共通化しつつ、キューごとにオーバーライド可能にする

## 関連
- コードレビューレポート: 本セッションの重複レビュー（保留キュー3実装）
- 対象ファイル: `src/background/pendingSqliteQueue.ts`, `src/background/pendingChromeStorageQueue.ts`, `src/background/offlineNetworkQueue.ts`
