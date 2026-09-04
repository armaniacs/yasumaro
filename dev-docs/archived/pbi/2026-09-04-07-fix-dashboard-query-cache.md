# PBI: Dashboard 履歴パネルのクエリ結果 LRU キャッシュとソート設定のメモリ常駐化

## ユーザーストーリー
Dashboard で閲覧履歴を見るユーザーとして、ページ送り・タグ解除・ソート切り替えの操作が即座に反映されてほしい。なぜなら現状はほぼすべての操作（`changeSort` / `filterByTag` / `changePage` / `clearTagFilter` など）が `fetchData()` 経由で SQLite クエリを再発行し、さらに `changeSort` のたびに `JSON.stringify` + `chrome.storage.local.set` の往復、`loadPersistedSort` も毎回 `get` + `JSON.parse` するから。

## ビジネス価値
- 「直前に見た状態」への遷移（ページ戻し・タグ解除・ソート往復）でクエリを省略し、体感応答性を上げる
- ソートボタン連打時の `chrome.storage.local` I/O を 1 回にまとめ、ストレージ負荷を下げる

## 既実装確認（Phase 0）
- `src/dashboard/panels/asyncData/sqliteHistoryModel.ts:354` `fetchData()` が全アクションの共通経路。`runQueryHistory({ limit, offset, sortBy, sortDir, ...search/since/until/tagFilter })` を毎回 await
- `:255` `loadPersistedSort()` — `chrome.storage.local.get(HISTORY_SORT_STORAGE_KEY)` + `JSON.parse`
- `:269` `persistSort()` — `JSON.stringify` + `chrome.storage.local.set`、`changeSort`（`:529`）から毎回呼ばれる
- `:456` `loadPersistedSortIntoState()` — 起動時に 1 回呼ばれる想定だが `loadPersistedSort` は他からも呼べる構造
- `fetchData` には `requestGeneration` によるレースガードあり（`:355`）— キャッシュ実装時もこれと整合させる
- `toggleStar` / `deleteEntry` / `appendSelectedToObsidian` はローカル state を直接更新（reducer）してクエリを再発行しない — キャッシュ無効化の対象

## BDD受け入れシナリオ

```gherkin
Scenario: 直前に見たページに戻るときクエリを再発行しない
  Given 履歴パネルでページ 0 → ページ 1 と進み、両方のクエリ結果がキャッシュされている
  When ユーザーがページ 0 に戻る
  Then runQueryHistory は呼ばれない
  And ページ 0 の結果が即座に表示される

Scenario: データを変更したら該当キャッシュを無効化する
  Given 複数ページ・複数フィルタの結果がキャッシュされている
  When ユーザーがあるエントリを削除する（deleteEntry）
  Then 全キャッシュエントリが無効化される（件数・オフセットが変わるため）
  And 次のフェッチは runQueryHistory を実際に呼ぶ

Scenario: ソート設定は起動時に 1 回だけ読み込む
  Given Dashboard を開く
  When 履歴パネルが初期化される
  Then chrome.storage.local.get(history_sort_preference) は 1 回だけ呼ばれる
  And 以降のソート判定はメモリ上の値を使う

Scenario: ソート連打時のストレージ書き込みをまとめる
  Given ユーザーがソートボタンを 500ms 以内に 5 回切り替える
  When 操作が落ち着く
  Then chrome.storage.local.set は 1 回だけ呼ばれる（最後の値で）

Scenario: レースガードとキャッシュが両立する
  Given 古いフェッチが in-flight のまま新しいフェッチが始まる
  When 古いフェッチが遅れて解決する
  Then 古い結果は state に反映されず、キャッシュにも「現在のキー」として保存されない
```

## 受け入れ基準
- [ ] `fetchData` のクエリパラメータ（`sortBy` / `sortDir` / `page` / `search` / `since` / `until` / `tagFilter` の正規化タプル）をキーにした LRU キャッシュ（上限 20 エントリ程度）を実装
- [ ] キャッシュヒット時は `runQueryHistory` を呼ばず、`dispatch({ type: 'loadSuccess', data })` を同期的に適用
- [ ] `toggleStarSuccess` / `deleteSuccess` / `appendSuccess`（データ変更）でキャッシュ全体を無効化（件数・オフセットがずれるため部分無効化はしない）
- [ ] `requestGeneration` レースガードと整合: stale なレスポンスはキャッシュに保存しない
- [ ] `loadPersistedSortIntoState()` を起動時 1 回に限定。`persistSort` を 500ms debounce
- [ ] `chrome.storage.local.get(HISTORY_SORT_STORAGE_KEY)` は Dashboard セッションあたり 1 回
- [ ] 既存の `sqliteHistoryModel` / `sqliteHistoryPanel` テストがすべてパス
- [ ] E2E `dashboard-ui.spec.ts` が回帰しない

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `src/dashboard/panels/asyncData/__tests__/sqliteHistoryModel.cache.test.ts`（新規）:
  - fake `queryHistory`（呼び出し回数カウント）で「page 0 → 1 → 0 で queryHistory 2 回」
  - `deleteEntry` 後の次フェッチで queryHistory が呼ばれる（無効化）
  - LRU 上限超過で最古エントリが落ちる
  - stale レスポンス（generation 不一致）がキャッシュに入らない
- `sqliteHistoryModel.sort-persistence.test.ts`（新規 or 既存拡張）:
  - fake `chrome.storage.local` で `get` 1 回、連続 `changeSort` 5 回 → debounce 後 `set` 1 回

### 統合テスト
- パネル + モデルで、ページ送り往復時に DOM 再レンダリングが即座（await 不要）に起きること
- E2E `dashboard-ui.spec.ts`: ソート切り替え・ページング・タグフィルタが従来どおり動作

### ベンチマーク
- 実装前に `npm run bench:micro -- --filter c6` でベースライン取得（fake `queryHistory` を固定レイテンシ、fake `chrome.storage` で操作シーケンス「ページ 0→1→2→1→0、ソート往復」を実行し、`queryHistory` 呼び出し回数・`storage.get`/`set` 回数・総 wall-clock）→ 実装後に再実行し `bench/reports/` の差分を PR に添付。`queryHistory` 呼び出しがシーケンスで N→(N - 戻り回数)、`storage` I/O が大幅減。

## 見積もり
2 pt（キャッシュ + 無効化 + レースガード整合 + debounce。ロジックは中規模だが state 管理の慎重さが要る）

## 技術的考慮事項
- 依存関係: **PBI 01（ベンチ基盤）に依存**
- キャッシュはモジュール state でなく `createSqliteHistoryModel` のクロージャ内に持つ（インスタンスごと、テスト分離）
- `bumpGenerationOnUnmount()` 時にキャッシュもクリアする（パネル再マウントで古い結果を出さない）
- `pendingTagFallback` を含むレスポンス（`tagFallback`）もキャッシュ対象。キーにタグフォールバック状態は含めない（クエリ入力が同じなら結果も同じ）
- debounce した `persistSort` は「Dashboard を閉じる直前」に flush する必要（`beforeunload` or unmount で pending を書き出す）
- メモリ: 1 エントリ最大 PAGE_SIZE=20 行 × 20 エントリ = 400 行分。数十 KB、問題なし

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '250,300p;350,400p;455,465p;525,540p' src/dashboard/panels/asyncData/sqliteHistoryModel.ts
```

### 実装方針
1. クロージャ内に `const queryCache = new Map<string, UnifiedHistoryQueryData>()` + LRU 管理（`Map` の挿入順 + `delete`/`set` で再挿入）
2. `fetchData`: パラメータを正規化して `cacheKey` を作る。ヒットなら `dispatch({type:'loadSuccess', data})` + `notify()` して return（`loadStart` も出さない or 即 `loading:false`）
3. ミス時は従来どおり await。`generation === requestGeneration` のときだけ `queryCache.set(cacheKey, result.data)`
4. `toggleStarImpl` / `deleteEntry` / `appendSelectedToObsidian` の成功時に `queryCache.clear()`
5. `persistSort` を `debounce(fn, 500)` でラップ。module-level の簡易 debounce ヘルパー or 既存の `src/utils` に debounce があれば流用
6. unmount/beforeunload で pending persist を flush、`queryCache.clear()`

### 落とし穴
- キャッシュヒット時に `loadStart` → 即 `loadSuccess` の二重 notify をすると UI がちらつく。ヒット時は 1 回の notify で終える
- `search` の空文字とタグフィルタの `undefined` の正規化を厳密に（`'' ` と `undefined` を同一キーに）
- `dateRangeFromSelected()` が返す `since`/`until` は selectedDate から決まる。同じ日付なら同じ値になることを確認（`selectDate` は `new Date(dateStr + 'T00:00:00')` で決定的）
- debounce した persist が flush されず Dashboard を閉じると、次回起動時にソート設定が古いまま → unmount フックで必ず flush

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] `npm run bench:micro -- --filter c6` の before/after を PR に添付
- [ ] E2E `dashboard-ui.spec.ts` パス
- [ ] コードレビュー完了
- [ ] CHANGELOG.md に記載（パフォーマンス改善・非機能）
