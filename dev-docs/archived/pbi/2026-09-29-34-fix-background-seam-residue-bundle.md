# PBI: background 正本 seam 周辺の取り残し解消（DI 配線 / 計測競合 / 無防備 RMW / listener 蓄積）

種別: fix
状態: 実装済み（2026-09-29）

上流: 大局的コードレビュー 2026-09-29（テーマ2）。background 側 singleton seam に残った 4 件の独立した取り残し（DI 配線の未接続、flush 前計測の twin バグ、ロックなし RMW、idle listener の蓄積）をまとめて解消する。対象ファイルは互いに重複しない。

## ユーザーストーリー

拡張の維持者として、background の singleton seam に関する「ドキュメント上の約束とコードの現実の食い違い」を残したくない、なぜなら片方の前提が崩れたときに別ファイルは無関係なまま壊れたままになるから

## 優先度

- 順位: 4 / 10
- RICE スコア: 10.0（Reach=5 / Impact=2 / Confidence=100% / Effort=1.0）
- 根拠: 4 件ともコードから直接確認できる事実（未接続の DI、既修正 twin の残存、保護されていない RMW、手順漏れ）であり確度は 100%。Reach は対象 4 ファイルと移行 1 ファイルに留まるが、影響は現時点でそれぞれテレメトリ・診断キューの範囲で致命的ではないため Impact=2。ファイルが重複しないため 1.0 SP のまま一括で進められる

## 現状と問題（file:line 証拠付き）

### item 1: pendingWriteQueue の DI 契約が production で未接続

- `src/background/pendingChromeStorageQueue.ts:112-135` が `setPendingWriteQueue` を提供する
- 同ファイルの JSDoc（`:128-131`）は「Production code calls this once from createBackgroundServices」と主張しているが、`setPendingWriteQueue` の呼び出しはテストのみ（`pendingChromeStorageQueue.test.ts:11` 等のテスト 3 ファイル）
- `src/background/compositionManifest.ts:114` が `'pendingWriteQueue'` を登録するが、誰も resolve しない
- `src/background/createBackgroundServices.ts:94` はコメントでの言及のみ
- ADR `dev-docs/ADR/2026-09-17-module-singleton-policy.md:117` で参照されている singleton 方針の一部
- リスク: 将来 container 経由で 2 つ目のインスタンスが生成されると、同一キー上に独立したロックチェーンが生まれ lost update が有効化される

### item 2: pendingSqliteQueue の pre-flush 計測は修正済みバグの未修正 twin

- `src/background/pendingSqliteQueue.ts:77` と `:94-99` が flush 前の `queue.getQueueSize()` スナップショットから recovered / remaining を算出する
- flush は lock 内で再読み込みするため、mid-flush enqueue が挟まると負値・過大計上になりうる
- 同一バグは `src/background/pendingChromeStorageQueue.ts:83-107` で既に修正済み（`:83-85` に PBI 2026-09-12-20 の説明コメント「measure inside the flush, not from a pre-flush snapshot」）
- 実害は現状テレメトリのみで、移行漏れの状態

### item 3: feedbackQueue がロックなしの生 RMW

- `src/utils/aiSummaryCleaner/feedbackQueue.ts:52-68`（enqueueFeedback）と `:78-82`（removeFeedbackEntry）が `chrome.storage.local.get` → mutate → `set` を生のまま実行する
- `withOptimisticLock` も `PersistentRetryQueue` も不使用。同時 enqueue で 1 エントリ喪失する
- キュー族の他メンバーは全て保護済みで、この 1 つだけが例外
- 注意: `pbi/2026-09-28-00-backlog-refactor-round.md:61` に同ファイルの「残キー裁定」台帳行がある（スコープは異なる。実装時に記録照会する）

### item 4: chrome.idle listener の蓄積

- `src/background/localMarkdownIdleFlusher.ts:59-65` で `chrome.idle.onStateChanged` の listener を登録しているが、remove せず再登録毎に蓄積する
- 同じ関数は alarm の clear（`:53-54`）だけは丁寧に await しており、非対称
- 到達経路: `service-worker.ts:51-58`（SW 起動）と `REFRESH_LOCAL_MARKDOWN_SCHEDULER` メッセージ（`MessageRouter.ts:188` → `systemHandlers.ts:248`）。dashboard は設定保存・接続テストごとに送信する（`src/dashboard/generalSettings/connectionTests.ts:188,261,399,479`）
- 結果: SW 生存中に N listener となり、idle 遷移で `flushBufferedExports` が N 回走る。flush は全 storage 読み（`src/background/localMarkdownExportCore.ts:42`）なので増幅は無視できない
- 同一バグ型は `src/background/manualContentFetcher.ts:119-121` で修正済み（コメント「the timeout path used to leave the listener registered, accumulating one listener per manual fetch」）

## 改善方針（方向性）

1. DI は「実配線」か「manifest エントリ削除」のどちらかに統一し、JSDoc を現実に一致させる（ADR `dev-docs/ADR/2026-09-17-module-singleton-policy.md` 準拠）。production からの呼び出しを残さないなら、JSDoc の主張を消す
2. `pendingSqliteQueue` の計測を flush の lock 内に移動する。`pendingChromeStorageQueue.ts:83-107` の修正済み実装を移植する
3. `feedbackQueue` を `withOptimisticLock` 化する。規模が合えば `PersistentRetryQueue` + merge policy 化を選択する
4. idle listener を named function 化し、再登録前に `removeListener` する。`manualContentFetcher.ts:119-121` の cleanup パターンを踏襲する

## BDD 受け入れシナリオ

```gherkin
Scenario: DI 配線が契約と一致する
  Given compositionManifest に pendingWriteQueue が登録されている
  When createBackgroundServices が完了する
  Then facade の activeQueue と container の singleton が同一インスタンスである
  もしくは manifest への登録が削除済みで、存在しない依存を名指ししていない

Scenario: mid-flush enqueue でも計測が壊れない
  Given flush 実行中に新規レコードが enqueue される
  When flush が完了する
  Then recovered / remaining の log が負値にならない

Scenario: 同時 enqueue でエントリを失わない
  Given 2 つの enqueueFeedback が並行実行される
  When 両方が完了する
  Then キューに 2 エントリが残る

Scenario: idle listener が蓄積しない
  Given initExportScheduler が 3 回呼ばれる
  When idle 状態に遷移する
  Then flushBufferedExports は 1 回だけ実行される
```

## 受け入れ基準

- [x] `src/background/pendingChromeStorageQueue.ts:128-131` の JSDoc が production の実態に一致する（実配線、または「production では未接続」の明記）
- [x] `src/background/compositionManifest.ts:114` に登録されたまま到達不能な `pendingWriteQueue` エントリが残っていない
- [x] `src/background/pendingSqliteQueue.ts:77` と `:94-99` の recovered / remaining 計算が flush の lock 内で行われ、`src/background/pendingChromeStorageQueue.ts:83-107` と同じ形になっている
- [x] `src/utils/aiSummaryCleaner/feedbackQueue.ts:52-68` と `:78-82` が `withOptimisticLock`（または `PersistentRetryQueue` + merge policy）で保護されている
- [x] `src/background/localMarkdownIdleFlusher.ts:59-65` の listener が named function 化され、`initExportScheduler` の再登録前に `removeListener` される（alarm の clear `:53-54` と同じ await 規約に従う）
- [x] 4 つの変更が対象ファイルが重複しないこと（1 つ目: manifest / DI 周辺、2 つ目: pendingSqliteQueue、3 つ目: feedbackQueue、4 つ目: localMarkdownIdleFlusher）

## テスト戦略

- 単体: 各 4 項目をそれぞれ独立に検証する（配線は container テストで facade と container の同一性を確認、計測は pendingSqliteQueue の flush 中 enqueue、RMW は feedbackQueue の交差テスト、listener は idle flusher の複数回初期化後の multiplicity）
- 既存テストの据え置き: `pendingChromeStorageQueue.test.ts:11` 周辺の `setPendingWriteQueue` 呼び出しは、方針決定（実配線 / 削除）に合わせて整合させる
- 台帳照会の確認: `pbi/2026-09-28-00-backlog-refactor-round.md:61` の裁定記録と矛盾しないことを実装時に確認する

## 見積もり

1.0 SP

## Definition of Done

- [ ] BDD シナリオに対応するテストがパスする
- [ ] `npm run validate` が通る
- [ ] コードレビュー完了

## 実装記録（2026-09-29）

- **item 1（DI 配線）**: `compositionManifest.ts` の `pendingWriteQueue` エントリに `onReady` を追加し、`createBackgroundServices` の既存 onReady ループ（`:96-101`）で `setPendingWriteQueue(container.resolve(...))` を実行。JSDoc を実態（manifest onReady 経由の実配線）に一致させ、`createBackgroundServices.ts:94` のコメントも setSqliteHealthCheck への言及を削除して実態のみを記述。テスト: `createBackgroundServices.test.ts` に「override した fake queue に facade の `flushPendingWrites` が委譲される」を pin
- **item 2（計測 twin）**: `pendingSqliteQueue.ts` を `pendingChromeStorageQueue.ts:83-107` と同じ形（lock 内計測 + load 失敗時の ERROR log と早期 return）に移植。`getQueueSize()` の pre/post 計測を廃止。テスト: 成功時の recovered/remaining（既存 pin が不変で通過）+ load 失敗を empty と誤認しない
- **item 3（feedbackQueue）**: `enqueueFeedback` / `clearFeedbackQueue` / `removeFeedbackEntry` を `withOptimisticLock` 経由に変更（`PersistentRetryQueue` への移行は診断キューとしては過剰なため不採用）。キー・export/import 形式は不変。テスト: 並行 enqueue 2 件が両方生存 / 並行 remove+enqueue が両方反映
- **item 4（idle listener）**: listener を named function `onIdleStateChanged` に抽出し、timing 分岐の前に無条件 `removeListener` → idle 分岐で `addListener`。モード切替（idle→daily/manual）で旧 listener が残る問題も同時に解消。テスト: 3 回再初期化で同一関数が remove→add され実効登録 1 件 / idle→daily 切替で remove される

検証: `npx vitest run <4 test files>` → 4 files / 55 tests passed。`npm run validate` とコードレビューは未実施（バッチゲートで実施）。
