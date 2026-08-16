# SQLite History パネル: 並び替え・期間フィルタ強化 設計

## 背景

`dashboard`の履歴パネル（`sqlite-history`）は検索・タグフィルタ・カレンダーによる日付フィルタを備えるが、結果の並び順は常に `created_at DESC` 固定で、ユーザーが変更する手段がない。Google検索の「ツール」メニュー（すべての言語 / 期間指定なし / すべての結果 / 詳細検索）を参考に、並び替えを追加する。

期間フィルタは既存の「今日 / 昨日 / 過去7日間 / 過去30日間」ボタン（`renderCalendarNav`）とカレンダー日付選択で十分要件を満たしており、変更しない。

## スコープ

- 追加: 検索結果の並び替え（新しい順 / 古い順 / 関連度順）
- 追加: 選択したソート順の `chrome.storage.local` への永続化
- 対象外: 期間フィルタの新規UI（既存のプリセットボタン・カレンダーを活用）
- 対象外: 「すべての言語」「すべての結果」に相当する機能（このアプリの検索に言語・リソース種別の概念がない）

## UI

検索ボックス付近にソート `<select>` を追加する。

- 選択肢: `新しい順`（デフォルト）/ `古い順`
- 検索クエリが入力されている間のみ `関連度順` を選択肢に追加し、検索実行時のデフォルトとする
- 検索クエリを空にすると `関連度順` は選択肢から外れ、ソートは `新しい順` にフォールバックする

## 状態管理 (`sqliteHistoryPanelState.ts`)

`SqliteHistoryState` に以下を追加する。

```ts
sortBy: 'created_at' | 'relevance';
sortDir: 'ASC' | 'DESC'; // sortBy === 'relevance' の時は無視される
```

新規アクション:

```ts
{ type: 'sortChange'; sortBy: 'created_at' | 'relevance'; sortDir: 'ASC' | 'DESC' }
```

既存の `search` アクションのルールを拡張する: 検索クエリが空文字になった時、`sortBy` が `'relevance'` なら `created_at` / `DESC` にフォールバックする（関連度順は検索クエリ必須のため、クエリが無い状態で関連度順のままにしない）。

## クエリ層 (`sqliteHistoryQuery.ts`)

`UnifiedHistoryQueryOptions` に `sortBy?` `sortDir?` を追加し、`queryHistory()` 内で各パスに伝播する。

- 非検索パス（`queryLogs`）: 既存の `orderBy: 'created_at', orderDir: 'DESC'` 固定を、渡された `sortBy`/`sortDir` に置き換える
- 検索パス（`searchLogs`）: 新たに `orderBy` パラメータを渡せるようにする（`'rank' | 'created_at'`）。`sortBy === 'relevance'` なら `'rank'`、`'created_at'` ならその `sortDir` を渡す
- タグフィルタのクライアント側スライス（`filterRowsByTag` 経由）: 取得元のSQLクエリ自体を要求された `orderDir` で取得するため、フィルタ後の `slice` は追加処理不要（取得時点で正しい順序になっている）

## バックエンド

`searchLogs` は現在 `ORDER BY rank` 固定でパラメータを持たない。以下の経路すべてに `orderBy?: 'rank' | 'created_at'`, `orderDir?: 'ASC' | 'DESC'` を追加する。

1. `dashboardSqliteService.searchLogs()` — シグネチャに追加
2. `dashboardSqliteProtocol.ts` の `search` サブタイプ — ペイロードに追加
3. `dashboardSqliteHandlers.ts` の `case 'search'` — `deps.search()` に伝播
4. `recordsRepo.ts` の `search()` — `backend.search()` に伝播
5. 各 `StorageBackend` 実装:
   - `IdbVfsBackend.search()` — `ORDER BY rank` を条件分岐させ、`orderBy === 'created_at'` の時は `ORDER BY b.created_at {dir}, b.id {dir}` にする
   - OPFS Worker 側の同等SQL（`opfsWorker.ts` 内、同じロジックの重複実装）
   - `FallbackStorageAdapter`（chrome.storage.local ベースの最終フォールバック）— メモリ内ソートで同等の分岐

3系統すべてに対応する（ユーザー承認済み）。どのバックエンドが実際に使われるかは実行環境依存のため、一部のみ対応すると挙動が環境依存でばらつく。

## 永続化

`StorageKeys` に `HISTORY_SORT_PREFERENCE` を追加し、`{ sortBy, sortDir }` を JSON で `chrome.storage.local` に保存する。

- 保存タイミング: ソート `<select>` の `change` イベント
- 読み込みタイミング: パネルの `loadData()` 冒頭、初期 `state` 構築後・初回フェッチ前

タグ遷移（`onActivate` の `tagInitiated`）や検索遷移時は、保存済みのソート設定を尊重する（それらのアクションは `sortBy`/`sortDir` に触れない）。

## テスト方針

- `sqliteHistoryPanelState.test.ts`: `sortChange` アクションの遷移、`search` クリア時の関連度順フォールバックをユニットテスト
- `sqliteHistoryQuery.test.ts`: `queryHistory()` が `sortBy`/`sortDir` を各パスに正しく渡すことを検証
- バックエンド層（IdbVfs 等）: 既存の `search` テストに `orderBy: 'created_at'` パターンを追加し、`ORDER BY` 節が切り替わることを確認
- 永続化: `chrome.storage.local` のモックで保存・読み込みを検証
