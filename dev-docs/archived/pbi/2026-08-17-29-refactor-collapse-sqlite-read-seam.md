# PBI: SQLite 読み取りシームを崩壊し、単一の StorageQuery に統合する

## ユーザーストーリー
開発者として、SQLite 履歴の読み取り（`query` / `search`）が `StorageBackend` の2つの非対称メソッドと3アダプタ＋Worker にまたがり、それぞれが独立に SQL を構築している状態を解消したい。なぜなら、検索パラメータ1個（`orderBy`/`orderDir`）を追加するだけで9ファイルを変更する必要があり、同じ WHERE/ORDER BY 構築ロジックが `IdbVfsBackend` と `opfsWorker` に重複しているから。

## ビジネス価値
- 検索フィルタ（ドメイン・スター・期間など）の追加コストを「9ファイル変更」から「2〜3ファイル変更」に削減
- WHERE/ORDER BY 構築を1モジュールに集約し、4アダプタ（OPFS/IDB/Fallback/Noop）で共有
- SQL 構築が offscreen 環境・Worker なしで単体テスト可能になる

## BDD受け入れシナリオ

```gherkin
Scenario: 読み取りが単一の値オブジェクト経由になる
  Given StorageQuery 値オブジェクトが定義されている
  When 呼び出し側が query(StorageQuery) を実行する
  Then 4アダプタすべてが同一の StorageQuery から結果を返す
  And query/search の2メソッドが存在しない

Scenario: ソート指定が全アダプタで同一結果を返す
  Given orderBy=created_at, orderDir=DESC の StorageQuery がある
  When OPFS / IDB / Fallback の各バックエンドで実行する
  Then 結果の並び順がすべて一致する

Scenario: 不正なソート指定がシームで拒否される
  Given orderBy にホワイトリスト外の値を含む StorageQuery がある
  When query() を実行する
  Then エラーが返り、SQL は実行されない
  And ホワイトリスト検証は1箇所で行われる
```

## 受け入れ基準
- [ ] `StorageQuery` 値オブジェクトが新設され、`query()`/`search()` の2メソッドが単一メソッドに統合されている
- [ ] WHERE/ORDER BY 構築が共有モジュール化され、`IdbVfsBackend` と `opfsWorker` の重複が解消されている
- [ ] `orderBy`/`orderDir` のホワイトリスト検証が1箇所に集約されている
- [ ] 既存のソート・検索テスト（`offscreen-search-orderby`, `opfsWorker-search-sort`, `IdbVfsBackend-search-sort`, `storageFallback-search-sort` 等）がすべてパスする
- [ ] 4アダプタが `StorageQuery` 経由で動作する契約テストが追加されている
- [ ] `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- Dashboard の SQLite History パネルから検索・ソートする既存シナリオがパスする

### 統合テスト
- 4アダプタ（OpfsWorkerBackend / IdbVfsBackend / FallbackStorageAdapter / NoopBackend）が同一の `StorageQuery` に対して等価な結果を返す契約テスト
- FTS5 と LIKE フォールバックの分岐（trigram 長さ判定）が StorageQuery 経由でも既存通り機能するテスト

### 単体テスト
- 共有 WHERE/ORDER BY ビルダー：各フィールドの組み合わせ、NULL/空値、LIMIT/OFFSET 境界
- `StorageQuery` のバリデーション（不正な orderBy/orderDir の拒否）

## 実装アプローチ
- **Outside-In**: まず `StorageQuery` 型と共有ビルダーの失敗するテストを書き、既存4アダプタの挙動を契約テストで固定してから統合
- **Red-Green-Refactor**: 各アダプタの移行ごとにグリーンを保ちながら段階的に置換

## 見積もり
5ポイント

## 技術的考慮事項
- 依存関係: PBI-30（opfsWorker 分割）を先に行うと `opfsWorker.ts` 側の作業が軽減されるが、必須ではない
- テスタビリティ: 共有ビルダーは DOM/Worker 非依存の純関数にする
- 副作用: SQLite 層は全記録の永続化に関わるため、動作変更（結果の並び・件数・rank 値）は許容しない。契約テストで固定する

## 実装者向け注記

### 現状コードの確認
```bash
# 2つの非対称メソッドを確認
grep -n "query(options\|search(" src/offscreen/StorageBackend.ts
# 重複した WHERE/ORDER BY 構築を確認
grep -n "ORDER BY\|WHERE\|ALLOWED_ORDER" src/offscreen/IdbVfsBackend.ts src/offscreen/opfsWorker.ts
# orderBy/orderDir が通過する全レイヤーを確認
grep -rn "orderBy\|orderDir" src/ --include="*.ts" | grep -v __tests__
```

### 現状（2026-08-17 確認済み）
- `StorageBackend.ts:30-36` に `query(options: QueryOptions)` と `search(query, limit, offset, options?)` の2メソッドが存在
- `orderBy`/`orderDir` は以下の9ファイルを通過して素通りしている:
  `sqliteHistoryQuery.ts` → `dashboardSqliteService.ts` → `readOnlyHandler.ts` → `sqliteClient.ts` → `messaging/sqliteMessages.ts` → `offscreen.ts` → `recordsRepo.ts` → `StorageBackend.ts` → 各アダプタ/Worker
- `IdbVfsBackend.ts:14-19` と `opfsWorker.ts:80-83` に同じ `ALLOWED_ORDER_COLUMNS` が重複定義されている
- 既実装の重複: なし（この PBI は未実装）

### 実装手順
1. `sqlite-types.ts` に `StorageQuery` を定義（query text / tag / starred / orderBy / orderDir / limit / offset / date range を内包するプレーンオブジェクト。postMessage で構造化クローン可能なこと）
2. 共有 `buildWhereClause()` / `buildOrderByClause()` を新設し、`IdbVfsBackend` の現行ロジックから移植（テストで現行 SQL を固定）
3. `StorageBackend` の `query()`/`search()` を単一の `query(q: StorageQuery)` に統合
4. 4アダプタを `StorageQuery` 対応に更新
5. `opfsWorker.ts` の `handleQuery`/`handleSearch` を共有ビルダー利用に更新
6. 上位レイヤーのパラメータ受渡しを `StorageQuery` に一本化（中間層の素通しを除去）
7. 契約テストを追加

### 落とし穴
- FTS5（`MATCH`）と LIKE フォールバックの分岐は現在 `opfsWorker.ts` と `IdbVfsBackend.ts` で独立実装。統合時に `sanitizeFtsTerm`・trigram 長さ判定の挙動が変わらないよう契約テストで固定すること
- `search` の `rank`（relevance ソート）は FTS5 の `bm25()` 由来。LIKE フォールバックには rank が無いため、`StorageQuery` で rank の有無を明示する（`orderBy: 'rank'` は FTS5 専用）
- `opfsWorker` は postMessage でやり取りするため、`StorageQuery` はクラスでなくプレーンなデータにすること
- `MAX_QUERY_LIMIT`（`sqliteEngineContext.ts:45`）の上限適用を統合後も維持すること

## Definition of Done
- [ ] `StorageQuery` が存在し、`StorageBackend` の読み取りメソッドが1つに統合されている
- [ ] 共有ビルダーが `IdbVfsBackend` と `opfsWorker` の両方で使われている
- [ ] 4アダプタの契約テストが追加されパスしている
- [ ] 全テストがパスし `npm run validate` が通過している
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
