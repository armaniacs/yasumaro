# PBI: perUrlMutex Queue full時のエントリー残留

## ユーザーストーリー
開発者として、`PerUrlMutexMap` が `maxQueueSize` 超過で `throw` した場合でも map エントリーが残留しないようにしたい、なぜなら Queue full で待機失敗した URL の Mutex エントリーが `Map` に残り続け、後続の正常な recording が古いキュー状態を引きずるメモリリークと誤った直列化の原因になるから。

## 優先度
- 順位: 6 / 17
- RICEスコア: 315（Reach=30 / Impact=1.5 / Confidence=70% / Effort=0.1）
- 根拠: 同一 URL への並行 recording は高頻度ではないが、スパム的に同一 URL を連打するページやリトライ暴発で到達可能。Reach=30（recording 利用者）。Impact=1.5（メモリリーク＋直列化の誤動作で重複保存/欠損の可能性）。Confidence=70%（`Mutex.acquire()` の queue-full throw 時に `acquired=false` で `finally` の delete がスキップされることはコードで確実だが、実害の再現は高並行時のみ）。Effort=0.1（finally 分岐の追加）。

## なぜなぜ分析
- なぜ残留するか: `src/background/pipeline/perUrlMutex.ts:65-87` の `runExclusiveOn` で `acquired` フラグが `false` のまま `throw` されると `finally` 内の `if (acquired)` が偽で `map.delete(url)` が実行されないため
- なぜ throw 時に delete がスキップされる設計だったか: `acquired=true` の正常系でのみ `release` → `delete` する安全側の実装だったが、acquire 失敗時（queue-full / timeout）のエントリー自体が不要になるケースを考慮していなかったため
- なぜ気づかなかったか: 通常の並行度（1-2件）では `maxQueueSize: 5` に到達せず、queue-full が発動する高並行テストが存在しなかったため
- 解: `catch` または `finally` で `acquire` 失敗時も `if (!mutex.isLocked() && mutex.getQueueSize() === 0) map.delete(url)` を実行。または `getOrCreate` で作成した直後に失敗した場合は即時 delete

## BDD受け入れシナリオ
Scenario: ハッピーパス — 正常な排他実行後は idle ならエントリーが削除される
  Given `PerUrlMutexMap` に URL `https://example.com/a` のエントリーが存在する
  When `runExclusive(url, fn)` が成功し `fn` が完了する
  Then `mutex.isLocked()===false && getQueueSize()===0` なら `map.delete(url)` され、次回 `getOrCreate` は新規 Mutex を生成する

Scenario: バグ再現 — Queue full throw 時もエントリーが残留しない
  Given `maxQueueSize: 5` の Mutex に 5 件の待機が詰まっている
  When 6 件目の `runExclusive(url, fn)` が `Queue full` で throw される
  Then `map` に当該 URL のエントリーが残留せず（または idle 条件で削除され）、メモリリークしない

Scenario: 境界 — timeout throw 時も同様にクリーンアップされる
  Given `timeoutMs: 60000` で acquire がタイムアウトする
  When `runExclusive` が timeout で throw される
  Then エントリーは idle なら削除され、後続の `runExclusive` は正常に取得できる

## 受け入れ基準
- [x] `src/background/pipeline/perUrlMutex.ts:65-87` の `runExclusiveOn` が `acquire` 失敗（queue-full / timeout）時にも `map.delete(url)` を条件付きで実行する（`!isLocked() && getQueueSize()===0` ガード維持）
- [x] 静的パス `runExclusiveStatic` でも同様のクリーンアップが行われる（`runExclusiveOn` 単一経路なら自動的に満たす）
- [x] 既存の `RecordingPipeline` 並行テストがパスする
- [x] queue-full 時の map 残留を検証する単体テストが1件以上追加されている
- [x] `npm run type-check` がパスする

## テスト戦略
- 単体: `PerUrlMutex` の queue-full 回帰テスト — `maxQueueSize: 1` の小さい Mutex で 2件同時 `runExclusive` → 2件目が throw → `map.has(url) === false`（または `getQueueSize()===0 && !isLocked()` なら delete）を検証。`Mutex` を直接モックして `acquire` が throw するケースもカバー
- 統合: `RecordingPipeline` で同一 URL への 6 並行 recording を発火し、queue-full が発生しても後続の recording が正常に完了すること
- E2E: 不要

## 見積もり
1pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
