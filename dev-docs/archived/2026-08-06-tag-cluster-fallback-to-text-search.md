# Plan: Tag Cluster ノードクリック時にタグ未マッチなら全文検索にフォールバック

## 背景 / 動機

Tag Cluster パネルでタグノード (例: `#教育`) をクリックすると `panel-sqlite-history` に `searchTag: '教育'` が渡され、そのタグで履歴を絞り込む。スクリーンショットでは `#教育` ノードをクリックした結果 **0件** になる一方、検索バーに `教育` を入れて FTS5 検索すると **54件** ヒットする。タグ文字列の絞り込み (`tagsString.split(',').some(...)`) は「完全一致または部分一致するタグ」を持つ行だけを拾うため、コンテンツ本文やタイトルにだけ「教育」が出てくる記録は拾えない。ユーザー体として「クリックしたら何も表示されない」は体験が悪い。

ゴール: `#教育` クリック時の結果が 0件なら、自動で `教育` の全文検索 (FTS5) にフォールバックし、その旨を UI で明示する。タグで 1件以上ヒットしたときは既存挙動を維持する。

## 関連ファイル

| 役割 | ファイル | 触る範囲 |
|------|----------|---------|
| フォールバック判定ロジック (新規) | `src/dashboard/historyFilters.ts` | 末尾にヘルパー追加 |
| フォールバック呼び出し | `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts` | `fetchData` と `onActivate` の searchTag 経路 |
| フォールバック表示バッジ UI | 同上 | `renderState` の `sqlite-tag-filter-bar` 直下 |
| i18n (新規 4 キー) | `public/_locales/ja/messages.json`, `public/_locales/en/messages.json` | キーのみ追加 |
| ユニットテスト | `src/dashboard/__tests__/historyFilters.test.ts` | フォールバック判定テストを追加 |

参照のみ (触らない):
- `src/dashboard/panels/asyncData/tagClusterPanel.ts` — `navigateToHistoryWithTag` は変えず、`searchTag: '教育'` のセマンティクスを SQLite パネル側で吸収する。
- `src/dashboard/panels/NavigationRegistry.ts` — `onActivate` 契約は維持。
- `src/dashboard/dashboardSqliteService.ts` — 既存の `searchLogs()` をそのまま使う。

## 設計

### 1. フォールバック判定 (historyFilters.ts に追加)

純粋関数として切り出し、テスタビリティを確保する。

```ts
/**
 * Decide whether the SQLite History panel should fall back from a tag-based
 * filter to a full-text search when the tag filter produced no rows.
 *
 * Returns `null` when no fallback is desired (tag filter has hits, or we are
 * not in a tag-initiated flow). Returns the trimmed search term otherwise.
 *
 * Trigger conditions (all must hold):
 *  - source is 'tag' (i.e. navigation came from Tag Cluster, not manual search)
 *  - tagRows is empty (zero matches for the tag)
 *  - searchTerm (tag without leading '#') is non-empty
 */
export function shouldFallbackToTextSearch(
  source: 'tag' | 'manual',
  tagRows: { rows: unknown[]; total: number } | null,
  rawTagFilter: string | null,
): string | null {
  if (source !== 'tag') return null;
  if (rawTagFilter == null) return null;
  const trimmed = rawTagFilter.replace(/^#/, '').trim();
  if (!trimmed) return null;
  if (tagRows && tagRows.total > 0) return null;
  return trimmed;
}
```

### 2. sqliteHistoryPanel.ts の変更

#### 2-1. `onActivate` (line 1039-) に searchTag 経由であることを state に保持

```ts
interface SqliteHistoryState {
  // ...既存
  pendingTagFallback: { tag: string; fallbackTo: string } | null;
}

onActivate(init) {
  if (init?.searchTag) {
    state.activeTagFilter = init.searchTag as string;
    state.currentPage = 0;
    state.pendingTagFallback = null; // fetchData 内でセットされる
    void fetchData({ page: 0, tagFilter: state.activeTagFilter || undefined });
  } else if (init?.searchDomain) {
    // 既存どおり
  }
}
```

#### 2-2. `fetchData` を「タグ起点」を区別する

`fetchData` には新規オプション `tagInitiated?: boolean` を追加 (省略時は `false`、`onActivate` の searchTag 経路からの呼び出し時のみ `true` を渡す)。tagInitiated=true のとき、タグ絞り込み結果が 0件なら:

1. `state.activeTagFilter` は維持する (`#教育` バッジは画面に残す)
2. `state.searchQuery` に `教育` を入れ、`sqlite-search-input` にも反映する
3. `searchLogs('教育', PAGE_SIZE, 0)` を実行し、結果を `state.entries` / `state.total` に入れる
4. `state.pendingTagFallback = { tag: '教育', fallbackTo: '教育', matched: state.total }` をセット
5. `refresh()` → `renderState()` でフォールバック通知を描画

タグヒットが 1件以上のときは従来どおり (検索には切り替えない、`pendingTagFallback = null`)。

```ts
async function fetchData(options: {
  limit?: number;
  since?: number;
  until?: number;
  search?: string;
  page?: number;
  tagFilter?: string;
  tagInitiated?: boolean;  // ← 新規
} = {}): Promise<void> {
  // ... 既存の前半 (loading=true, queryLogs 実行) はそのままで、
  // タグフィルタ後の result.total === 0 && options.tagInitiated を検出したらフォールバック。
}
```

具体的な流れ (line 478-489 の後):

```ts
if (result && !('error' in result) && activeTagFilter) {
  if (result.rows.length === 0 && options.tagInitiated) {
    const fallbackTerm = activeTagFilter.replace(/^#/, '').trim();
    if (fallbackTerm) {
      const searchResult = await searchLogs(fallbackTerm, limit, offset);
      if (searchResult && !('error' in searchResult)) {
        result = { rows: searchResult.rows, total: searchResult.total };
        state.searchQuery = fallbackTerm;
        state.pendingTagFallback = { tag: activeTagFilter, fallbackTo: fallbackTerm, matched: searchResult.total };
      } else {
        state.pendingTagFallback = null;
      }
    } else {
      state.pendingTagFallback = null;
    }
  } else {
    // 既存の filteredRows ロジック
  }
}
```

#### 2-3. UI 通知 (renderState 内、`sqlite-tag-filter-bar` の直下)

`state.pendingTagFallback` がセットされているとき、`#教育` バッジの下に補足行を出す:

```html
<div class="sqlite-tag-fallback-note" role="status">
  「#教育」タグは 0件でした。「教育」を含む全文検索結果を表示しています (N件)。
</div>
```

`pendingTagFallback` をクリアする条件:
- ユーザーが `sqlite-tag-filter-clear` (`×`) でタグフィルタを解除 → `pendingTagFallback = null`、`searchQuery` をクリアして `fetchData()` を再実行
- ユーザーが手動で `sqlite-search-input` に文字を入力 → フォールバック文脈ではなくなるので `pendingTagFallback = null`
- フォールバック自体も 0件のとき → 通知は出さず「記録が見つかりませんでした。」のまま

### 3. i18n

新規キー 4 つを `_locales/{ja,en}/messages.json` に追加。`historyNoRecords` の近く (ja: line 3096 付近、en: line 3192 付近) に並べる。

| key | ja | en |
|-----|----|----|
| `tagFallbackNotice` | `#%tag% タグは 0件でした。「%term%」を含む全文検索結果を表示しています (%count%件)。` | `No records matched the #%tag% tag. Showing full-text search results for "%term%" (%count% items).` |
| `tagFallbackClearHint` (任意) | `タグフィルターをクリア` | `Clear tag filter` |

`#%tag%` `%term%` `%count%` は `chrome.i18n.getMessage` のプレースホルダで置換する。

`getPluralKey('historyRecordCount', n)` を使う部分は変えない (件数の複数化は既存ロジック)。

### 4. テスト

#### 4-1. `src/dashboard/__tests__/historyFilters.test.ts` に追加

```ts
describe('shouldFallbackToTextSearch', () => {
  it('returns null when source is manual', () => {
    expect(shouldFallbackToTextSearch('manual', { rows: [], total: 0 }, '教育')).toBeNull();
  });
  it('returns null when rawTagFilter is null', () => {
    expect(shouldFallbackToTextSearch('tag', { rows: [], total: 0 }, null)).toBeNull();
  });
  it('strips leading # from the tag', () => {
    expect(shouldFallbackToTextSearch('tag', { rows: [], total: 0 }, '#教育')).toBe('教育');
  });
  it('returns null when tag has hits', () => {
    expect(shouldFallbackToTextSearch('tag', { rows: [{}], total: 3 }, '教育')).toBeNull();
  });
  it('trims whitespace and falls back', () => {
    expect(shouldFallbackToTextSearch('tag', null, '  #AI  ')).toBe('AI');
  });
  it('returns null when trimmed value is empty', () => {
    expect(shouldFallbackToTextSearch('tag', { rows: [], total: 0 }, '#')).toBeNull();
  });
});
```

#### 4-2. `sqliteHistoryPanel` の動作テスト (Vitest + jsdom)

`src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanel-tagFallback.test.ts` を新規作成。`dashboardSqliteService` をモックし、`onActivate({ searchTag: '教育' })` → `queryLogs` が空配列を返す → `searchLogs('教育', ...)` が 54件返す → `state.entries.length === 54`、`state.searchQuery === '教育'`、`state.activeTagFilter === '教育'` のまま、を検証。

`onActivate({ searchTag: 'tech' })` → `queryLogs` が 5件返す → `searchLogs` は呼ばれない、`state.searchQuery` は空のまま、も検証。

`onActivate({ searchDomain: 'example.com' })` → タグ起点ではないのでフォールバック発動しない、も検証。

#### 4-3. E2E (任意、後段でも可)

`testDir/e2e/dashboard-ui.spec.ts` に Tag Cluster → `#nonexistent` ノードクリックでフォールバック通知が表示されることを確認する spec を 1件追加。今は実装寄りテストのみで E2E は後追いでも OK。

### 5. 触らないこと (スコープ外)

- `navigateToHistoryWithTag()` の `searchTag: tag` 渡しは維持 (意味は「タグ起点の絞り込み」)
- Tag Cluster パネル側の表示・ロード処理は一切変えない
- `historyPanel` (旧: `src/dashboard/panels/asyncData/historyPanel.ts`) は別系統なので今回触らない (Tag Cluster からの遷移先は `panel-sqlite-history` のみ)
- 既存のカレンダー / 範囲検索 / ページネーション動作には影響させない (フォールバック発動時も `currentPage = 0` 固定で 1 ページ目を表示)

## 実装ステップ

1. `historyFilters.ts` に `shouldFallbackToTextSearch` を追加し、テストを書く (Red → Green)
2. `_locales/{ja,en}/messages.json` に新キーを追加
3. `sqliteHistoryPanel.ts`:
   - `state.pendingTagFilter` (`SqliteHistoryState` 拡張ではなく、ジェネリックな `pendingTagFallback` フィールドを追加) を state に追加
   - `fetchData` に `tagInitiated` オプションとフォールバック分岐を追加
   - `onActivate` から `tagInitiated: true` を渡す
   - `renderState` で `pendingTagFallback` 表示を追加
   - タグクリア (`sqlite-tag-filter-clear`) 時に `pendingTagFallback` もリセット
4. `sqliteHistoryPanel-tagFallback.test.ts` を追加
5. `npm run validate` (type-check + test) 緑
6. `npm run build` で `dist/` を作り、実機 Chrome で再現確認 (Tag Cluster → `#教育` → 54件 & フォールバック通知)

## 検証基準

- `#教育` クリック → 0件ではなく、54件 (実データ) + フォールバック通知が表示される
- `#tech` クリック → 既存のタグ絞り込みが動作し、フォールバック通知は出ない (検索欄は空のまま)
- タグクリア (`×`) を押すと元の全件表示に戻り、`searchQuery` もクリアされる
- FTS5 が利用できないとき (searchLogs が `{ error: ... }` を返す) はフォールバックせず「記録が見つかりませんでした。」のまま
- 既存テスト (`historyFilters.test.ts`, NavigationRegistry, etc.) は引き続き緑

## リスク / 留意点

- フォールバック後の `state.searchQuery` 設定は、ユーザーが直後に検索ボックスを空にしても「教育」結果が居座る挙動に見える可能性がある。→ 検索入力イベント (`input`) で `state.pendingTagFallback = null` をセットして通知だけ消す案を Step 3 の最後で微調整。
- `searchLogs` のリトライが 2回まで (`dashboardSqliteService.ts:124`) 入るため、タグ → 全文検索でネットワーク/初期化遅延時に 1〜2秒追加でかかる。体感は許容範囲 (line 1042 の既存 `fetchData` も同等のコスト) だが、`tagInitiated` 経路で初回ロードが遅い場合はローディング表示 (`state.loading`) が既に効くので追加対応不要。
- フォールバック発動時に `#教育` バッジを残しつつ通知を出す UX は「ユーザーは何を基準に絞り込んでいるのか」が一瞬分かりにくくなるリスクがある → 通知文で「タグ 0件 → 全文検索に切替」を明示し、`×` で解除できることを aria-label / 通知末尾に添える。
