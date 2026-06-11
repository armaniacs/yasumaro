# PBI: SQLite データ整合性強化 & マイグレーション安全化

## ユーザーストーリー
**既存ユーザー**として、**ChromeストレージからSQLiteへの安全なデータ移行**がほしい、なぜなら**重複データや整合性破壊なく、既存の閲覧履歴を完全に引き継ぎたい**から

## ビジネス価値
- 既存ユーザーのデータ損失リスクをゼロにする
- マイグレーション失敗時の再試行を安全にする
- 大量データ（10,000件超）でもタイムアウトせずに移行完了する

## BDD受け入れシナリオ

```gherkin
Scenario: 既存ユーザーのデータが重複なく移行される
  Given Chromeストレージに1000件の閲覧履歴がある
  And SQLiteのbrowsing_logsテーブルにUNIQUE(url, created_at)制約がある
  When マイグレーションサービスが実行される
  Then 全てのレコードがINSERT OR IGNOREで挿入される
  And 重複レコードは自動的にスキップされる
  And 移行後のレコード数がChromeストレージのユニーク数と一致する

Scenario: マイグレーション中にクラッシュしても再開できる
  Given マイグレーションが500件まで進行している
  And progressがchrome.storage.localに保存されている
  When サービスワーカーが再起動する
  Then 501件目から再開される
  And 既に挿入済みのレコードはINSERT OR IGNOREでスキップされる

Scenario: バルクINSERTで大量データを高速に移行
  Given 10000件のレガシーデータがある
  When マイグレーションが実行される
  Then 100件ずつバルクINSERTされる
  And 合計100回のメッセージングで完了する
  And Service Workerのタイムアウト（30秒）以内に完了する

Scenario: CHECK制約で不正なデータが拒否される
  Given browsing_logsテーブルにCHECK制約が設定されている
  When is_starred=2のレコードを挿入しようとする
  Then SQLITE_CONSTRAINTエラーが発生する
  And レコードは挿入されない

Scenario: SQLITE_INSERTのペイロードサイズが制限される
  Given offscreenドキュメントのSQLITE_INSERTハンドラ
  When summaryが1MBを超えるペイロードを受信する
  Then エラーレスポンスを返す
  And データベースには書き込まれない
```

## 受け入れ基準
- [ ] `browsing_logs`テーブルに`UNIQUE(url, created_at)`制約を追加
- [ ] `INSERT`を`INSERT OR IGNORE`に変更（migrationService.ts）
- [ ] `is_starred`, `is_deleted`に`CHECK(is_starred IN (0, 1))`制約を追加
- [ ] `scroll_ratio`に`CHECK(scroll_ratio IS NULL OR (scroll_ratio >= 0 AND scroll_ratio <= 1))`制約を追加
- [ ] `visit_duration`に`CHECK(visit_duration IS NULL OR visit_duration >= 0)`制約を追加
- [ ] `insertBatch()`メソッドを`src/offscreen/sqlite.ts`に実装
- [ ] `MigrationService`が`BATCH_SIZE=100`単位でバルクINSERTを使用
- [ ] `SQLITE_INSERT`ハンドラにペイロードサイズチェック（1MB上限）を追加
- [ ] `DASHBOARD_SQLITE.update`の`changes`キーをSW側でallowlist検証

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 既存ユーザーのデータ移行シナリオ（1000件→SQLite）
- マイグレーション中断→再開シナリオ

### 統合テスト
- `MigrationService` + `SqliteClient` + `offscreen/sqlite.ts`の連携
- バルクINSERTのパフォーマンステスト（10000件）

### 単体テスト
- `INSERT OR IGNORE`の動作確認（重複URL）
- CHECK制約の検証（不正値でエラー）
- ペイロードサイズチェックの境界値テスト
- `insertBatch()`のトランザクション動作

## 実装アプローチ
- **Outside-In**: E2Eテスト（移行シナリオ）→ 統合テスト（バルクINSERT）→ 単体テスト（制約）
- **Red-Green-Refactor**: 各テストが失敗することを確認してから実装
- **リファクタリング**: グリーン後にパフォーマンス最適化

## 見積もり
8 ポイント（中規模）

## 技術的考慮事項
- 依存関係: なし（既存のSQLiteスキーマ拡張）
- テスタビリティ: モック不要（実際のSQLiteでテスト）
- 非機能要件: パフォーマンス（10000件を30秒以内）、整合性（ACID）

## 実装者向け注記

### 現状コードの確認
```bash
# スキーマ定義を確認
grep -n "CREATE TABLE browsing_logs" src/offscreen/sqlite.ts

# マイグレーションロジックを確認
grep -n "INSERT INTO browsing_logs" src/background/migrationService.ts

# offscreenハンドラを確認
grep -n "SQLITE_INSERT" src/offscreen/offscreen.ts
```

### 実装手順
1. `src/offscreen/sqlite.ts`の`SCHEMA_SQL`にUNIQUE制約とCHECK制約を追加
2. `insertBatch()`メソッドを実装（トランザクション付きバルクINSERT）
3. `src/background/migrationService.ts`で`insertBatch()`を使用
4. `src/offscreen/offscreen.ts`の`SQLITE_INSERT`ハンドラにサイズチェックを追加
5. `src/background/service-worker.ts`の`DASHBOARD_SQLITE.update`にallowlist検証を追加

### 落とし穴
- UNIQUE制約追加時に既存データに重複があるとマイグレーションが失敗する → `INSERT OR IGNORE`で回避
- CHECK制約はALTER TABLEでは追加できない → スキーマ再作成 or 新規テーブル作成が必要
- バルクINSERT時にFTS5トリガーが大量に発火 → パフォーマンス影響を確認

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み
