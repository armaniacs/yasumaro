# PBI: マイグレーションロジックの共有モジュール化

## ユーザーストーリー
開発者として、`sqliteEngineContext.ts` と `opfsWorker.ts` に重複する ALTER TABLE マイグレーションループ（19カラム）と FTS5 スキーマ初期化を1つの共有モジュールに統合してほしい。
なぜなら現在同一のマイグレーションが2箇所にコピーされており、PBI-11 の `gist_synced` 追加時に両方の編集漏れのリスクが顕在化したから。

## ビジネス価値
- **保守性**: スキーマ変更が1ファイルの編集で完了。両方のバックエンドが同一順序・同一内容でマイグレーションを適用することを保証
- **バグ防止**: マイグレーション順序の不一致によるデータ不整合を防止
- **コード量削減**: 約80行の重複マイグレーションコードが削除される

## BDD受け入れシナリオ

```gherkin
Scenario: 両バックエンドが同一のマイグレーションを実行する
  Given shared/migrations.ts が MIGRATION_COLUMNS と runMigrations() をエクスポートしている
  When  IDB VFS パスと OPFS Worker パスの両方で init が呼ばれたとき
  Then 両方とも runMigrations() を呼び出し
  And 同じ順序で同じ ALTER TABLE 文が実行される

Scenario: 新規カラム追加時に1ファイル編集で両方に反映される
  Given 新規カラム "experimental_flag INTEGER DEFAULT 0" を追加したい
  When  schema.ts の MIGRATION_COLUMNS 配列に1行追加したとき
  Then sqliteEngineContext.ts も opfsWorker.ts も変更不要で
  And 両方のバックエンドが次の init で新カラムを追加する

Scenario: カラム既存時の重複エラーが抑制される
  Given カラム "content TEXT" が既に存在する
  When  runMigrations() が ALTER TABLE ADD COLUMN content TEXT を実行したとき
  Then "duplicate column name" エラーは無視され
  And その他のカラム追加は続行される

Scenario: FTS5 スキーマが存在しない場合に自動作成される
  Given browsing_logs_fts テーブルが存在しない
  When  runMigrations() が呼ばれたとき
  Then FTS5 virtual table とトリガーが作成され
  And 既存の browsing_logs 行が FTS インデックスに再構築される
```

## 受け入れ基準
- [ ] `src/offscreen/schema.ts` に `MIGRATION_COLUMNS` 定数が追加されている（19カラムの配列）
- [ ] `src/offscreen/schema.ts` に `MIGRATION_SEQUENCE` が追加されている（obsidian_synced, gist_synced などの単発マイグレーションのリスト）
- [ ] `src/offscreen/migrations.ts` が作成され、`runMigrations(engine: MigrationEngine)` 関数をエクスポートしている
- [ ] `MigrationEngine` インターフェースが定義されている（`exec(sql: string)` メソッド）
- [ ] `sqliteEngineContext.ts` の `_doInit()` から ALTER TABLE ループと FTS 再構築ロジックが削除され、`runMigrations()` 呼び出しに置き換わっている
- [ ] `opfsWorker.ts` の `initSqliteInner()` から ALTER TABLE ループが削除され、`runMigrations()` 呼び出しに置き換わっている
- [ ] 既存の全テストがパスする（後方互換性）
- [ ] 既存ユーザーの古いDBが正常にマイグレーションされる

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 古いスキーマのDBを新バージョンで開いたとき、全19カラムが追加され、FTS5 が有効化されること

### 統合テスト
- `runMigrations()` が IDB VFS パスと OPFS Worker パスの両方で正しく動作すること
- `MigrationEngine` のモック実装で全マイグレーションステップが呼ばれることを検証

### 単体テスト
- `MIGRATION_COLUMNS` が `COLUMN_NAMES` と重複なく定義されている
- `runMigrations()` がカラム既存エラーを正しく抑制する（`duplicate column name` のみ catch、その他は rethrow）
- `runMigrations()` が空のDBで FTS5 再構築をスキップする（無駄な処理をしない）
- `runMigrations()` が FTS5 インデックス空 + データ有りのケースで再構築を実行する

## 実装アプローチ
- **依存**: PBI #1（StorageBackend アダプタ）の完了後に着手。アダプタの `MigrationEngine` 的なインターフェースに依存するため
- **安全性**: マイグレーションの内容自体は変更せず、コードの移動のみ。`ALTER TABLE ... ADD COLUMN` の冪等性により安全

## 見積もり
2 ストーリーポイント（migrations.ts の新規作成 + 2箇所の呼び出し元置換 + 単体テスト）

## 技術的考慮事項
- **依存関係**: PBI #1 のアダプタインターフェースに依存。`MigrationEngine` は `StorageBackend` のサブセット
- **テスタビリティ**: `MigrationEngine` をモックすることで、マイグレーション手順を独立してテスト可能
- **非機能要件**: パフォーマンス影響なし。init 時のマイグレーションは既存と同じ
- **ADR参照**: ADR 2026-06-17（OPFS+FTS5共存）の移行手順に準拠

## 実装者向け注記

### 現状コードの確認
```bash
# 両ファイルの重複部分を確認
rg -n "newColumns = \[" src/offscreen/sqliteEngineContext.ts
rg -n "newColumns = \[" src/offscreen/opfsWorker.ts
# 両者の差分
diff <(rg "newColumns" -A 30 src/offscreen/sqliteEngineContext.ts) \
     <(rg "newColumns" -A 30 src/offscreen/opfsWorker.ts)
```

### 実装手順
1. `src/offscreen/schema.ts` に以下を追加:
   ```ts
   export const MIGRATION_COLUMNS = [
     'content TEXT', 'masked_count INTEGER', /* ... 全19カラム */
   ] as const;
   ```
2. `src/offscreen/migrations.ts` を作成:
   ```ts
   export interface MigrationEngine {
     exec(sql: string): Promise<void>;
     queryValue(sql: string): Promise<unknown>;
   }
   export async function runMigrations(engine: MigrationEngine): Promise<void> { ... }
   ```
3. `sqliteEngineContext.ts` の `_doInit()` と `opfsWorker.ts` の `initSqliteInner()` からマイグレーションループを削除し `runMigrations()` 呼び出しに置換
4. MigrationEngine アダプタを各コンテキストで実装（IDB VFS 用 / OPFS Worker 用）

### 落とし穴
- `opfsWorker.ts` の `sqlExec` 関数はラップ済み。`MigrationEngine.exec()` はバックエンドごとに異なる実装になる
- FTS5 の再構築（`INSERT INTO browsing_logs_fts(browsing_logs_fts) VALUES('rebuild')`）は `opfsWorker.ts` 固有の最適化。IDB VFS パスでは異なるアプローチかも
- `obsidian_synced` と `gist_synced` の単発マイグレーションは `MIGRATION_COLUMNS` とは別に `MIGRATION_SEQUENCE` で管理

## Definition of Done
- [ ] `migrations.ts` が作成され、両バックエンドから呼ばれている
- [ ] 重複した ALTER TABLE ループが両ファイルから削除されている
- [ ] 単体テストが全マイグレーションステップをカバーしている
- [ ] 既存の全テストがパスする
- [ ] `npm run build` が成功する
- [ ] コードレビュー完了
