# PBI: purgeLegacyStorage実行前のSQLite健全性チェック追加

## ユーザーストーリー
ユーザーとして、chrome.storageのクォータ超過時に自動実行される古いデータのクリーンアップが、SQLiteへのデータ保存が正常に機能している場合にのみ行われてほしい、なぜならSQLiteが利用不可（OPFS障害・マイグレーション未完了等）の状態でchrome.storageの唯一のコピーが削除されると、閲覧履歴データが永久に失われる可能性があるから

## ビジネス価値
- SQLite移行期・障害時のデータ永久喪失事故を防ぐ
- クォータ超過という日常的に起こりうるイベントが、レアな障害状態と組み合わさった際の破滅的なデータロスを回避する

## 背景（レビュー指摘）
- 指摘者: Legacy Bridge Architect（[plans/2026-07-09-1633-review-feat-6_5.md](../plans/2026-07-09-1633-review-feat-6_5.md) High指摘3件目）
- 場所: `src/utils/storage.ts:1107-1155`（`purgeLegacyStorage()`）、呼び出し元は同ファイル774行目 `saveSettings()` 内
- 現状: `saveSettings()` はストレージクォータ超過を検知すると自動的に `purgeLegacyStorage()` を呼び出し、`savedUrlsWithTimestamps` から大きなメタデータフィールド（content, aiSummary等）を削除し `savedUrls` キー自体を完全削除する。この際、SQLite側に該当データが正常に保存済みかどうかのチェックが一切ない。
- 決定事項: (a) SQLiteの健全性チェックを追加してから実行する。→ この方針(a)を採用する

## BDD受け入れシナリオ

```gherkin
Scenario: SQLiteが正常な場合、従来通りレガシーストレージがクリーンアップされる
  Given SQLiteデータベースが正常に読み書き可能な状態である
  And chrome.storageのクォータが近い将来超過する見込みである
  When saveSettings()がクォータ超過を検知しpurgeLegacyStorage()を呼び出す
  Then savedUrlsWithTimestampsの大きなメタデータフィールドが削除される
  And savedUrlsキーが削除される
  And ストレージ使用量が減少する

Scenario: SQLiteが利用不可の場合、破壊的なクリーンアップは行われない
  Given SQLiteデータベースが利用不可（OPFS初期化失敗、マイグレーション未完了など）である
  And chrome.storageのクォータが近い将来超過する見込みである
  When saveSettings()がクォータ超過を検知しpurgeLegacyStorage()を呼び出そうとする
  Then savedUrlsWithTimestampsの大きなメタデータフィールドは削除されない
  And savedUrlsキーは保持される
  And SQLite不可を理由にクリーンアップをスキップした旨がログに記録される
  And 設定保存自体はクォータエラーとして失敗する（データを危険にさらして無理に保存しない）

Scenario: SQLite健全性チェック自体が失敗した場合も安全側に倒れる
  Given SQLite健全性チェックの実行中に例外が発生する
  When purgeLegacyStorage()が呼び出される
  Then 健全性が確認できないため破壊的な削除処理は実行されない
  And エラーがログに記録される
```

## 受け入れ基準
- [ ] `purgeLegacyStorage()` の実行前にSQLiteの健全性を確認する処理が追加されている
- [ ] 健全性チェックは「SQLiteクライアントが初期化済みかつ簡易なread/write（もしくはヘルスチェッククエリ）が成功する」ことを確認する
- [ ] SQLiteが健全でない場合、`savedUrlsWithTimestamps` の大きなフィールド削除・`savedUrls` キー削除のいずれも実行されない
- [ ] SQLiteが健全でない場合の挙動（クリーンアップスキップ）がログに記録され、呼び出し元の `saveSettings()` はクォータ超過エラーとして扱う
- [ ] 既存のクォータ超過時の正常系（SQLite健全）の挙動に変化がない
- [ ] 健全性チェック自体の例外はキャッチされ、安全側（クリーンアップしない）に倒れる

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- （このロジックはService Worker内部処理のため、E2Eは対象外とし統合テストで代替する）

### 統合テスト
- `saveSettings()` を呼び出し、chrome.storageのクォータをモックで超過状態にし、SQLiteクライアントが正常/異常それぞれのケースで `purgeLegacyStorage()` の呼び出し結果（savedUrlsWithTimestampsが変化したか）を検証

### 単体テスト
- `purgeLegacyStorage()` 単体テスト
  - SQLite健全 → 従来通りクリーンアップが実行される
  - SQLite不健全（クライアント未初期化） → クリーンアップがスキップされ freed が 0 になる
  - SQLite不健全（ヘルスチェッククエリが例外を投げる） → クリーンアップがスキップされる
  - 新設する健全性チェック関数自体の単体テスト（成功/失敗/例外の3パターン）

## 実装アプローチ
- **Outside-In**: 統合テスト（saveSettings→クォータ超過→SQLite状態別の挙動）を先に書き、失敗を確認してから実装する
- **Red-Green-Refactor**: 健全性チェック関数を単体テストで先に固めてから `purgeLegacyStorage()` に組み込む
- **リファクタリング**: グリーン後、健全性チェックのタイムアウト処理など安全性を高める改善を検討する

## 見積もり
3pt（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: SQLiteクライアント（`src/background/sqliteClient.ts` 等）へのアクセスが必要。Service Worker内で完結するロジックなのでOffscreen Document経由の通信を要する可能性がある
- テスタビリティ: SQLiteクライアントをモック化し、健全/不健全を切り替えてテストする
- 非機能要件: 健全性チェックはクォータ超過という緊急性の高い場面で呼ばれるため、軽量かつタイムアウト付きであることが望ましい

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -n "purgeLegacyStorage\|SQLITE_HEALTH\|isSqliteHealthy\|sqliteClient" src/utils/storage.ts
grep -rn "class SqliteClient" src/background/sqliteClient.ts
grep -rn "healthCheck\|ping\|isReady" src/background/sqliteClient.ts src/offscreen/sqlite.ts
```
既存のSQLiteクライアントに健全性確認用のメソッドが既にあるか確認すること。なければ新規追加が必要。

### 実装手順
1. `SqliteClient`（または相当のクラス）に軽量な健全性チェックメソッド（例: `isHealthy(): Promise<boolean>`、簡易な `SELECT 1` 相当のクエリ）がなければ追加する
2. `src/utils/storage.ts` の `purgeLegacyStorage()` 冒頭で健全性チェックを呼び出し、不健全なら早期リターン（freed=0、ログ記録）する
3. `saveSettings()` 側は `purgeLegacyStorage()` の戻り値（freed）が0でクォータが依然超過している場合、既存のエラーハンドリング（`Storage quota exceeded`エラー投げ）がそのまま機能することを確認する
4. Service Workerからのヘルスチェック呼び出しがOffscreen Document経由になる場合、メッセージパッシングのタイムアウトを設定する

### 落とし穴
- `storage.ts` はService Worker/popup/dashboard等複数コンテキストから呼ばれるため、SQLiteクライアントへの参照方法がコンテキストによって異なる可能性がある。既存の `sqliteClient` 参照パターン（シングルトンかDIか）を踏襲すること
- 健全性チェックが重い処理になるとクォータ超過という頻発しうるイベントのたびにオーバーヘッドが生じる。シンプルな接続確認に留めること
- テストではchrome.storage.local のモックとSQLiteクライアントのモックを両方セットアップする必要がある

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（該当する場合、ADRへの追記）
