# PBI: オフラインキュー再送処理をSWライフサイクルに対応させる

**作成日**: 2026-08-01
**優先度**: High
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（アラームリスナーの制御フロー変更。既存の再送ロジック自体は変えない）

---

## 背景

Checking Team レビュー（`plans/2026-08-01-1903-review-yasumaro.md`）の SRE/Ops Specialist からの High指摘。事実確認の結果、**コード構造・保存タイミングの指摘は正確**と確認済み。ただし「同じジョブが毎回『初回扱い』で再処理される」という結論はやや誇張で、正確には「Service Workerが処理途中で終了した場合、その回の`retryCount`インクリメントのみが失われうる」。

### 確認された事実

`src/background/service-worker.ts:693-702` のalarmsリスナーは以下の通り:

```ts
if (alarm.name === 'yasumaro-offline-network-retry') {
  void processOfflineNetworkQueue();
  void flushPendingRecords(sqliteClient);
  void flushPendingWrites(retryPendingChromeStorageWrite);
  void sqliteClient.isSqliteHealthy();
}
```

`void` でPromiseを切り離しており、`chrome.alarms.onAlarm` リスナー自体がPromiseを返さないため、Manifest V3 Service Workerはこれらの非同期処理の完了を待たずに終了しうる。

`src/background/offlineNetworkQueue.ts:92-125` の `retryAll()` はforループ内で `job.retryCount++` するが、`await this.saveQueue(remaining)` はループの**外**（124行目）で全ジョブ処理後に1回だけ呼ばれる。そのため、SWがループ処理の途中で終了すると、その回に処理済みだったジョブの `retryCount` 増分がストレージに反映されず、次回アラーム発火時に前回保存済みの値から再開する（「毎回必ず初回扱い」になるのは、最初のジョブ処理中に毎回SWが終了する極端なケースのみ）。

同様の fire-and-forget パターンが `flushPendingRecords` / `flushPendingWrites` にも並列に存在する。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "yasumaro-offline-network-retry\|void processOfflineNetworkQueue\|void flushPending" src/background/service-worker.ts
grep -n "saveQueue\|retryCount++" src/background/offlineNetworkQueue.ts
```

alarmsリスナーの現在の実装（`void`呼び出しの有無）と、`retryAll()`内の保存タイミング（ループ内か外か）を再確認してから着手する。

## 受け入れ基準（BDD）

```gherkin
Scenario: アラームリスナーが非同期処理の完了を待つ
  Given yasumaro-offline-network-retryアラームが発火する
  When onAlarmリスナーが呼ばれる
  Then processOfflineNetworkQueue()を含む全ての非同期処理が完了するまでリスナーはPromiseを返し続ける

Scenario: SWが処理途中で終了してもretryCountの進行が失われない
  Given オフラインキューに複数のジョブがあり、いずれかのジョブ処理直後にSWが終了する
  When 次回アラームが発火し再送処理が再開される
  Then 前回処理済みだったジョブのretryCountは正しく引き継がれ、二重にカウントされない、または失われない

Scenario: 既存のオフラインキュー再送テストが回帰しない
  Given 変更後のalarmsリスナーとretryAll()
  When 既存のoffline queue関連テストを実行する
  Then 全てパスする
```

## 受け入れ基準
- [ ] `chrome.alarms.onAlarm` リスナーを `async` 化し、`processOfflineNetworkQueue()` を含む非同期処理を `await` する（SWの生存期間をPromise解決まで延長する）
- [ ] `flushPendingRecords` / `flushPendingWrites` / `isSqliteHealthy` も同様に `Promise.allSettled` 等でリスナー内から待機し、いずれかの失敗が他の処理をブロックしないようにする
- [ ] `retryAll()` の `retryCount` 更新を、全件処理後の一括保存ではなく、ジョブ単位（または妥当なバッチ単位）で永続化するよう変更する
- [ ] 既存の `offlineNetworkQueue` / `service-worker` 関連テストが全てパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外（Service Workerライフサイクルは実ブラウザでの手動確認が必要。Playwright等での自動再現は困難なため、手動テストチェックリストに記載する）

### 統合テスト
- alarmsリスナーが `processOfflineNetworkQueue()` を含む全処理の完了を待ってから戻ることをモックで確認
- `retryAll()` の処理途中でエラーが発生した場合でも、それ以前に処理済みのジョブの `retryCount` が保存されていることを確認

### 単体テスト
- `saveQueue` がジョブ単位（またはバッチ単位）で呼ばれることを確認
- 複数の非同期処理（`flushPendingRecords`等）のいずれかが失敗しても他が実行されることを確認（`Promise.allSettled`の挙動）

## 実装アプローチ
- **Outside-In**: 統合テスト（アラームリスナーの待機動作）から開始し失敗を確認 → 単体テスト（保存タイミング）→ 実装
- **Red-Green-Refactor**: 各レイヤーでTDDサイクルを適用

## 見積もり

2pt（alarmsリスナーのasync化 + retryAllの保存タイミング変更 + 既存テストの回帰確認）

## 技術的考慮事項
- 依存関係: `src/background/service-worker.ts:693-702`, `src/background/offlineQueueProcessor.ts:26-66`, `src/background/offlineNetworkQueue.ts:92-125`
- テスタビリティ: `chrome.alarms.onAlarm` のモックでリスナーの待機挙動を検証可能
- 非機能要件: MV3 Service Workerのライフサイクル制約（生存期間はイベントリスナーが返すPromiseに依存）

## 落とし穴
- `onAlarm` リスナーを `async` にしてPromiseを返しても、Chrome がSWの生存を保証する時間には上限がある（数十秒程度）。キューが大量にある場合は全件待機が長時間化しうるため、1サイクルあたりの処理件数上限の検討も合わせて行うこと（PBI-15と関連）。
- `void` を単純に `await` に変えるだけだと、複数の独立処理（`processOfflineNetworkQueue` / `flushPendingRecords` / `flushPendingWrites` / `isSqliteHealthy`）が直列実行になり不要に遅延する。`Promise.allSettled` で並列化しつつ待機すること。

## Definition of Done
- [x] alarmsリスナーが非同期処理の完了を待つ
- [x] retryCountの永続化タイミングがジョブ単位（またはバッチ単位）になっている
- [x] 全テストがパスする
- [x] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-08-01-1903-review-yasumaro.md`（SRE/Ops Specialist指摘、High #3）
- 対象コード: `src/background/service-worker.ts:693-702`, `src/background/offlineQueueProcessor.ts:26-66`, `src/background/offlineNetworkQueue.ts:92-125`
- 事実確認: コード構造・保存タイミングは正確。「毎回初回扱い」という結論は条件付き（SW中断時のみ）で誇張気味
- 関連PBI: PBI-15（サイクルあたり処理件数上限）と技術的関心が重なる。同時期に着手する場合は競合に注意

## 実装メモ（2026-08-01完了）

- `src/background/service-worker.ts`: `chrome.alarms.onAlarm.addListener` のコールバックを `async` 化。`yasumaro-offline-network-retry` 分岐内で `processOfflineNetworkQueue()` / `flushPendingRecords()` / `flushPendingWrites()` / `isSqliteHealthy()` を `Promise.allSettled` で並列に `await` する形に変更（1つの失敗が他をブロックしない）。他の3分岐（daily-purge, local-md-*）は既存通り `void` のfire-and-forgetのまま維持（スコープ外）
- `src/background/offlineNetworkQueue.ts`: `retryAll()` を、ループの最後に1回だけ `saveQueue()` する実装から、各ジョブ処理直後（成功時・MAX_RETRY_COUNT到達時・残留時のいずれのパスでも）に `saveQueue([...remaining, ...pending])` を呼ぶ実装に変更。未処理分（`pending`）も含めて都度保存することで、途中でSWが終了しても既処理分のretryCount増分が失われない
- `src/background/__tests__/offlineNetworkQueue.test.ts`: 2件目のジョブ処理がハンドラ内で永久にpendingのまま（SW終了を模擬）でも、1件目のretryCount増分が既にストレージへ反映されていることを検証するテストを追加
- `npm run validate`（型チェック + vitest全件7332件）成功、`npm run build` 成功
- 落とし穴として記載されていた「サイクル処理時間の長時間化」「retryCountループ内saveによるI/O増加」はPBI-15（サイクル上限）で緩和予定
