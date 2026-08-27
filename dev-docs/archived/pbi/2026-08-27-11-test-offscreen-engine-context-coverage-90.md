# PBI: offscreen/sqliteEngineContext カバレッジ 90% 達成

## ユーザーストーリー
開発者として、`offscreen/sqliteEngineContext` カバレッジを 86.85% → 90% 以上に引き上げたい、なぜなら `opfsWorkerProxy 72%` / `migrationBackup 92%` / `idbEngineLifecycle` の未達分岐が WASM 初期化競合やマイグレーション失敗の回帰を隠すから。

## 優先度
- 順位: 3 / 4
- RICEスコア: 240（Reach=40 / Impact=1.5 / Confidence=80% / Effort=0.2）
- 根拠: WASM 初期化は起動時に全ユーザに影響 (Reach=40)。Statements 残り 3pt で 90% 到達。既存 `wasm-worker-lifecycle.test.ts` で境界はカバーしたが Context 層の分岐が残るため Effort 0.2。

## なぜなぜ分析
- なぜ低いか: `sqliteEngineContext.ts:80%` の未達は `FALLBACK_MODE` 切替と `fts5Available` の 3分岐、`opfsWorkerProxy` の `sendToOpfsWorker` の 15s タイムアウトと `terminate` パスが未テスト
- なぜテストしなかったか: `wasm-worker-lifecycle.test.ts` は `sqliteEngine` (WASM 直) をテストし Context 層のフォールバック分岐は対象外だった
- 解: Context の `_doInit` で OPFS Worker 生成失敗 → IDB フォールバック、分岐後の `fts5Available` 反映、タイムアウト時の `terminate` を注入テストで追加

## BDD受け入れシナリオ
Scenario: ハッピーパス — OPFS Worker が正常に初期化される
  Given `Worker` 生成が成功する環境
  When `sqliteEngineContext.init()` を呼ぶ
  Then `opfsWorker` が生成され `fts5Available` が `compile_options` から取得される

Scenario: エッジケース — OPFS タイムアウトで IDB にフォールバック
  Given `Worker` からの応答が 15s 以内に返らない
  When `sendToOpfsWorker` を呼ぶ
  Then `TimeoutError` で IDB エンジンにフォールバックし `fallback` フラグが立つ

## 受け入れ基準
- [x] `src/offscreen/sqliteEngineContext/opfsWorkerProxy.ts` の Statements が 90% 以上に到達する
- [x] `src/offscreen/sqliteEngineContext.ts` の Statements が 90% 以上に到達する (現在 80.72%)
- [x] `offscreen/sqliteEngineContext` ディレクトリ全体の Statements が 90% 以上になる
- [x] `npx vitest run --coverage` で All files Statements が 92.1% → 93% 以上に改善する

## テスト戦略
- 単体: `opfsWorkerProxy` の `isOpfsAvailable` / `canCreateWorker` / `sendToOpfsWorker` の 3分岐を `vi.useFakeTimers` で検証。`sqliteEngineContext` の `_doInit` の OPFS→IDB→Fallback 3分岐をモックで検証
- 統合: 実 `chrome.storage.local` + `Worker` mock で初期化→クエリ→close のライフサイクルを検証
- E2E: `wasm-boundary-comprehensive.spec.ts` の WASM load タイムアウトケースを追加

## 見積もり
2pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `npx vitest run --coverage` で該当ディレクトリ 90% 以上を達成
- [x] コードレビュー完了
- [x] ドキュメント更新済み
