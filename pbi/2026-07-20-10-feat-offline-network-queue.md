# PBI: オフラインネットワークキュー — AI要約・Obsidian同期のオフライン耐性

元指摘: Checking Team (Medium: Edge & Mobile Strategist)

## ユーザーストーリー
ユーザーとして、モバイル環境などネットワークが不安定な状況でもAI要約の生成とObsidianへの保存をキューイングし、ネットワーク復旧後に自動で再試行したい、なぜなら現在はネットワーク断が発生するとAI呼び出しやObsidian同期がその場で失敗し、記録が不完全になるから

## ビジネス価値
- モバイルユーザーの体験向上（ネットワーク断の自動リカバリ）
- 記録の完全性向上（失敗時のデータ損失防止）
- オフライン環境でも操作可能に（後で自動同期）

## 前提・制約
- 既存の `pendingSqliteQueue` は SQLite 書き込み失敗専用。ネットワーク障害とは独立したキューとする
- `RecordingPipeline` のリトライ機構（`executeWithStrategy`）は各ステップのリトライ上限に達すると諦める。キューはその「諦めた」後の最終手段として機能する
- キューイングされたジョブは `chrome.storage.local` に永続化し、Service Worker 再起動後も生存する

## アプローチ

### アーキテクチャ

```
RecordingPipeline
  └─ executeWithStrategy (既存、リトライ上限付き)
       └─ 上限到達 → OfflineNetworkQueue.enqueue(job)
            └─ chrome.storage.local に永続化
                 └─ navigator.onLine 変化 or chrome.alarms 定期実行で再試行
                      └─ 成功 → キューから削除
                      └─ 失敗 → 上限までリトライ後、最終的に破棄またはログ
```

### コンポーネント

1. **`OfflineNetworkQueue`** (`src/background/offlineNetworkQueue.ts`)
   - `enqueue(job: OfflineJob): Promise<void>` — キューに追加（永続化）
   - `dequeue(): Promise<OfflineJob | null>` — 次に処理するジョブを取得
   - `retryAll(): Promise<void>` — 全ジョブを再試行
   - `getQueueSize(): Promise<number>` — キューサイズ確認
   - 最大保持件数: `MAX_QUEUED_JOBS = 200`
   - ジョブの寿命: `JOB_TTL_MS = 7 days`（期限切れは破棄）

2. **`OfflineJob` 型**
   - `id: string`（一意ID）
   - `type: 'ai_summary' | 'obsidian_sync'` — ジョブ種別
   - `payload: unknown` — 各ジョブのペイロード
   - `createdAt: number` — タイムスタンプ
   - `retryCount: number` — 再試行回数
   - `lastError?: string` — 最後のエラー

3. **ネットワーク状態検出**
   - `navigator.onLine` の変化を `window.addEventListener('online'/'offline', ...)` で監視（Offscreen Document 経由で Service Worker に通知）
   - または `chrome.alarms` 5分間隔の定期チェック（Service Worker 単独）
   - 状態変化時は `retryAll()` を呼び出す

## BDD受け入れシナリオ

```gherkin
Feature: オフラインネットワークキュー

  Scenario: AI要約がネットワークエラーで失敗した場合にキューイングされる
    Given ネットワークが利用不可の状態でページを記録する
    When AI要約ステップがリトライ上限に達する
    Then OfflineNetworkQueue にジョブが追加される
    And ジョブのタイプが ai_summary である

  Scenario: ネットワーク復旧時にキューイングされたジョブが自動再試行される
    Given OfflineNetworkQueue に未処理のジョブが存在する
    When ネットワークが復旧する（online イベントが発火する）
    Then キュー内の全ジョブが再試行される
    And 成功したジョブはキューから削除される

  Scenario: キューイングされたジョブが7日を超えると自動破棄される
    Given ジョブが作成から7日以上経過している
    When retryAll または定期チェックが実行される
    Then 期限切れジョブは破棄される
    And 破棄されたことがログに記録される

  Scenario: キューが200件を超えると古いジョブから自動削除される
    Given キューに200件のジョブが存在する
    When 新しいジョブを enqueue する
    Then 最も古いジョブが破棄される
    And 新しいジョブが追加される

  Scenario: Service Worker 再起動後もキューが保持される
    Given OfflineNetworkQueue にジョブが存在する
    When Service Worker が再起動する
    Then キューが chrome.storage.local から復元される
    And 定期チェックにより再試行が行われる
```

## 受け入れ基準
- [ ] `OfflineNetworkQueue` クラスが実装されている
- [ ] ネットワーク障害時に `executeWithStrategy` のリトライ上限到達後、自動的にキューイングされる
- [ ] ネットワーク復旧（online イベント）でキュー内ジョブが再試行される
- [ ] 5分間隔の定期チェックでも再試行される（online イベントを捕捉できなかった場合の保険）
- [ ] ジョブの最大保持期間 7日、最大件数 200件
- [ ] Service Worker 再起動後もキューが `chrome.storage.local` に永続化される
- [ ] `npm run type-check` / `npm test` が成功

## テスト戦略

### 統合テスト
- フルパイプラインでのキューイング→再試行→成功フロー
- ネットワーク状態変化の検出とキュー処理の連動

### 単体テスト
- `enqueue/dequeue` の基本動作
- `retryAll` の成功・失敗・部分成功
- 期限切れジョブの破棄（`JOB_TTL_MS`）
- 最大件数超過時の古いジョブ削除（FIFO）
- `chrome.storage.local` への永続化と復元

## 実装アプローチ
- **Inside-Out**: まず `OfflineJob` 型と `OfflineNetworkQueue` クラスのインターフェースを定義。次に永続化と基本操作を実装。最後に `RecordingPipeline` の `executeWithStrategy` への統合とネットワーク状態監視を追加
- `pendingSqliteQueue` の設計（永続化・バッチ処理）を参考にするが、ロジックは共有しない（責務が異なるため）
- ネットワーク状態監視は Service Worker の `chrome.alarms` を使用し、Offscreen Document を不要にする

## 見積もり
8pt（キューコア実装 + 永続化 + Pipeline統合 + ネットワーク監視 + テスト）

## 技術的考慮事項
- `navigator.onLine` は Service Worker では利用不可の場合がある。`chrome.alarms` による定期チェックを主軸とし、Offscreen Document 経由の `online/offline` イベントを補助的に使用する
- `RecordingPipeline` の `executeWithStrategy` は各ステップが個別のリトライ戦略を持つ。キューイングは `FATAL` 戦略（重複・プライベートページ）以外の全ステップに適用可能とする
- ジョブのペイロードはシリアライズ可能な形式に制限する（`chrome.storage.local` の制約）

## 落とし穴
- キューイングされたジョブのペイロードが大きくなりすぎないよう、`MAX_JOB_PAYLOAD_BYTES` の上限を設定すること（目安: 50KB）
- 再試行時もネットワークが復旧していない場合、無限ループにならないように `MAX_RETRY_COUNT` を設定する（目安: 3回）
- 再試行の間隔は指数バックオフ（初回5分、最大60分）とし、ネットワーク負荷を考慮する
- `executeWithStrategy` への統合は、各ステップのリトライ上限到達後かつ `FATAL` 以外の戦略の場合にキューイングする。この条件分岐の追加はパイプラインの制御フローを複雑にするため、設計レビューで十分に検討すること

## Definition of Done
- [ ] `OfflineNetworkQueue` クラスが実装されテストがパスする
- [ ] `RecordingPipeline.executeWithStrategy` にキューイング統合が行われている
- [ ] ネットワーク状態監視（定期チェック + online イベント）が実装されている
- [ ] Service Worker 再起動後もキューが復元される
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
