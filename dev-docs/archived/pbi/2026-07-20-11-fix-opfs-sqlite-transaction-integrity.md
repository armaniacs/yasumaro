# PBI: OPFS SQLite トランザクション整合性強化 — WAL mode・BEGIN IMMEDIATE・単一トランザクション

元指摘: Checking Team (High: Data Integrity Expert)

## 実装状況（調査日: 2026-07-20、状態: ⬜ 未着手）

## ユーザーストーリー

開発チームとして、OPFS SQLite パス (`src/offscreen/opfsWorker.ts`) のトランザクション処理を IDB パス (`sqliteEngineContext.ts`) と同水準に整備したい。なぜなら、現在の OPFS パスでは `BEGIN` (DEFERRED) を使用しており並行アクセス時に `SQLITE_BUSY` リスクがあり、さらに `handlePurgeOldRecords` の2段階 DELETE が別トランザクションで実行されているため、部分的なパージ状態になりうるから。

## ビジネス価値

- 並行読み書き時のデータ整合性向上
- 統計ログ（insertBatch 件数）の正確性向上
- パージ処理の原子性確保

## 前提・制約

- IDB パス (`sqliteEngineContext.ts:289-290`) では既に `PRAGMA journal_mode=WAL` を schema 実行前に設定しており、これを OPFS パスにも合わせる
- `handleInsertBatch` の `inserted++` ローカルカウンタは `INSERT OR IGNORE` の実挿入件数と一致しないため、`SELECT changes()` に置き換える
- `sqlExec` / `sqlQuery` ヘルパーは既に存在

## BDD受け入れシナリオ

```gherkin
Feature: OPFS SQLite transaction integrity

  Scenario: OPFS init sets WAL mode before schema
    Given `initSqliteInner()` is called
    When engine is created
    Then `PRAGMA journal_mode=WAL` is executed before `SCHEMA_SQL`

  Scenario: insertBatch uses immediate transaction and accurate count
    Given `handleInsertBatch(records)` is called with some duplicate records
    When the transaction commits
    Then `BEGIN IMMEDIATE` is used
    And the returned count equals `SELECT changes()` result
    And it is not equal to the number of attempted INSERTs

  Scenario: purge old records is atomic
    Given `handlePurgeOldRecords` is called
    When retention-based DELETE and maxRecords-based DELETE both run
    Then they are wrapped in a single `BEGIN IMMEDIATE ... COMMIT`
    And partial purge does not occur
```

## 受け入れ基準

- [ ] `src/offscreen/opfsWorker.ts` の `initSqliteInner()` で `engine.exec(SCHEMA_SQL)` の直前に `PRAGMA journal_mode=WAL` を実行
- [ ] `handleInsertBatch()` で `BEGIN` → `BEGIN IMMEDIATE` に変更
- [ ] `handleInsertBatch()` 内の `inserted++` カウンタを削除し、COMMIT 直後に `SELECT changes()` を1回実行して実挿入件数を返す
- [ ] `handlePurgeOldRecords()` の2段階 DELETE を `BEGIN IMMEDIATE ... COMMIT` で単一トランザクションにラップ
- [ ] `npm run type-check` / `npm test` が成功

## テスト戦略

### 単体テスト
- `opfsWorker.test.ts` または新規テストで `initSqliteInner` の `PRAGMA journal_mode` 確認
- `handleInsertBatch` の重複レコード時の件数検証
- `handlePurgeOldRecords` の2段階 DELETE が同一トランザクションであることの検証

### 統合テスト
- OPFS パスで並行 `insertBatch` 呼び出し時の整合性確認

## 実装アプローチ

- **Inside-Out**: `initSqliteInner` の WAL 設定 → `handleInsertBatch` → `handlePurgeOldRecords` の順に修正
- 既存のテストが `inserted` カウンタの値を前提としていないか確認

## 見積もり
2pt（WAL 追加 + BEGIN IMMEDIATE + changes() 単一化 + purge トランザクション統合）

## 副作用
🟡 軽微 — トランザクション挙動の変更。既存テストで件数アサーションが変わる可能性があるが、実態に即した正しい値となる。

## 落とし穴
- `INSERT OR IGNORE` 時の `SELECT changes()` は、SQLite では ignore された行も「変更なし」としてカウントされない。これが期待動作。
- WAL モード有効後の `PRAGMA journal_mode` 返り値が `wal` であることを確認しないと、OPFS 非対応環境でフォールバック時に気づけない。必要に応じてログ出力。

## Definition of Done
- [ ] すべての受け入れ基準を満たす
- [ ] テストが追加/更新されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
