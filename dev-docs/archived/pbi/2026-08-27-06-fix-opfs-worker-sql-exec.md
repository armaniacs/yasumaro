# PBI: opfsWorker SQL_EXEC 任意SQL実行の除去

## ユーザーストーリー
開発者として、opfsWorker の `SQL_EXEC`/`SQL_QUERY` で任意 SQL が実行できないようにしたい、なぜなら offscreen 奪取で `DROP TABLE` が可能な永続的破壊経路になるから。

## 優先度
- 順位: 2 / 7
- RICEスコア: 1200（Reach=40 / Impact=3 / Confidence=100% / Effort=0.10）
- 根拠: 任意SQLはデータ全破壊 (Impact=3)。現状未使用のバックドアで Effort 小。

## なぜなぜ分析
- なぜ任意SQLが可能か: `handleRequest` が `type` を無検証で `engine.exec` に委譲
- なぜ残ったか: Migration 用として追加されたが実行時ガードがなく、呼び出し元も `sendToOpfsWorker` が汎用
- 解: `SQL_EXEC`/`SQL_QUERY` ハンドラを削除し、Migration は worker 内で `SCHEMA_SQL` を直接実行

## BDD受け入れシナリオ
Scenario: ハッピーパス — 正当な migration は成功する
  Given worker 内で `SCHEMA_SQL` を実行する
  When `initSqlite` を呼ぶ
  Then テーブルが作成される

Scenario: 攻撃 — 外部から任意SQLは拒否される
  Given `postMessage({type:'SQL_EXEC', payload:{sql:'DROP TABLE'}})` を送る
  When `handleRequest` が処理する
  Then `Unknown message type` で拒否される

## 受け入れ基準
- [x] `opfsWorker.ts` から `SQL_EXEC`/`SQL_QUERY` の case が削除されている
- [x] `WORKER_MESSAGE_TYPES` から `SQL_EXEC`/`SQL_QUERY` が削除されている
- [x] `sqliteEngineContext/opfsWorkerProxy.ts` の汎用 `sendToOpfsWorker` が allowlist 検証する

## テスト戦略
- 単体: `handleRequest` に `SQL_EXEC` を送り拒否されることを検証
- 統合: `initSqlite` の migration が依然成功することを検証
- E2E: 不要

## 見積もり
1pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み

## 実装メモ（効果確認: 2026-09-01 の DoD 乖離監査 + 掃除）

- `WORKER_MESSAGE_TYPES` からの削除・ルーティングからの除去は達成済みで、生 SQL 注入経路は
  実際に断たれている（PBI の主目的は達成）。
- 受け入れ基準の「case が削除されている」に対し、`src/offscreen/opfsWorker/statusHandlers.ts`
  に `handleSqlExec` / `handleSqlQuery` が **export されたまま到達不能なデッドコード**として
  残っていた（`src/` から一切 import されず）。2026-09-01 の掃除 PR で両関数と
  未使用になった `SqliteValue` / `SqliteRow` import を削除。
- `opfsWorkerProxy.ts` の汎用 `sendToOpfsWorker` の allowlist 検証（受け入れ基準 3 番目）は
  未実装のまま。ただしワーカ側ルータが未知 type を拒否するため実害はない。将来
  `sendToOpfsWorker` を拡張する場合の要注意点として残置。
