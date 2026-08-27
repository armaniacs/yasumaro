# PBI: Mutex タイムアウト二重resolve

## ユーザーストーリー
開発者として、`Mutex` のタイムアウトと `release()` によるロック移譲が競合して二重 resolve しないようにしたい、なぜなら `acquire()` の `setTimeout` が `queue.delete(taskId)` のみで `clearTimeout` との競合を防がないため、タイムアウト発火と `release()` による `resolve()` が同一タスクに対してほぼ同時に実行され、Promise の二重解決や `nextTaskId` の単調増加によるオーバーフローで長時間稼働時にキュー破損・デッドロックに至る可能性があるから。

## 優先度
- 順位: 8 / 17
- RICEスコア: 140（Reach=20 / Impact=1 / Confidence=70% / Effort=0.1）
- 根拠: `PerUrlMutexMap` 経由で並行記録を行う全ユーザーに影響 (Reach=20)。二重 resolve は稀なタイミング競合であり通常は1回目の resolve が優先されるため Impact は低 (1)。競合ウィンドウはタイムアウト境界でのみ発生するため Confidence=70%。`clearTimeout` 競合防止と `nextTaskId` 上限対応の小修正で Effort=0.1。

## なぜなぜ分析
- なぜ二重 resolve するか: `src/utils/Mutex.ts:71-84` のタイムアウトハンドラが `queue.delete(taskId)` 後に `reject` し、`release()` 側も `queue.delete(taskId)` 後に `resolve` するため、両者が同一 `taskId` を同時に処理する競合ウィンドウがある
- なぜ `clearTimeout` が不足するか: `release()` 側で `clearTimeout(task.timeoutId)` は行うが、タイムアウト側で `resolve` 済みタスクの `clearTimeout` 相当のガードがなく、逆方向のキャンセルが不完全
- なぜ `nextTaskId` が問題か: `nextTaskId` が `number` で単調増加し上限チェックがないため、長時間稼働・高頻度 `acquire()` で `Number.MAX_SAFE_INTEGER` を超えると Map キーの衝突や精度喪失が起こり得る
- 解: タイムアウト発火時に `queue.has(taskId)` を確認してから `reject` し、`release()` 側も `clearTimeout` 後に `queue` から削除済みかを再確認する競合防止と、`nextTaskId` の上限でラップアラウンドまたはリセット対応を追加

## BDD受け入れシナリオ
Scenario: ハッピーパス — 正常な acquire/release は従来通り動作する
  Given `mutex = new Mutex({ timeoutMs: 1000 })`
  When `await mutex.acquire(); mutex.release();`
  Then ロックが正常に取得・解放される

Scenario: 競合 — タイムアウトと release の同時発火で二重 resolve しない
  Given `mutex` がロック中、1件がキューで待機、`timeoutMs` 直前に `release()` を呼ぶ
  When タイムアウトタイマーが発火する
  Then 待機 Promise は `resolve` か `reject` のいずれか1回のみで確定し、二重解決しない

Scenario: 競合 — タイムアウト後に release が同 taskId を再処理しない
  Given 待機タスクがタイムアウトで `reject` 済み
  When `release()` がキューを処理する
  Then タイムアウト済み `taskId` はスキップされ次のタスクに移譲される

Scenario: エッジ — nextTaskId が上限に達してもキューが破損しない
  Given `nextTaskId` が `Number.MAX_SAFE_INTEGER` 付近
  When さらに `acquire()` でキューイングする
  Then `taskId` が衝突せず、既存タスクを上書きしない（ラップアラウンドまたは空きID再利用）

Scenario: エッジ — clearTimeout が確実に呼ばれる
  Given タイムアウト前に `release()` でロックが移譲された
  When 移譲が完了する
  Then 当該タスクの `timeoutId` に対して `clearTimeout` が呼ばれ、遅延 reject が発火しない

## 受け入れ基準
- [x] `src/utils/Mutex.ts:71-84` のタイムアウトハンドラが `queue.has(taskId)` ガードまたは `clearTimeout` 競合防止ロジックを持つ
- [x] `release()` 側もタイムアウト済みタスクをスキップするガードがある
- [x] `nextTaskId` が上限に達した場合に衝突しない対応（ラップアラウンド、未使用ID探索、または `MAX_SAFE_INTEGER` リセット）が実装されている
- [x] 単一タスクに対する `resolve` / `reject` が二重に呼ばれないことをテストで保証する
- [x] `npx vitest run src/utils/__tests__/Mutex.test.ts` がパスする

## テスト戦略
- 単体: `vi.useFakeTimers` でタイムアウト境界の競合を再現（`release()` と `setTimeout` の同時発火）、`nextTaskId` を `MAX_SAFE_INTEGER - 1` に設定してラップアラウンドテスト
- 統合: `PerUrlMutexMap` 経由で並行 `acquire()` を多数実行し、デッドロックしないことを検証
- E2E: 不要

## 見積もり
0.1pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
