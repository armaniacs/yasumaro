# PBI: StorageBackend アダプタによる3バックエンド分岐の統一

## ユーザーストーリー
開発者として、リポジトリ関数から3バックエンド（OPFS Worker / IDB VFS / FallbackStorage）への分岐ロジックを除去し、単一の `StorageBackend` インターフェースに委譲したい。
なぜなら現在すべてのCRUD関数（20以上）に同一の4-way分岐がコピペされており、新しいバックエンドの追加や既存バックエンドの挙動変更に全関数の修正が必要で、バグの温床になっているから。

## ビジネス価値
- **保守性**: バックエンド選択ロジックが1モジュールに局所化され、追加・変更の影響範囲が最小化される
- **テスト容易性**: リポジトリ関数のテストが、アダプタをモックするだけで完了する（現在は3バックエンド分のセットアップが必要）
- **コード量削減**: 約240行の重複分岐コードが削除される

## BDD受け入れシナリオ

```gherkin
Scenario: リポジトリ関数が StorageBackend に委譲する
  Given OPFS Worker が利用可能な環境である
  When  recordsRepo.insert(record) が呼ばれたとき
  Then SqliteEngineContext が OPFS Worker アダプタを選択し
  And アダプタが postMessage 経由で Worker に INSERT を送信し
  And リポジトリ関数自身はバックエンド分岐ロジックを持たない

Scenario: OPFS Worker が利用不可のとき IDB VFS にフォールバックする
  Given OPFS Worker の初期化に失敗している
  When  recordsRepo.query(options) が呼ばれたとき
  Then SqliteEngineContext が IDB VFS アダプタを選択し
  And アダプタが wa-sqlite 非同期API で SELECT を実行する

Scenario: IDB VFS も利用不可のとき FallbackStorage にフォールバックする
  Given OPFS Worker も IDB VFS も利用不可である
  When  recordsRepo.search(query) が呼ばれたとき
  Then SqliteEngineContext が FallbackStorage アダプタを選択し
  And アダプタが chrome.storage.local に対して線形検索を実行する

Scenario: 全バックエンドが利用不可のとき明示的なエラーを返す
  Given どのバックエンドも初期化されていない
  When  任意のリポジトリ操作が呼ばれたとき
  Then エラー { success: false, error: "Database not initialized" } を返す
```

## 受け入れ基準
- [ ] `StorageBackend` インターフェースが定義されている（insert/query/search/update/delete/purge/backup/restore/healthCheck）
- [ ] `OpfsWorkerBackend`, `IdbVfsBackend`, `FallbackBackend` の3アダプタが実装されている
- [ ] `SqliteEngineContext` が適切なアダプタを選択し、一度選択したら再選択しない（init完了後は固定）
- [ ] `recordsRepo.ts` の全関数から分岐ロジックが除去され、`backend.メソッド()` の1行呼び出しになっている
- [ ] `dbMaintenance.ts` の全関数から分岐ロジックが除去されている
- [ ] `auditLogRepo.ts` の全関数から分岐ロジックが除去されている
- [ ] 既存の全テストがパスする（後方互換性）
- [ ] 既存の3段フォールバックの挙動が維持されている

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- OPFS Worker パス・IDB VFS パス・Fallback パスそれぞれで、履歴の記録 → 検索 → 削除 → 一覧表示の一連の流れが変わらず動作すること

### 統合テスト
- `SqliteEngineContext.selectBackend()` が環境に応じて正しいアダプタを返すこと
- 各アダプタが `StorageBackend` インターフェースを満たしていること（TypeScript の型チェックで保証）
- Worker メッセージングが途切れた場合、エラーが正しく伝播すること

### 単体テスト
- `OpfsWorkerBackend.insert()` が正しいメッセージ形式で postMessage する
- `IdbVfsBackend.query()` が正しい SQL とパラメータで execWithCache を呼ぶ
- `FallbackBackend.search()` が線形検索で正しい結果を返す（境界値: 空文字列、特殊文字、上限超え）
- アダプタ未選択時のエラーハンドリング

## 実装アプローチ
- **Outside-In**: E2Eテストで全体の動作を確認してから下位レイヤーに降りる
- **Red-Green-Refactor**: まずアダプタインターフェースを定義（Red）、各バックエンドの薄いラッパを実装（Green）、リポジトリ関数から分岐を除去（Refactor）
- **リファクタリング**: グリーンになるたびに、重複した分岐ロジックが残っていないか確認

## 見積もり
5 ストーリーポイント（中規模リファクタリング。3ファイル × 約7関数の分岐除去 + アダプタ3実装 + インターフェース定義）

## 技術的考慮事項
- **依存関係**: PBI #2（opfsWorker.ts重複解消）とPBI #5（マイグレーション共有化）の前提となる。先行して実装すべき
- **テスタビリティ**: 各アダプタをモック可能にするため、`StorageBackend` の注入ポイントを `SqliteEngineContext` に設ける
- **非機能要件**: パフォーマンス劣化なし（アダプタ選択は init 時の1回のみ）。後方互換性を完全維持
- **ADR参照**: ADR 2026-06-17（OPFS+FTS5共存）の3段フォールバックを維持。ADR 2026-07-07（二重書き込み）には影響なし

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# 現在の分岐パターンが何箇所あるか確認
rg -n "engine\.opfsWorker" src/offscreen/
rg -n "engine\.usingFallbackStorage" src/offscreen/
rg -n "engine\.dbHandle" src/offscreen/
rg -n "if \(engine\.opfsWorker\)" src/offscreen/
```

### 実装手順
1. `src/offscreen/StorageBackend.ts` を作成し、インターフェースを定義
   ```ts
   interface StorageBackend {
     insert(record: BrowsingLogRecord): Promise<InsertResult>;
     query(options: QueryOptions): Promise<QueryResult>;
     search(options: SearchOptions): Promise<SearchResult>;
     update(id: number, changes: Record<string, unknown>): Promise<MutationResult>;
     delete(id: number): Promise<MutationResult>;
     // ... その他の操作
   }
   ```
2. 3つのアダプタクラスを実装（既存の分岐内のコードをほぼそのまま移植）
3. `SqliteEngineContext` に `selectBackend(): StorageBackend` メソッドを追加
4. `recordsRepo.ts` / `dbMaintenance.ts` / `auditLogRepo.ts` の各関数を1行呼び出しに置換
5. 不要になった `engine.opfsWorker` / `engine.dbHandle` の直接参照を削除

### 落とし穴
- `engine.tryOpfsProxy()` の呼び出しパターンがアダプタ間で異なる（OPFS Worker はメッセージ型で操作を識別、IDB VFS は SQL 直実行）。アダプタインターフェースは操作名ベースで統一する
- `execWithCache()` は IDB VFS 専用のプリペアドステートメントキャッシュ。OPFS Worker アダプタでは使わない
- FallbackStorage の `mutex` はアダプタ内部に保持したままにする（`SqliteClient` の Mutex とは別物）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後、残存分岐なし）
- [ ] 既存の全テストがパスする
- [ ] `npm run build` が成功する
