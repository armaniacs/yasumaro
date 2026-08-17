# PBI: SqliteEngineContext を関心事別モジュールに分割する

## ユーザーストーリー
開発者として、`SqliteEngineContext` が持つ OPFS Worker プロキシ、IDB エンジン初期化、FallbackStorage、マイグレーションの各責務を専用モジュールに分割したい。なぜなら、718行のクラスが複数の低レベル関心事を混在させており、1つの変更が他の関心事に影響を与えるリスクが高いから。

## ビジネス価値
- エンジン層の修正時に影響範囲が局所化し、デグレリスクを削減する
- 各バックエンド（OPFS/IDB/Fallback）を個別に単体テストできるようになる
- 新しいストレージバックエンドの追加が容易になる

## BDD受け入れシナリオ

```gherkin
Scenario: OPFS Worker が利用可能な環境で初期化
  Given ブラウザが OPFS と Web Worker をサポートしている
  When SqliteEngineContext を初期化する
  Then OPFS Worker プロキシを使用してクエリが実行される
  And IDB フォールバックパスは初期化されない

Scenario: OPFS が利用不可で IDB フォールバック
  Given ブラウザが OPFS API をサポートしていない
  When SqliteEngineContext を初期化する
  Then IDB ストレージエンジンが作成される
  And フォールバック移行が実行される

Scenario: マイグレーションバックアップと復元
  Given 古いスキーマバージョンの SQLite ファイルがある
  When マイグレーションが実行される
  Then MigrationBackup モジュールが列マッピングを処理する
  And 既存レコードが新スキーマに復元される
```

## 受け入れ基準
- [ ] `SqliteEngineContext` から OPFS Worker、IDB ライフサイクル、FallbackStorage、マイグレーションの責務が分離している
- [ ] 新規モジュールは1つにつき250行以内に収める
- [ ] `recordsRepo.ts`、`dbMaintenance.ts`、`auditLogRepo.ts` の import パスと動作が変わらない
- [ ] 既存の SQLite 関連テストがすべてパスする
- [ ] 各新規モジュールに単体テストまたは契約テストが追加されている

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- Dashboard からの SQLite 操作シナリオが既存通り動作する

### 統合テスト
- `SqliteEngineContext` を介したバックエンド選択フロー（OPFS → IDB → Fallback）
- `recordsRepo` / `dbMaintenance` / `auditLogRepo` との結合契約

### 単体テスト
- `OpfsWorkerProxy`: メッセージ ID 割り当て、成功/失敗応答、Worker エラー時の pending 解放
- `IdbEngineLifecycle`: 初期化成功/失敗、`lastInitError` 記録
- `FallbackStorageBridge`: FallbackStorage 切り替えと読み書き委譲
- `MigrationBackup`: `COLUMN_NAMES` 列マッピングとレコード復元

## 実装アプローチ
- **Outside-In**: 既存の `recordsRepo` テストが green のまま、内部を段階的に分割
- **Red-Green-Refactor**: 各モジュールの抽出ごとにテストを追加してから実装

## 見積もり
5ポイント

## 技術的考慮事項
- 依存関係: `src/offscreen/sqliteEngine.ts`、`src/offscreen/storageFallback.ts`、`src/offscreen/schema.ts`、`src/offscreen/migrations.ts`
- テスタビリティ: Worker と IDB は環境依存なので、インターフェースを注入可能にする
- 副作用: SQLite 層は全記録の永続化に関わるため、動作変更は許容しない

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "SqliteEngineContext" src/
wc -l src/offscreen/sqliteEngineContext.ts
```

### 推奨モジュール構成
```
src/offscreen/
  sqliteEngineContext/
    opfsWorkerProxy.ts        # Worker 生成、postMessage、pending 管理
    idbEngineLifecycle.ts     # createIdbEngine 呼び出しとエラー状態
    fallbackStorageBridge.ts  # FallbackStorage との橋渡し
    migrationBackup.ts        # バックアップ/復元の列マッピング
    index.ts                  # SqliteEngineContext を thin facade として再エクスポート
```

### 落とし穴
- `DB_FILENAME`、`MAX_QUERY_LIMIT` などの export は `index.ts` 経由で維持する必要がある
- `opfsWorker.js` とのメッセージプロトコル（`__log` 判定含む）は変更しない
- `MigrationBackupPayload` の version フィールドは互換性維持のため維持する

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 既存テストがすべてパスする
- [ ] 新規モジュールの単体/統合テストが追加されている
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（ADR または実装計画があれば追記）
