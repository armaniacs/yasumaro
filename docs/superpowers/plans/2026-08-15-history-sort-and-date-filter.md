# History Sort Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sort dropdown (new/old/relevance) to the SQLite history dashboard panel, threading `orderBy`/`orderDir` through the full-text search path (which currently only sorts by FTS5 rank) end-to-end from UI to every storage backend, and persist the user's choice in `chrome.storage.local`.

**Architecture:** The non-search query path (`queryLogs`) already accepts `orderBy`/`orderDir` — only the full-text search path (`searchLogs`) needs new parameters threaded through 7 layers: dashboardSqliteService → protocol types → background handler → recordsRepo → 3 storage backends (IdbVfsBackend, OPFS Worker, FallbackStorage). The panel's reducer gains `sortBy`/`sortDir` state and a `sortChange` action; a new `<select>` next to the search box drives it, with the "relevance" option only present while a search query is active.

**Tech Stack:** TypeScript, Vitest, Chrome Extension Manifest V3, SQLite (FTS5) via three backend implementations (OPFS Worker, IndexedDB VFS, chrome.storage.local fallback).

---

## File Map

| File | Change |
|---|---|
| `src/dashboard/panels/asyncData/sqliteHistoryPanelState.ts` | Add `sortBy`/`sortDir` to state, `sortChange` action, extend `search` action's relevance fallback rule |
| `src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanelState.test.ts` | Tests for the above |
| `src/dashboard/panels/asyncData/sqliteHistoryQuery.ts` | Extend `UnifiedHistoryQueryOptions`, pass `sortBy`/`sortDir` to `queryLogs`/`searchLogs` |
| `src/dashboard/panels/asyncData/__tests__/sqliteHistoryQuery.test.ts` | Tests for the above |
| `src/dashboard/dashboardSqliteService.ts` | `searchLogs()` gains `orderBy`/`orderDir` params |
| `src/background/handlers/dashboardSqliteProtocol.ts` | `search` subtype payload gains `orderBy`/`orderDir` |
| `src/background/handlers/dashboardSqliteHandlers.ts` | `case 'search'` passes `orderBy`/`orderDir` to `deps.search()` |
| `src/background/__tests__/dashboardSqliteHandlers.test.ts` | Test for the above |
| `src/offscreen/recordsRepo.ts` | `search()` gains `orderBy`/`orderDir` params, passes to backend |
| `src/offscreen/IdbVfsBackend.ts` | `search()` branches `ORDER BY` between `rank` and `created_at {dir}, id {dir}` |
| `src/offscreen/opfsWorker.ts` | `handleSearch`/`handleSearchFts`/`handleSearchLike` gain the same branch |
| `src/offscreen/FallbackStorageAdapter.ts` | `search()` passes `orderBy`/`orderDir` through to `FallbackStorage.search()` |
| `src/offscreen/storageFallback.ts` | `search()` sorts `matched` by `orderBy`/`orderDir` before paging |
| `src/offscreen/__tests__/` (new file) | `storageFallback.search` sort tests |
| `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts` | Add sort `<select>`, wire to reducer, persist to `chrome.storage.local` |
| `src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanel-sort.test.ts` (new file) | UI-level sort tests |
| `src/utils/storage/types.ts` | Add `StorageKeys.HISTORY_SORT_PREFERENCE` |
| `public/_locales/ja/messages.json`, `public/_locales/en/messages.json` | New i18n keys for sort labels |

---

### Task 1: State layer — `sortBy`/`sortDir` in the reducer

**Files:**
- Modify: `src/dashboard/panels/asyncData/sqliteHistoryPanelState.ts`
- Test: `src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanelState.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanelState.test.ts` (append near the end, before the final closing of the file):

```ts
describe('historyStateReducer — sort', () => {
  it('createInitialHistoryState defaults to created_at DESC', () => {
    const state = createInitialHistoryState();
    expect(state.sortBy).toBe('created_at');
    expect(state.sortDir).toBe('DESC');
  });

  it('sortChange sets sortBy/sortDir and resets to page 0', () => {
    const state = makeState({ currentPage: 3, sortBy: 'created_at', sortDir: 'DESC' });
    const next = historyStateReducer(state, { type: 'sortChange', sortBy: 'created_at', sortDir: 'ASC' });
    expect(next.sortBy).toBe('created_at');
    expect(next.sortDir).toBe('ASC');
    expect(next.currentPage).toBe(0);
  });

  it('sortChange to relevance is accepted as-is', () => {
    const state = makeState({ sortBy: 'created_at', sortDir: 'DESC' });
    const next = historyStateReducer(state, { type: 'sortChange', sortBy: 'relevance', sortDir: 'DESC' });
    expect(next.sortBy).toBe('relevance');
  });

  it('search clearing the query falls back from relevance to created_at DESC', () => {
    const state = makeState({ sortBy: 'relevance', sortDir: 'DESC', searchQuery: 'foo' });
    const next = historyStateReducer(state, { type: 'search', query: '' });
    expect(next.sortBy).toBe('created_at');
    expect(next.sortDir).toBe('DESC');
  });

  it('search starting a query (empty to non-empty) switches sortBy to relevance', () => {
    const state = makeState({ sortBy: 'created_at', sortDir: 'ASC', searchQuery: '' });
    const next = historyStateReducer(state, { type: 'search', query: 'bar' });
    expect(next.sortBy).toBe('relevance');
  });

  it('search refining an already-active query does not override an explicit created_at sort', () => {
    const state = makeState({ sortBy: 'created_at', sortDir: 'ASC', searchQuery: 'ba' });
    const next = historyStateReducer(state, { type: 'search', query: 'bar' });
    expect(next.sortBy).toBe('created_at');
    expect(next.sortDir).toBe('ASC');
  });

  it('search refining an already-active relevance-sorted query keeps relevance', () => {
    const state = makeState({ sortBy: 'relevance', sortDir: 'DESC', searchQuery: 'ba' });
    const next = historyStateReducer(state, { type: 'search', query: 'bar' });
    expect(next.sortBy).toBe('relevance');
  });

  it('search clearing the query leaves a created_at sort untouched', () => {
    const state = makeState({ sortBy: 'created_at', sortDir: 'ASC', searchQuery: 'foo' });
    const next = historyStateReducer(state, { type: 'search', query: '' });
    expect(next.sortBy).toBe('created_at');
    expect(next.sortDir).toBe('ASC');
  });
});
```

Also update the existing `createInitialHistoryState` snapshot test (around line 39-56) to include the two new fields:

```ts
describe('createInitialHistoryState', () => {
  it('returns a neutral state with an empty selection set', () => {
    const state = createInitialHistoryState();
    expect(state).toEqual({
      entries: [],
      total: 0,
      currentPage: 0,
      searchQuery: '',
      selectedDate: null,
      loading: false,
      error: null,
      fallbackMode: false,
      selectedIds: new Set(),
      activeTagFilter: null,
      pendingTagFallback: null,
      sortBy: 'created_at',
      sortDir: 'DESC',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanelState.test.ts`
Expected: FAIL — `sortBy`/`sortDir` undefined, `sortChange` action type not recognized (TS compile error surfaces as a test failure).

- [ ] **Step 3: Implement the state changes**

In `src/dashboard/panels/asyncData/sqliteHistoryPanelState.ts`:

Add to the `SqliteHistoryState` interface (after `pendingTagFallback`):

```ts
  /**
   * 'relevance' is only meaningful while a search query is active (FTS5 rank
   * has no meaning outside a MATCH query) — see the `search` action below for
   * the fallback rule that keeps this invariant.
   */
  sortBy: 'created_at' | 'relevance';
  sortDir: 'ASC' | 'DESC';
```

Update `createInitialHistoryState`:

```ts
export function createInitialHistoryState(): SqliteHistoryState {
  return {
    entries: [],
    total: 0,
    currentPage: 0,
    searchQuery: '',
    selectedDate: null,
    loading: false,
    error: null,
    fallbackMode: false,
    selectedIds: new Set(),
    activeTagFilter: null,
    pendingTagFallback: null,
    sortBy: 'created_at',
    sortDir: 'DESC',
  };
}
```

Add to the `SqliteHistoryAction` union (after `'pageChange'`):

```ts
  | { type: 'sortChange'; sortBy: 'created_at' | 'relevance'; sortDir: 'ASC' | 'DESC' }
```

Update the `'search'` case to add the relevance-fallback rule. This rule runs **both directions**: clearing the query while sorted by relevance falls back to `created_at DESC` (relevance has no meaning without a query), and starting a search while sorted by `created_at` switches to `relevance` (PBI scenario: "relevance becomes the default when a search starts"). Without the second direction, a user who last picked "oldest first" and then types a search term keeps seeing `created_at ASC` results instead of relevance-ranked ones — the relevance `<option>` appears in the UI (Task 10) but is not auto-selected, contradicting the BDD scenario.

```ts
    case 'search': {
      const trimmed = action.query.trim();
      // Relevance sort has no meaning without a search query; clearing the
      // query must not leave the UI stuck showing a "relevance" option that
      // is about to disappear.
      const clearingRelevance = !trimmed && state.sortBy === 'relevance';
      // Starting a search (query goes from empty to non-empty) switches to
      // relevance by default, per the PBI's "becomes the default when a
      // search starts" requirement — this only fires on the empty→non-empty
      // transition so it does not override a sort the user explicitly picked
      // while already mid-search (e.g. deliberately staying on created_at
      // DESC/ASC while refining search terms).
      const startingSearch = trimmed && !state.searchQuery.trim() && state.sortBy !== 'relevance';
      return {
        ...state,
        searchQuery: action.query,
        currentPage: 0,
        pendingTagFallback: null,
        sortBy: clearingRelevance ? 'created_at' : startingSearch ? 'relevance' : state.sortBy,
        sortDir: clearingRelevance ? 'DESC' : state.sortDir,
      };
    }
```

Add a new case (after `'pageChange'`):

```ts
    case 'sortChange':
      return { ...state, sortBy: action.sortBy, sortDir: action.sortDir, currentPage: 0 };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanelState.test.ts`
Expected: PASS (all tests, including the pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/panels/asyncData/sqliteHistoryPanelState.ts src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanelState.test.ts
git commit -m "feat: add sortBy/sortDir state to history panel reducer"
```

---

### Task 2: Query layer — thread `sortBy`/`sortDir` through `queryHistory`

**Files:**
- Modify: `src/dashboard/panels/asyncData/sqliteHistoryQuery.ts`
- Test: `src/dashboard/panels/asyncData/__tests__/sqliteHistoryQuery.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/dashboard/panels/asyncData/__tests__/sqliteHistoryQuery.test.ts` (in the `describe('queryHistory', ...)` block — find it by searching for `describe('queryHistory'` in the file; add these `it` blocks inside it):

```ts
  it('passes sortBy=created_at/sortDir=ASC through to queryLogs as orderBy/orderDir on the non-search path', async () => {
    const sources = makeSources();
    await queryHistory({ limit: 20, offset: 0, sortBy: 'created_at', sortDir: 'ASC' }, sources);
    expect(sources.queryLogs).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: 'created_at', orderDir: 'ASC' })
    );
  });

  it('defaults to created_at DESC on the non-search path when sortBy/sortDir are omitted', async () => {
    const sources = makeSources();
    await queryHistory({ limit: 20, offset: 0 }, sources);
    expect(sources.queryLogs).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: 'created_at', orderDir: 'DESC' })
    );
  });

  it('passes orderBy=created_at/orderDir to searchLogs when sortBy=created_at on the search path', async () => {
    const sources = makeSources();
    await queryHistory({ search: 'kddi', limit: 20, offset: 0, sortBy: 'created_at', sortDir: 'ASC' }, sources);
    expect(sources.searchLogs).toHaveBeenCalledWith('kddi', 20, 0, { orderBy: 'created_at', orderDir: 'ASC' });
  });

  it('passes orderBy=rank to searchLogs when sortBy=relevance on the search path', async () => {
    const sources = makeSources();
    await queryHistory({ search: 'kddi', limit: 20, offset: 0, sortBy: 'relevance', sortDir: 'DESC' }, sources);
    expect(sources.searchLogs).toHaveBeenCalledWith('kddi', 20, 0, { orderBy: 'rank', orderDir: 'DESC' });
  });

  it('defaults to orderBy=rank on the search path when sortBy is omitted', async () => {
    const sources = makeSources();
    await queryHistory({ search: 'kddi', limit: 20, offset: 0 }, sources);
    expect(sources.searchLogs).toHaveBeenCalledWith('kddi', 20, 0, { orderBy: 'rank', orderDir: 'DESC' });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/dashboard/panels/asyncData/__tests__/sqliteHistoryQuery.test.ts`
Expected: FAIL — `queryLogs`/`searchLogs` called without the expected `orderBy`/`orderDir` args (current `searchLogs` call only passes 3 positional args).

- [ ] **Step 3: Implement the query layer changes**

In `src/dashboard/panels/asyncData/sqliteHistoryQuery.ts`:

Update `UnifiedHistoryQueryOptions` (add after `tagInitiated?`):

```ts
  /** Sort applied to results. 'relevance' is only meaningful when `search` is set. */
  sortBy?: 'created_at' | 'relevance';
  sortDir?: 'ASC' | 'DESC';
```

Update `HistoryQuerySources.searchLogs` type — since `searchLogs`'s real signature changes in Task 3, this interface just mirrors it (no edit needed here beyond `typeof searchLogs`, which already tracks the real function).

In `queryHistory()`, replace the search-path branch:

```ts
  if (options.search) {
    const sortBy = options.sortBy ?? 'relevance';
    const orderBy = sortBy === 'relevance' ? 'rank' : 'created_at';
    const orderDir = options.sortDir ?? 'DESC';
    const searchResult = await searchRows(options.search, options.limit, options.offset, { orderBy, orderDir });
    if (isServiceError(searchResult)) return searchResult;
    rows = searchResult.data.rows;
    total = searchResult.data.total;
  } else {
```

And in the non-search branch, replace the hardcoded `orderBy: 'created_at', orderDir: 'DESC'`:

```ts
    const queryResult = await queryRows({
      limit: useServerPaging ? options.limit : TAG_FILTER_FETCH_LIMIT,
      offset: useServerPaging ? options.offset : 0,
      since: options.since,
      until: options.until,
      orderBy: 'created_at',
      orderDir: options.sortDir ?? 'DESC',
      tagFilter: undefined, // unchanged — keep existing code below this line intact
    });
```

Wait — re-check: the existing code already builds `queryRows({...})` with the tag-filter branching intact below it. Only change the two `orderBy`/`orderDir` lines inside that existing call:

```ts
      orderBy: 'created_at',
      orderDir: options.sortDir ?? 'DESC',
```

(Leave every other line of that call — `limit`, `offset`, `since`, `until`, `tagFilter` — exactly as they are in the current file.)

Also update the fallback search call inside the tag-filter branch (the one that fires when `shouldFallbackToTextSearch` returns a term) to pass the same `orderBy`/`orderDir`:

```ts
      if (fallbackTerm) {
        const sortBy = options.sortBy ?? 'relevance';
        const orderBy = sortBy === 'relevance' ? 'rank' : 'created_at';
        const orderDir = options.sortDir ?? 'DESC';
        const searchResult = await searchRows(fallbackTerm, options.limit, options.offset, { orderBy, orderDir });
```

**Known limitation surfaced by this change — document, do not silently fix:** when a tag filter is active, `useServerPaging` is `false` and the `queryRows({...})` call above fetches only `TAG_FILTER_FETCH_LIMIT` (5000) rows before `filterRowsByTag` runs client-side. Before this task, that fetch was always `orderDir: 'DESC'`, so the 5000-row cap consistently meant "the most recent 5000 rows, tag-filtered client-side" — a stable, well-understood limitation. Once `orderDir` becomes user-controlled, selecting "oldest first" while a tag filter is active flips the fetch to `ASC`, so the cap instead means "the *oldest* 5000 rows" — any tagged entries newer than the 5000th-oldest row are silently excluded from that view, which is a *new* failure mode (recent tagged entries disappearing) that didn't exist under the old fixed-DESC behavior. This plan does not change `TAG_FILTER_FETCH_LIMIT` or the tag-filter fetch strategy — that would be a separate, larger change. Instead:

- Add a code comment at the `TAG_FILTER_FETCH_LIMIT` fetch (where `orderDir` is now threaded through) noting this asymmetry explicitly, so a future reader investigating "tagged entries missing under oldest-first" finds the explanation immediately instead of re-deriving it.
- Add a test in `sqliteHistoryQuery.test.ts` asserting that `orderDir` is forwarded into the tag-filter fetch call (not hardcoded to `DESC`), so the behavior is at least intentional and verified rather than accidental:

```ts
  it('forwards sortDir into the tag-filter over-fetch query (not hardcoded to DESC)', async () => {
    const sources = makeSources({ queryLogs: vi.fn().mockResolvedValue({ data: { rows: [], total: 0 } }) });
    await queryHistory({ limit: 20, offset: 0, tagFilter: 'work', sortDir: 'ASC' }, sources);
    expect(sources.queryLogs).toHaveBeenCalledWith(
      expect.objectContaining({ orderDir: 'ASC' })
    );
  });
```

- Do not attempt to fix the underlying cap/ordering interaction in this PBI — flag it to the user as a follow-up if it comes up during manual verification (Task 11).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/dashboard/panels/asyncData/__tests__/sqliteHistoryQuery.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/panels/asyncData/sqliteHistoryQuery.ts src/dashboard/panels/asyncData/__tests__/sqliteHistoryQuery.test.ts
git commit -m "feat: thread sortBy/sortDir through queryHistory"
```

---

### Task 3: Service layer — `searchLogs()` gains `orderBy`/`orderDir`

**Files:**
- Modify: `src/dashboard/dashboardSqliteService.ts`
- Test: `src/dashboard/__tests__/dashboardSqliteService.test.ts`

- [ ] **Step 1: Write the failing test**

Find the existing `describe('searchLogs', ...)` block in `src/dashboard/__tests__/dashboardSqliteService.test.ts` (search for `searchLogs`) and add:

```ts
  it('passes orderBy/orderDir through to the message payload', async () => {
    mockSendMessage.mockResolvedValue({ success: true, rows: [], total: 0 });
    await searchLogs('kddi', 20, 0, { orderBy: 'created_at', orderDir: 'ASC' });
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ subtype: 'search', query: 'kddi', limit: 20, offset: 0, orderBy: 'created_at', orderDir: 'ASC' })
    );
  });

  it('omits orderBy/orderDir from the payload when not provided', async () => {
    mockSendMessage.mockResolvedValue({ success: true, rows: [], total: 0 });
    await searchLogs('kddi', 20, 0);
    const call = mockSendMessage.mock.calls[mockSendMessage.mock.calls.length - 1][0];
    expect(call.orderBy).toBeUndefined();
    expect(call.orderDir).toBeUndefined();
  });
```

If the test file mocks `sendDashboardMessage` under a different name, use that name instead of `mockSendMessage` — check the top of the file for the existing mock setup (`vi.mock(...)` and the imported mock function) and match it exactly.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/dashboard/__tests__/dashboardSqliteService.test.ts -t "orderBy"`
Expected: FAIL — `searchLogs` does not accept a 4th argument, payload has no `orderBy`/`orderDir`.

- [ ] **Step 3: Implement the service layer change**

In `src/dashboard/dashboardSqliteService.ts`, update `searchLogs`:

```ts
export async function searchLogs(
  query: string,
  limit = 50,
  offset = 0,
  options: { orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' } = {}
): Promise<ServiceResult<{ rows: BrowsingLogEntry[]; total: number }>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await sendDashboardMessage({
        subtype: 'search',
        query,
        limit,
        offset,
        orderBy: options.orderBy,
        orderDir: options.orderDir,
      });
      if (response.success) {
        return {
          data: {
            rows: requiredRows(response.rows, 'rows', isBrowsingLogEntry),
            total: requiredNonNegativeNumber(response.total, 'total'),
          },
        };
      }
      if (attempt === 0 && response.retriable) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      console.warn('searchLogs failed:', String(response.error || 'Unknown error'));
      return { error: String(response.error || 'Search failed') };
    } catch (error) {
      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      console.error('searchLogs failed:', errorMessage(error));
      return { error: errorMessage(error) };
    }
  }
  return { error: 'Search failed' };
}
```

Keep the rest of the function (the final `return` after the loop, if present in the original) unchanged — only the signature and the `sendDashboardMessage` call body change.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/dashboard/__tests__/dashboardSqliteService.test.ts -t "orderBy"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/dashboardSqliteService.ts src/dashboard/__tests__/dashboardSqliteService.test.ts
git commit -m "feat: add orderBy/orderDir params to searchLogs"
```

---

### Task 4: Protocol + handler layer

**Files:**
- Modify: `src/background/handlers/dashboardSqliteProtocol.ts`
- Modify: `src/background/handlers/dashboardSqliteHandlers.ts`
- Test: `src/background/__tests__/dashboardSqliteHandlers.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/background/__tests__/dashboardSqliteHandlers.test.ts`, find the existing search-related tests (search for `subtype: 'search'`) and add:

```ts
  it('passes orderBy/orderDir through to deps.search', async () => {
    const search = vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } });
    const handler = createDashboardSqliteHandler({ ...baseDeps, search });
    await handler({ subtype: 'search', query: 'kddi', limit: 20, offset: 0, orderBy: 'created_at', orderDir: 'ASC' });
    expect(search).toHaveBeenCalledWith('kddi', 20, 0, { orderBy: 'created_at', orderDir: 'ASC' });
  });
```

Match `baseDeps` to whatever fixture/helper the existing tests in this file already use to build the deps object (search near the top of the file for how other tests construct `createDashboardSqliteHandler({...})`), and adjust the object spread accordingly.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/background/__tests__/dashboardSqliteHandlers.test.ts -t "orderBy"`
Expected: FAIL — `deps.search` is called with the old 3-arg signature.

- [ ] **Step 3: Implement the protocol and handler changes**

In `src/background/handlers/dashboardSqliteProtocol.ts`, update the `search` subtype:

```ts
  | { subtype: 'search'; query: string; limit?: number; offset?: number; orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' }
```

In `src/background/handlers/dashboardSqliteHandlers.ts`, find the `DashboardSqliteHandlerDeps` interface and update the `search` method signature (search for `search:` inside that interface):

```ts
  search: (query: string, limit: number, offset: number, options?: { orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' }) => Promise<DepsResult<{ rows: unknown[]; total: number }>>;
```

Match the existing `DepsResult<...>` return type used by the other deps methods in that interface — check the surrounding lines for the exact generic shape already in use (likely `{ rows: SearchResult[]; total: number }` or similar) and reuse it rather than `unknown[]`.

Update the `case 'search'` block:

```ts
        case 'search': {
          const result = await deps.search(
            payload.query || '',
            payload.limit ?? 50,
            payload.offset ?? 0,
            { orderBy: payload.orderBy, orderDir: payload.orderDir },
          );
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true, rows: result.data.rows, total: result.data.total };
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/background/__tests__/dashboardSqliteHandlers.test.ts -t "orderBy"`
Expected: PASS

Also run the full file to make sure nothing else broke:
Run: `npx vitest run src/background/__tests__/dashboardSqliteHandlers.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/background/handlers/dashboardSqliteProtocol.ts src/background/handlers/dashboardSqliteHandlers.ts src/background/__tests__/dashboardSqliteHandlers.test.ts
git commit -m "feat: thread orderBy/orderDir through search protocol and handler"
```

---

### Task 5: recordsRepo — pass `orderBy`/`orderDir` to the backend

**Files:**
- Modify: `src/offscreen/recordsRepo.ts`
- Test: none required for this file specifically (it is a thin passthrough); covered end-to-end by Task 6-8 backend tests. Verify manually with a type-check.

- [ ] **Step 1: Implement the change**

In `src/offscreen/recordsRepo.ts`, update `search`:

```ts
/**
 * Full-text search using FTS5.
 */
export async function search(
  searchQuery: string,
  limit: number = 50,
  offset: number = 0,
  options: { orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' } = {}
): Promise<{
  success: true; rows: SearchResult[]; total: number
} | { success: false; error: string }> {
  limit = Math.min(limit, MAX_QUERY_LIMIT);
  const backend = await engine.getBackend();
  const result = await backend.search(searchQuery, limit, offset, options);
  if (!result.success) return result;
  return { success: true, rows: result.rows as unknown as SearchResult[], total: result.total };
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: This will show errors in `StorageBackend` implementations (`IdbVfsBackend`, OPFS-related, `FallbackStorageAdapter`) because their `search()` signatures don't yet accept the 4th `options` param, and in the `StorageBackend` interface itself. This is expected — Task 6 fixes the interface and all implementations. Do not attempt to fix those errors in this task.

- [ ] **Step 3: Commit**

```bash
git add src/offscreen/recordsRepo.ts
git commit -m "feat: pass orderBy/orderDir from recordsRepo.search to the backend"
```

---

### Task 6: `StorageBackend` interface + `IdbVfsBackend` — branch `ORDER BY`

**Files:**
- Modify: `src/offscreen/StorageBackend.ts`
- Modify: `src/offscreen/IdbVfsBackend.ts`
- Test: `src/offscreen/__tests__/IdbVfsBackend-search-sort.test.ts` (new file)

- [ ] **Step 1: Find the `StorageBackend` interface's `search` method**

Run: `grep -n "search(" src/offscreen/StorageBackend.ts`

- [ ] **Step 2: Write the failing test**

First, check how existing `IdbVfsBackend` tests (if any) set up an in-memory/mock engine — search:

Run: `grep -rln "IdbVfsBackend" src/offscreen/__tests__/`

If a helper for constructing a testable `IdbVfsBackend` exists (e.g. an in-memory SQLite engine fixture), reuse it. Otherwise, this test needs a real or mocked `SqliteEngineContext` with `execWithCache` stubbed to capture the SQL string. Write the test using a stub engine:

Create `src/offscreen/__tests__/IdbVfsBackend-search-sort.test.ts`:

```ts
/**
 * IdbVfsBackend-search-sort.test.ts
 * Verifies IdbVfsBackend.search() switches its ORDER BY clause based on the
 * orderBy option instead of always sorting by FTS5 rank.
 */
import { describe, it, expect, vi } from 'vitest';
import { IdbVfsBackend } from '../IdbVfsBackend.js';

function makeStubEngine(overrides: { fts5Available?: boolean } = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const engine = {
    fts5Available: overrides.fts5Available ?? true,
    execWithCache: vi.fn(async (sql: string, params: unknown[] = [], callback?: (row: unknown[]) => void) => {
      calls.push({ sql, params });
      // COUNT queries: report 0 total. Row queries: report no rows.
      if (callback && /SELECT COUNT/i.test(sql)) {
        callback([0]);
      }
    }),
  };
  return { engine, calls };
}

describe('IdbVfsBackend.search — ORDER BY branch', () => {
  it('orders by rank when orderBy is omitted (default relevance)', async () => {
    const { engine, calls } = makeStubEngine();
    const backend = new IdbVfsBackend(engine as never);
    (backend as unknown as { ensureDb: () => void }).ensureDb = () => {};
    await backend.search('example query text', 20, 0);
    const rowQuery = calls.find(c => /ORDER BY/i.test(c.sql) && !/COUNT/i.test(c.sql));
    expect(rowQuery?.sql).toMatch(/ORDER BY rank/);
  });

  it('orders by created_at DESC when orderBy=created_at, orderDir=DESC', async () => {
    const { engine, calls } = makeStubEngine();
    const backend = new IdbVfsBackend(engine as never);
    (backend as unknown as { ensureDb: () => void }).ensureDb = () => {};
    await backend.search('example query text', 20, 0, { orderBy: 'created_at', orderDir: 'DESC' });
    const rowQuery = calls.find(c => /ORDER BY/i.test(c.sql) && !/COUNT/i.test(c.sql));
    expect(rowQuery?.sql).toMatch(/ORDER BY b\.created_at DESC, b\.id DESC/);
  });

  it('orders by created_at ASC when orderBy=created_at, orderDir=ASC', async () => {
    const { engine, calls } = makeStubEngine();
    const backend = new IdbVfsBackend(engine as never);
    (backend as unknown as { ensureDb: () => void }).ensureDb = () => {};
    await backend.search('example query text', 20, 0, { orderBy: 'created_at', orderDir: 'ASC' });
    const rowQuery = calls.find(c => /ORDER BY/i.test(c.sql) && !/COUNT/i.test(c.sql));
    expect(rowQuery?.sql).toMatch(/ORDER BY b\.created_at ASC, b\.id ASC/);
  });

  it('LIKE fallback path (short query) orders by created_at when requested', async () => {
    const { engine, calls } = makeStubEngine({ fts5Available: false });
    const backend = new IdbVfsBackend(engine as never);
    (backend as unknown as { ensureDb: () => void }).ensureDb = () => {};
    await backend.search('ai', 20, 0, { orderBy: 'created_at', orderDir: 'ASC' });
    const rowQuery = calls.find(c => /ORDER BY/i.test(c.sql) && !/COUNT/i.test(c.sql));
    expect(rowQuery?.sql).toMatch(/ORDER BY created_at ASC/);
  });
});
```

Check the actual constructor signature of `IdbVfsBackend` first:

Run: `grep -n "class IdbVfsBackend\|constructor" src/offscreen/IdbVfsBackend.ts`

Adjust the test's `new IdbVfsBackend(engine as never)` call to match — if the constructor takes the engine positionally as shown in `recordsRepo.ts`'s usage pattern (`new IdbVfsBackend(this)` in `sqliteEngineContext.ts`), the single-arg form above is correct. If `ensureDb` is not a private no-op method needing a stub (check its implementation), remove that override line.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/offscreen/__tests__/IdbVfsBackend-search-sort.test.ts`
Expected: FAIL — `search()` does not accept a 4th argument yet, and the SQL always says `ORDER BY rank`.

- [ ] **Step 4: Update the `StorageBackend` interface**

In `src/offscreen/StorageBackend.ts`, find the `search` method signature and change it to:

```ts
  search(
    query: string,
    limit: number,
    offset: number,
    options?: { orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' }
  ): Promise<BackendOrError<SearchResult>>;
```

(Match whatever the existing return type alias is named — it appeared as `BackendOrError<SearchResult>` in `IdbVfsBackend.ts` and `FallbackStorageAdapter.ts`; use the same import/alias already present in this file.)

- [ ] **Step 5: Implement the `IdbVfsBackend.search()` branch**

In `src/offscreen/IdbVfsBackend.ts`, replace the `search` method body. The current method (from line 104) has two paths — FTS5 and LIKE fallback — each with a hardcoded `ORDER BY`. Update the signature and both `ORDER BY` clauses:

```ts
  async search(
    searchQuery: string,
    limit: number,
    offset: number,
    options: { orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' } = {}
  ): Promise<BackendOrError<SearchResult>> {
    this.ensureDb();
    const capLimit = Math.min(limit, 100000);
    const bare = sanitizeFtsTerm(searchQuery);
    if (!bare) {
      return { success: true, rows: [], total: 0 };
    }

    const dir = options.orderDir ?? 'DESC';
    const orderClause = options.orderBy === 'created_at'
      ? `b.created_at ${dir}, b.id ${dir}`
      : 'rank';

    const charLen = [...bare].length;
    if (this.engine.fts5Available && charLen >= 3) {
      const ftsQuery = `"${bare}"`;
      let total = 0;
      await this.engine.execWithCache(
        `SELECT COUNT(*) FROM browsing_logs_fts WHERE browsing_logs_fts MATCH ?`,
        [ftsQuery],
        (row: SqliteValue[]) => { total = Number(row[0]); }
      );

      const rows: (BrowsingLogEntry & { rank: number })[] = [];
      await this.engine.execWithCache(
        `SELECT b.id, b.url, b.title, b.summary, b.tags, b.created_at, b.domain, b.visit_duration, b.scroll_ratio, b.is_starred, rank
         FROM browsing_logs_fts
         JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id
         WHERE browsing_logs_fts MATCH ? AND b.is_deleted = 0
         ORDER BY ${orderClause}
         LIMIT ? OFFSET ?`,
        [ftsQuery, capLimit, offset],
        (row: SqliteValue[]) => {
          rows.push({
            id: Number(row[0]), url: String(row[1]),
            title: row[2] != null ? String(row[2]) : null,
            summary: row[3] != null ? String(row[3]) : null,
            tags: row[4] != null ? String(row[4]) : null,
            created_at: Number(row[5]),
            domain: row[6] != null ? String(row[6]) : null,
            visit_duration: row[7] != null ? Number(row[7]) : null,
            scroll_ratio: row[8] != null ? Number(row[8]) : null,
            is_starred: Number(row[9]),
            rank: Number(row[10]),
          });
        }
      );
      return { success: true, rows, total };
    }

    const likePattern = `%${searchQuery}%`;
    const likeOrderClause = options.orderBy === 'created_at'
      ? `created_at ${dir}`
      : `created_at DESC`;
    let total = 0;
    await this.engine.execWithCache(
      `SELECT COUNT(*) FROM browsing_logs WHERE is_deleted = 0 AND (url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?)`,
      [likePattern, likePattern, likePattern, likePattern],
      (row: SqliteValue[]) => { total = Number(row[0]); }
    );

    const rows: (BrowsingLogEntry & { rank: number })[] = [];
    await this.engine.execWithCache(
      `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred
       FROM browsing_logs
       WHERE is_deleted = 0 AND (url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?)
       ORDER BY ${likeOrderClause}
       LIMIT ? OFFSET ?`,
      [likePattern, likePattern, likePattern, likePattern, capLimit, offset],
      (row: SqliteValue[]) => {
        rows.push({
          id: Number(row[0]), url: String(row[1]),
          title: row[2] != null ? String(row[2]) : null,
          summary: row[3] != null ? String(row[3]) : null,
          tags: row[4] != null ? String(row[4]) : null,
          created_at: Number(row[5]),
          domain: row[6] != null ? String(row[6]) : null,
          visit_duration: row[7] != null ? Number(row[7]) : null,
          scroll_ratio: row[8] != null ? Number(row[8]) : null,
          is_starred: Number(row[9]),
          rank: 0,
        });
      }
    );
    return { success: true, rows, total };
  }
```

Note: `${dir}`/`${orderClause}` are built from a closed set of internal string literals (`'ASC'`/`'DESC'`, `'created_at'`/`'rank'`), never from raw user input, so this is not a SQL-injection risk — the search term itself continues to go through parameterized `?` placeholders exactly as before.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/offscreen/__tests__/IdbVfsBackend-search-sort.test.ts`
Expected: PASS

- [ ] **Step 7: Type-check**

Run: `npm run type-check`
Expected: Errors should now only be in `opfsWorker.ts`-related caller (`OpfsWorkerBackend.ts`, if it implements `StorageBackend.search`) and `FallbackStorageAdapter.ts`. Confirm no errors remain in `IdbVfsBackend.ts` or `recordsRepo.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/offscreen/StorageBackend.ts src/offscreen/IdbVfsBackend.ts src/offscreen/__tests__/IdbVfsBackend-search-sort.test.ts
git commit -m "feat: branch IdbVfsBackend.search ORDER BY on orderBy/orderDir"
```

---

### Task 7: OPFS Worker backend — same branch

**Files:**
- Modify: `src/offscreen/opfsWorker.ts`
- Modify: `src/offscreen/OpfsWorkerBackend.ts` (the `StorageBackend` implementation that proxies to the worker — confirm this file exists and implements `search`)
- Test: `src/offscreen/__tests__/opfsWorker-search-sort.test.ts` (new file, only if a worker-message-level test harness already exists for this file — see Step 1)

- [ ] **Step 1: Locate the caller-side backend and existing test harness**

Run: `grep -n "class OpfsWorkerBackend" -A 5 src/offscreen/OpfsWorkerBackend.ts`
Run: `grep -n "search" src/offscreen/OpfsWorkerBackend.ts`
Run: `find src/offscreen/__tests__ -iname "*opfsWorker*" -o -iname "*OpfsWorkerBackend*"`

If a test harness for `opfsWorker.ts`'s message handlers already exists (e.g. one that imports `handleSearch` directly or simulates worker messages), model the new test after it. If none exists, skip the dedicated unit test for `opfsWorker.ts` internals — its logic is a near-duplicate of `IdbVfsBackend.search`, already covered at the SQL-construction level by Task 6 — but still make the code change and rely on the type-check plus the E2E-style test in Task 8's `sqliteHistoryQuery.test.ts` coverage (which exercises the whole chain via mocked sources, not the real worker) to catch signature mismatches. Do not skip the `OpfsWorkerBackend.search()` passthrough change itself.

- [ ] **Step 2: Update `OpfsWorkerBackend.search()` passthrough**

Read the current implementation:

Run: `grep -n "async search" -A 15 src/offscreen/OpfsWorkerBackend.ts`

Update its signature to match the `StorageBackend` interface from Task 6 and forward the options into the worker message payload (find the `postMessage`/`sendToOpfsWorker` call inside this method and add `orderBy`/`orderDir` to its payload object):

```ts
  async search(
    searchQuery: string,
    limit: number,
    offset: number,
    options: { orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' } = {}
  ): Promise<BackendOrError<SearchResult>> {
    // Keep whatever this method already does to reach the worker (e.g.
    // this.engine.sendToOpfsWorker('SEARCH', {...})) — only add orderBy and
    // orderDir to the payload object passed to that call, alongside the
    // existing searchQuery/limit/offset fields.
  }
```

Apply this as a targeted edit: find the existing payload object literal in this method and add two keys, `orderBy: options.orderBy` and `orderDir: options.orderDir`, without altering anything else in the method.

- [ ] **Step 3: Update `opfsWorker.ts`'s message handler and both search functions**

In `src/offscreen/opfsWorker.ts`:

Find the `SearchPayload` type definition (referenced by `handleSearch(payload: SearchPayload)`):

Run: `grep -n "interface SearchPayload\|type SearchPayload" src/offscreen/opfsWorker.ts`

Add `orderBy`/`orderDir` fields to it:

```ts
interface SearchPayload {
  searchQuery: string;
  limit?: number;
  offset?: number;
  orderBy?: 'rank' | 'created_at';
  orderDir?: 'ASC' | 'DESC';
}
```

(Adjust to match however the type is actually declared — it may be inline in the message-handling switch rather than a named interface; if inline, add the fields at that call site instead.)

Update `handleSearch`:

```ts
async function handleSearch(payload: SearchPayload): Promise<{ rows: SearchResult[]; total: number }> {
  const { searchQuery, limit = 50, offset = 0, orderBy, orderDir } = payload;
  const bare = sanitizeFtsTerm(searchQuery);
  if (!bare) return { rows: [], total: 0 };

  const charLen = [...bare].length;
  if (fts5Available && charLen >= 3) {
    return handleSearchFts(`"${bare}"`, limit, offset, orderBy, orderDir);
  }
  return handleSearchLike(searchQuery, limit, offset, orderBy, orderDir);
}
```

Update `handleSearchFts`:

```ts
async function handleSearchFts(
  sanitizedQuery: string, limit: number, offset: number,
  orderBy?: 'rank' | 'created_at', orderDir?: 'ASC' | 'DESC'
): Promise<{ rows: SearchResult[]; total: number }> {
  let total = 0;
  await sqlQuery(
    `SELECT COUNT(*) AS c FROM browsing_logs_fts
JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id
WHERE browsing_logs_fts MATCH ? AND b.is_deleted = 0`,
    [sanitizedQuery],
    (row) => { total = Number(row.c); }
  );

  const dir = orderDir ?? 'DESC';
  const orderClause = orderBy === 'created_at' ? `b.created_at ${dir}, b.id ${dir}` : 'rank';

  const rows: SearchResult[] = [];
  await sqlQuery(
    `SELECT b.id, b.url, b.title, b.summary, b.tags, b.created_at, b.domain, b.visit_duration, b.scroll_ratio, b.is_starred, rank AS rank
     FROM browsing_logs_fts
     JOIN browsing_logs b ON browsing_logs_fts.rowid = b.id
     WHERE browsing_logs_fts MATCH ? AND b.is_deleted = 0
     ORDER BY ${orderClause} LIMIT ? OFFSET ?`,
    [sanitizedQuery, limit, offset],
    (row) => {
      rows.push({
        id: Number(row.id),
        url: String(row.url),
        title: row.title as string | null,
        summary: row.summary as string | null,
        tags: row.tags as string | null,
        created_at: Number(row.created_at),
        domain: row.domain as string | null,
        visit_duration: row.visit_duration as number | null,
        scroll_ratio: row.scroll_ratio as number | null,
        is_starred: Number(row.is_starred),
        rank: Number(row.rank),
      });
    }
  );

  return { rows, total };
}
```

Update `handleSearchLike`:

```ts
async function handleSearchLike(
  rawQuery: string, limit: number, offset: number,
  orderBy?: 'rank' | 'created_at', orderDir?: 'ASC' | 'DESC'
): Promise<{ rows: SearchResult[]; total: number }> {
  const like = `%${rawQuery}%`;
  const conditions = 'is_deleted = 0 AND (url LIKE ? OR title LIKE ? OR summary LIKE ? OR tags LIKE ?)';
  const params: SqliteValue[] = [like, like, like, like];

  let total = 0;
  await sqlQuery(
    `SELECT COUNT(*) AS c FROM browsing_logs WHERE ${conditions}`,
    params,
    (row) => { total = Number(row.c); }
  );

  const dir = orderBy === 'created_at' ? (orderDir ?? 'DESC') : 'DESC';

  const rows: SearchResult[] = [];
  await sqlQuery(
    `SELECT id, url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred
     FROM browsing_logs WHERE ${conditions}
     ORDER BY created_at ${dir} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
    (row) => {
      rows.push({
        id: Number(row.id),
        url: String(row.url),
        title: row.title as string | null,
        summary: row.summary as string | null,
        tags: row.tags as string | null,
        created_at: Number(row.created_at),
        domain: row.domain as string | null,
        visit_duration: row.visit_duration as number | null,
        scroll_ratio: row.scroll_ratio as number | null,
        is_starred: Number(row.is_starred),
        rank: 0,
      });
    }
  );

  return { rows, total };
}
```

Also find where `handleSearch` is invoked from the worker's `onmessage` dispatch (search for `case 'SEARCH'` or similar in `opfsWorker.ts`) and confirm the payload passed through already includes whatever `OpfsWorkerBackend.search()` sends — no change needed there if it forwards the whole payload object as-is.

- [ ] **Step 4: Type-check**

Run: `npm run type-check`
Expected: No errors in `opfsWorker.ts` or `OpfsWorkerBackend.ts`. If `FallbackStorageAdapter.ts` still shows an error, that's expected — fixed in Task 8.

- [ ] **Step 5: Commit**

```bash
git add src/offscreen/opfsWorker.ts src/offscreen/OpfsWorkerBackend.ts
git commit -m "feat: branch OPFS worker search ORDER BY on orderBy/orderDir"
```

---

### Task 8: FallbackStorage backend — sort `matched` in-memory

**Files:**
- Modify: `src/offscreen/storageFallback.ts`
- Modify: `src/offscreen/FallbackStorageAdapter.ts`
- Test: `src/offscreen/__tests__/storageFallback-search-sort.test.ts` (new file)

- [ ] **Step 1: Check existing test file for `storageFallback.ts`**

Run: `find src/offscreen/__tests__ -iname "*storageFallback*"`

If one exists, check its setup helpers (how records are seeded, how `FallbackStorage` is constructed/mocked with `chrome.storage.local`) and reuse that pattern.

- [ ] **Step 2: Write the failing test**

Create `src/offscreen/__tests__/storageFallback-search-sort.test.ts`, adapting the seeding pattern found in Step 1 (if none was found, use this self-contained approach with a stubbed `chrome.storage.local`):

```ts
/**
 * storageFallback-search-sort.test.ts
 * Verifies FallbackStorage.search() sorts by orderBy/orderDir instead of
 * always returning records in storage order.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FallbackStorage } from '../storageFallback.js';

const STORAGE_KEY = '__fallback_records__';

function seedRecords(records: Array<{ id: number; url: string; created_at: number; is_deleted?: number }>) {
  const store: Record<string, unknown> = {
    [STORAGE_KEY]: { records: records.map(r => ({ is_deleted: 0, title: null, summary: null, tags: null, domain: null, visit_duration: null, scroll_ratio: null, is_starred: 0, ...r })) },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const result: Record<string, unknown> = {};
          for (const k of list) if (k in store) result[k] = store[k];
          return result;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(store, items); }),
      },
    },
  };
}

describe('FallbackStorage.search — sort', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sorts by created_at DESC when orderBy=created_at, orderDir=DESC', async () => {
    seedRecords([
      { id: 1, url: 'https://a.example.com', created_at: 100 },
      { id: 2, url: 'https://b.example.com', created_at: 300 },
      { id: 3, url: 'https://c.example.com', created_at: 200 },
    ]);
    const storage = new FallbackStorage();
    const result = await storage.search('example', 10, 0, { orderBy: 'created_at', orderDir: 'DESC' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows.map(r => r.id)).toEqual([2, 3, 1]);
    }
  });

  it('sorts by created_at ASC when orderBy=created_at, orderDir=ASC', async () => {
    seedRecords([
      { id: 1, url: 'https://a.example.com', created_at: 100 },
      { id: 2, url: 'https://b.example.com', created_at: 300 },
      { id: 3, url: 'https://c.example.com', created_at: 200 },
    ]);
    const storage = new FallbackStorage();
    const result = await storage.search('example', 10, 0, { orderBy: 'created_at', orderDir: 'ASC' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows.map(r => r.id)).toEqual([1, 3, 2]);
    }
  });
});
```

Check `FallbackStorage`'s actual constructor and `loadData`/storage-key details first:

Run: `grep -n "class FallbackStorage\|constructor\|STORAGE_KEY\|private.*key" src/offscreen/storageFallback.ts | head -20`

Adjust `STORAGE_KEY` in the test to match the real key used by `loadData()`/`saveData()` in `storageFallback.ts`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/offscreen/__tests__/storageFallback-search-sort.test.ts`
Expected: FAIL — `search()` does not accept a 4th argument, and results come back in insertion order (id 1, 2, 3) instead of sorted.

- [ ] **Step 4: Implement the `FallbackStorage.search()` sort**

In `src/offscreen/storageFallback.ts`, update the `search` method:

```ts
  async search(
    searchQuery: string,
    limit: number = 50,
    offset: number = 0,
    options: { orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' } = {}
  ): Promise<{
    success: true; rows: SearchResult[]; total: number
  } | { success: false; error: string }> {
    try {
      const data = await this.loadData();
      const query = searchQuery.toLowerCase();

      const matched = data.records.filter(r => {
        if (r.is_deleted !== 0) return false;
        const searchable = [r.url, r.title, r.summary, r.tags]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return searchable.includes(query);
      });

      // No FTS5 rank exists in the fallback path, so 'relevance' has nothing
      // to sort by — only an explicit created_at request changes the order;
      // otherwise keep the existing insertion-order behavior unchanged.
      if (options.orderBy === 'created_at') {
        const dir = options.orderDir ?? 'DESC';
        matched.sort((a, b) => dir === 'ASC' ? a.created_at - b.created_at : b.created_at - a.created_at);
      }

      const total = matched.length;
      const paged = matched.slice(offset, offset + limit);

      const rows: SearchResult[] = paged.map(r => ({
        id: r.id!,
        url: r.url,
        title: r.title ?? null,
        summary: r.summary ?? null,
        tags: r.tags ?? null,
        created_at: r.created_at,
        domain: r.domain ?? null,
        visit_duration: r.visit_duration ?? null,
        scroll_ratio: r.scroll_ratio ?? null,
        is_starred: r.is_starred ?? 0,
        rank: 0,
      }));

      return { success: true, rows, total };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
```

- [ ] **Step 5: Update `FallbackStorageAdapter.search()` passthrough**

In `src/offscreen/FallbackStorageAdapter.ts`:

```ts
  async search(
    query: string,
    limit: number,
    offset: number,
    options: { orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' } = {}
  ): Promise<BackendOrError<SearchResult>> {
    const result = await this.fallback.search(query, limit, offset, options);
    if (!result.success) return result;
    return { success: true, rows: result.rows as SearchResult['rows'], total: result.total };
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/offscreen/__tests__/storageFallback-search-sort.test.ts`
Expected: PASS

- [ ] **Step 7: Full type-check**

Run: `npm run type-check`
Expected: No errors anywhere in the `StorageBackend` implementation chain.

- [ ] **Step 8: Commit**

```bash
git add src/offscreen/storageFallback.ts src/offscreen/FallbackStorageAdapter.ts src/offscreen/__tests__/storageFallback-search-sort.test.ts
git commit -m "feat: sort FallbackStorage.search results by orderBy/orderDir"
```

---

### Task 9: `StorageKeys` + i18n messages

**Files:**
- Modify: `src/utils/storage/types.ts`
- Modify: `public/_locales/ja/messages.json`
- Modify: `public/_locales/en/messages.json`

- [ ] **Step 1: Add the storage key**

In `src/utils/storage/types.ts`, inside the `StorageKeys` object, add a new entry near other dashboard/UI-preference keys (search for a logical grouping — if none fits cleanly, add it right after `OBSIDIAN_DAILY_PATH` or at the end of the object before the closing `}`):

```ts
    HISTORY_SORT_PREFERENCE: 'history_sort_preference', // 履歴パネルのソート設定 { sortBy, sortDir } をJSON文字列で保存
```

- [ ] **Step 2: Add i18n keys**

In `public/_locales/ja/messages.json`, find the `"historyLast30Days"` entry (around line 3252-3254) and add after it:

```json
  "historySortLabel": {
    "message": "並び替え"
  },
  "historySortNewest": {
    "message": "新しい順"
  },
  "historySortOldest": {
    "message": "古い順"
  },
  "historySortRelevance": {
    "message": "関連度順"
  },
```

In `public/_locales/en/messages.json`, find the `"historyLast30Days"` entry (around line 3336-3338, based on the offset observed for `historyToday` at 3340) and add the equivalent block:

```json
  "historySortLabel": {
    "message": "Sort"
  },
  "historySortNewest": {
    "message": "Newest first"
  },
  "historySortOldest": {
    "message": "Oldest first"
  },
  "historySortRelevance": {
    "message": "Relevance"
  },
```

Verify JSON validity after editing both files:

Run: `node -e "JSON.parse(require('fs').readFileSync('public/_locales/ja/messages.json', 'utf8')); JSON.parse(require('fs').readFileSync('public/_locales/en/messages.json', 'utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/utils/storage/types.ts public/_locales/ja/messages.json public/_locales/en/messages.json
git commit -m "feat: add HISTORY_SORT_PREFERENCE storage key and sort i18n labels"
```

---

### Task 10: UI — sort `<select>` in the panel, persistence

**Files:**
- Modify: `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts`
- Test: `src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanel-sort.test.ts` (new file)

- [ ] **Step 1: Check the existing jsdom test setup pattern for this panel**

Run: `sed -n '1,50p' src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanel-tagFallback.test.ts`

This shows how `createSqliteHistoryPanel`, `queryHistory` mocking, `mount`/`loadData`, and `chrome.storage.local`/`chrome.runtime` mocks are typically wired for this panel's tests. Reuse the same mocking approach (likely `vi.mock('../sqliteHistoryQuery.js', ...)` plus a jsdom container).

- [ ] **Step 2: Write the failing tests**

Create `src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanel-sort.test.ts`, following the setup pattern discovered in Step 1. Adapt the mock module paths and `chrome` global stub exactly as done in `sqliteHistoryPanel-tagFallback.test.ts` — the skeleton below shows the required assertions; fill in the exact mock wiring to match that file's conventions:

```ts
/**
 * sqliteHistoryPanel-sort.test.ts
 * Verifies the sort <select> renders, is wired to the reducer, hides the
 * relevance option outside an active search, and persists the chosen sort
 * to chrome.storage.local.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSqliteHistoryPanel } from '../sqliteHistoryPanel.js';
import * as sqliteHistoryQuery from '../sqliteHistoryQuery.js';

// Mirror the mocking approach used in sqliteHistoryPanel-tagFallback.test.ts:
// mock queryHistory, getSqliteStatus, and any other dashboardSqliteService
// exports this panel calls during mount/loadData, and stub `chrome.storage.local`
// / `chrome.runtime` / `chrome.notifications` as globals before each test.

describe('createSqliteHistoryPanel — sort control', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    // ... reuse the same chrome.* stubbing and queryHistory mock reset as
    // sqliteHistoryPanel-tagFallback.test.ts's beforeEach.
  });

  it('renders a sort select defaulting to created_at DESC (newest first)', async () => {
    const panel = createSqliteHistoryPanel();
    panel.mount(container);
    await panel.loadData();
    const select = document.getElementById('sqlite-sort-select') as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(select!.value).toBe('created_at:DESC');
  });

  it('does not show a relevance option when there is no active search', async () => {
    const panel = createSqliteHistoryPanel();
    panel.mount(container);
    await panel.loadData();
    const select = document.getElementById('sqlite-sort-select') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    expect(options).not.toContain('relevance:DESC');
  });

  it('changing the select fires a new query with the chosen sort', async () => {
    const panel = createSqliteHistoryPanel();
    panel.mount(container);
    await panel.loadData();
    const queryHistorySpy = vi.spyOn(sqliteHistoryQuery, 'queryHistory');
    const select = document.getElementById('sqlite-sort-select') as HTMLSelectElement;
    select.value = 'created_at:ASC';
    select.dispatchEvent(new Event('change'));
    await Promise.resolve();
    expect(queryHistorySpy).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: 'created_at', sortDir: 'ASC' }),
      expect.anything(),
    );
  });

  it('persists the chosen sort to chrome.storage.local', async () => {
    const panel = createSqliteHistoryPanel();
    panel.mount(container);
    await panel.loadData();
    const select = document.getElementById('sqlite-sort-select') as HTMLSelectElement;
    select.value = 'created_at:ASC';
    select.dispatchEvent(new Event('change'));
    await Promise.resolve();
    expect(chrome.storage.local.set).toHaveBeenCalledWith(
      expect.objectContaining({ history_sort_preference: JSON.stringify({ sortBy: 'created_at', sortDir: 'ASC' }) })
    );
  });
});
```

Note the exact `queryHistory` mock signature must match `sqliteHistoryPanel-tagFallback.test.ts`'s existing `vi.mock('../sqliteHistoryQuery.js', ...)` factory (this file uses `vi.spyOn` above only as a placeholder illustration — replace with whatever mocking mechanism that sibling test file actually uses, since `sqliteHistoryQuery.js` is very likely already `vi.mock`'d at module level there, which conflicts with `vi.spyOn` on the same module in a fresh test file; copy the sibling file's `vi.mock` block verbatim into this file's top-level, adjusting only the assertions).

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanel-sort.test.ts`
Expected: FAIL — no `#sqlite-sort-select` element exists yet.

- [ ] **Step 4: Implement the UI changes**

In `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts`:

Add a helper near the top (after `formatTimestamp`, before `buildCleansingProgressBarHtml`):

```ts
const HISTORY_SORT_STORAGE_KEY = 'history_sort_preference';

function sortSelectValue(sortBy: SqliteHistoryState['sortBy'], sortDir: SqliteHistoryState['sortDir']): string {
  return `${sortBy}:${sortDir}`;
}

function parseSortSelectValue(value: string): { sortBy: SqliteHistoryState['sortBy']; sortDir: SqliteHistoryState['sortDir'] } {
  const [sortBy, sortDir] = value.split(':');
  return {
    sortBy: sortBy === 'relevance' ? 'relevance' : 'created_at',
    sortDir: sortDir === 'ASC' ? 'ASC' : 'DESC',
  };
}

async function loadPersistedSort(): Promise<{ sortBy: SqliteHistoryState['sortBy']; sortDir: SqliteHistoryState['sortDir'] } | null> {
  try {
    const items = await chrome.storage.local.get(HISTORY_SORT_STORAGE_KEY);
    const raw = items[HISTORY_SORT_STORAGE_KEY];
    if (typeof raw !== 'string') return null;
    const parsed = JSON.parse(raw) as { sortBy?: string; sortDir?: string };
    if (parsed.sortBy !== 'created_at' && parsed.sortBy !== 'relevance') return null;
    if (parsed.sortDir !== 'ASC' && parsed.sortDir !== 'DESC') return null;
    return { sortBy: parsed.sortBy, sortDir: parsed.sortDir };
  } catch {
    return null;
  }
}

async function persistSort(sortBy: SqliteHistoryState['sortBy'], sortDir: SqliteHistoryState['sortDir']): Promise<void> {
  try {
    await chrome.storage.local.set({ [HISTORY_SORT_STORAGE_KEY]: JSON.stringify({ sortBy, sortDir }) });
  } catch (error) {
    console.error('Failed to persist history sort preference:', error);
  }
}
```

Add a render function alongside `renderCalendarNav` (place it right before `renderCalendarNav`):

```ts
  function renderSortControl(
    _container: HTMLElement,
    sortBy: SqliteHistoryState['sortBy'],
    sortDir: SqliteHistoryState['sortDir'],
    hasActiveSearch: boolean,
    onChange: (sortBy: SqliteHistoryState['sortBy'], sortDir: SqliteHistoryState['sortDir']) => void,
  ): void {
    const options = [
      { value: sortSelectValue('created_at', 'DESC'), label: t('historySortNewest') || '新しい順' },
      { value: sortSelectValue('created_at', 'ASC'), label: t('historySortOldest') || '古い順' },
    ];
    if (hasActiveSearch) {
      options.push({ value: sortSelectValue('relevance', 'DESC'), label: t('historySortRelevance') || '関連度順' });
    }

    const currentValue = sortSelectValue(sortBy, sortDir);
    // A relevance value with no active search cannot be rendered (its option
    // was omitted above); fall back to newest-first so the select always has
    // a matching selected option.
    const safeValue = options.some(o => o.value === currentValue) ? currentValue : sortSelectValue('created_at', 'DESC');

    _container.innerHTML = `
      <label class="sqlite-sort-label" for="sqlite-sort-select">${t('historySortLabel') || '並び替え'}</label>
      <select id="sqlite-sort-select" aria-label="${t('historySortLabel') || '並び替え'}">
        ${options.map(o => `<option value="${o.value}"${o.value === safeValue ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
      </select>
    `;

    const select = _container.querySelector('#sqlite-sort-select') as HTMLSelectElement | null;
    select?.addEventListener('change', () => {
      const parsed = parseSortSelectValue(select.value);
      onChange(parsed.sortBy, parsed.sortDir);
    });
  }
```

Add a handler function near `handleDateSelect`:

```ts
  async function handleSortChange(sortBy: SqliteHistoryState['sortBy'], sortDir: SqliteHistoryState['sortDir']): Promise<void> {
    state = historyStateReducer(state, { type: 'sortChange', sortBy, sortDir });
    void persistSort(sortBy, sortDir);
    if (state.searchQuery.trim()) {
      await fetchData({ search: state.searchQuery, page: 0 });
    } else {
      await fetchData({ ...dateRangeFromSelected(), page: 0 });
    }
  }
```

Thread `sortBy`/`sortDir` into every `fetchData` call's `queryHistory` invocation. In `fetchData`, update the options type and the `queryHistory` call:

```ts
  async function fetchData(options: {
    limit?: number;
    since?: number;
    until?: number;
    search?: string;
    page?: number;
    tagFilter?: string;
    tagInitiated?: boolean;
  } = {}): Promise<void> {
    const generation = ++requestGeneration;
    state = historyStateReducer(state, { type: 'loadStart' });
    refresh();

    try {
      const page = Math.max(0, options.page ?? state.currentPage);
      const limit = PAGE_SIZE;
      const offset = page * limit;

      const activeTagFilter = options.tagFilter !== undefined ? options.tagFilter : state.activeTagFilter;

      const result: UnifiedHistoryQueryResult = await queryHistory({
        search: options.search,
        since: options.since,
        until: options.until,
        limit,
        offset,
        tagFilter: activeTagFilter || undefined,
        tagInitiated: options.tagInitiated,
        sortBy: state.sortBy,
        sortDir: state.sortDir,
      });
```

(Leave the rest of `fetchData` — the `if (generation !== requestGeneration) return;` block onward — unchanged.)

Add the sort control's mount point to the panel's HTML template. In `renderState()`, find the `.sqlite-history-search` div and add a container inside it, right after the search `<input>`:

```ts
      <div class="sqlite-history-search">
        <input type="text" id="sqlite-search-input"
          placeholder="${t('historySearchPlaceholder')}"
          value="${escapeHtml(state.searchQuery)}"
          aria-label="${t('historySearchAriaLabel')}" />
        <div id="sqlite-sort-control" class="sqlite-sort-control"></div>
        <div id="sqlite-calendar-nav" class="sqlite-calendar-nav"></div>
        <div id="sqlite-error" class="sqlite-history-error${state.error ? '' : ' hidden'}">
          ${escapeHtml(state.error || '')}
        </div>
      </div>
```

**Correction found in a follow-up adversarial pass (2026-08-16):** `Boolean(state.searchQuery.trim())` is not the right condition for "a full-text search is actually running." When a tag is clicked (`tagInitiated` action, or `onActivate`'s `init.searchTag` branch), `state.searchQuery` is set to the tag name as a *display label*, but `fetchData` is called with `tagFilter` only — `search` is never passed, so `queryHistory` takes the non-search (`queryLogs`) path where `orderBy` is always `created_at` (see Task 2's non-search branch). In that state, `state.searchQuery` is non-empty but no FTS5 `rank` exists, so showing "relevance" as a selectable option is misleading — picking it has no effect, since the non-search path ignores `sortBy` entirely.

This is not simply "hide relevance whenever a tag filter is active" either: when a tag filter matches nothing and falls back to full-text search (`pendingTagFallback` gets set — see `sqliteHistoryQuery.ts`'s `tagFallback` handling), a real FTS5 search *is* running even though `activeTagFilter` is still non-null (clearing the tag filter is a separate user action). Hiding relevance in that case would incorrectly suppress a legitimate option.

Add this helper near `sortSelectValue`/`parseSortSelectValue`:

```ts
  /**
   * True only when queryHistory will actually take the FTS5 search path
   * (searchLogs, with a real `rank`) — not merely when the search box has
   * text in it. A tag click populates the search box as a display label
   * without running a full-text search (see fetchData's tagInitiated path,
   * which passes tagFilter but never search); relevance sort has nothing to
   * rank against there. A tag-fallback search (pendingTagFallback set) does
   * run FTS5 even while activeTagFilter is still set, so it must not be
   * excluded by a blanket "activeTagFilter present" check.
   */
  function isFullTextSearchActive(state: SqliteHistoryState): boolean {
    if (!state.searchQuery.trim()) return false;
    if (!state.activeTagFilter) return true;
    return state.pendingTagFallback !== null;
  }
```

In `renderState()`, right after the existing calendar-nav render block (the `if (!state.loading) { const calContainer = ...; renderCalendarNav(...); }` block), add:

```ts
      const sortContainer = document.getElementById('sqlite-sort-control');
      if (sortContainer) {
        renderSortControl(
          sortContainer,
          state.sortBy,
          state.sortDir,
          isFullTextSearchActive(state),
          (sortBy, sortDir) => void handleSortChange(sortBy, sortDir),
        );
      }
```

In `updateDynamicRegions()` (the non-full-render refresh path), add the same block right after the existing `calContainer`/`renderCalendarNav` block:

```ts
    const sortContainer = document.getElementById('sqlite-sort-control');
    if (sortContainer) {
      renderSortControl(
        sortContainer,
        state.sortBy,
        state.sortDir,
        isFullTextSearchActive(state),
        (sortBy, sortDir) => void handleSortChange(sortBy, sortDir),
      );
    }
```

Add these cases to `sqliteHistoryPanel-sort.test.ts` (Step 2 below), alongside the other assertions:

```ts
  it('does not show relevance while a tag filter is active without a fallback search', async () => {
    // Simulate onActivate({ searchTag: 'AI' }) equivalent: activeTagFilter set,
    // searchQuery populated as a label, no pendingTagFallback.
    const panel = createSqliteHistoryPanel();
    panel.mount(container);
    panel.onActivate?.({ searchTag: 'AI' });
    await panel.loadData();
    const select = document.getElementById('sqlite-sort-select') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    expect(options).not.toContain('relevance:DESC');
  });

  it('shows relevance when a tag filter fell back to full-text search', async () => {
    // Mock queryHistory (per this file's existing vi.mock block) to return a
    // tagFallback result so pendingTagFallback becomes non-null while
    // activeTagFilter is still set.
    const panel = createSqliteHistoryPanel();
    panel.mount(container);
    panel.onActivate?.({ searchTag: 'nonexistent-tag' });
    await panel.loadData();
    const select = document.getElementById('sqlite-sort-select') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.value);
    expect(options).toContain('relevance:DESC');
  });
```

The second test requires the mocked `queryHistory` (from this file's `vi.mock('../sqliteHistoryQuery.js', ...)` block, copied from `sqliteHistoryPanel-tagFallback.test.ts` per Step 1) to return a `tagFallback` payload with a non-null `pendingTagFallback` for the `nonexistent-tag` call — mirror the mock setup used in `sqliteHistoryPanel-tagFallback.test.ts`'s "falls back to searchLogs and shows a notice" test case.

Finally, load the persisted sort preference before the initial fetch. In the panel's `loadData()` method:

```ts
    async loadData() {
      if (!container) return;

      isMounted = true;
      await checkFallbackStatus();

      const persistedSort = await loadPersistedSort();
      if (persistedSort) {
        state = { ...state, sortBy: persistedSort.sortBy, sortDir: persistedSort.sortDir };
      }

      renderState();

      const fetchOpts = consumePendingInit();
      void retryInitialLoad(fetchOpts ?? { limit: PAGE_SIZE });
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanel-sort.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full existing test suite for this panel to check for regressions**

Run: `npx vitest run src/dashboard/panels/asyncData/__tests__/`
Expected: PASS (all files, including `sqliteHistoryPanel-tagFallback.test.ts`, `sqliteHistoryPanel-writeError.test.ts`, `sqliteHistoryPanelState.test.ts`, `sqliteHistoryQuery.test.ts`, `sqliteHistoryPanel-pagination.test.ts`)

- [ ] **Step 7: Type-check the whole project**

Run: `npm run type-check`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/dashboard/panels/asyncData/sqliteHistoryPanel.ts src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanel-sort.test.ts
git commit -m "feat: add sort dropdown to history panel with persistence"
```

---

### Task 11: Full validation and manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run validate`
Expected: PASS (type-check + all tests)

- [ ] **Step 2: Build the extension**

Run: `npm run build`
Expected: Build succeeds, `dist/chromium-mv3` is populated.

- [ ] **Step 3: Manual verification in Chrome**

1. Open `chrome://extensions`, ensure Developer mode is on, load unpacked from `dist/chromium-mv3` (or reload if already loaded).
2. Open the dashboard (via the extension's popup menu button or `chrome-extension://<id>/options.html`).
3. Navigate to the SQLite History panel.
4. Verify a "並び替え" select appears next to the search box, defaulting to "新しい順".
5. Switch to "古い順" and confirm the oldest entries now appear first.
6. Type a search query (e.g. a keyword known to exist in your history) and confirm a "関連度順" option appears and becomes selected by default when initiating the search; confirm the two date-sort options remain selectable too.
7. Clear the search box and confirm the select reverts to "新しい順" and the relevance option disappears.
8. Reload the dashboard page entirely and confirm the previously selected sort (from step 5, "古い順") is still applied on the initial load.
9. Combine sort with a date-range preset button (e.g. "過去7日間") and confirm both filters apply together correctly.
10. If your history has more than 5000 tagged entries: click a tag badge to activate the tag filter, switch sort to "古い順", and check whether recently-tagged entries you expect to see are missing (see the "Known limitation" note in Task 2 — this is an accepted, documented gap in this PBI, not a bug to fix here, but confirm it behaves as documented rather than crashing or returning wrong data silently).
11. Click a tag badge to activate the tag filter (a tag with matches, so no fallback triggers) and confirm "関連度順" does NOT appear in the sort options while the tag filter is active — only "新しい順"/"古い順" should be selectable, since no full-text search is running.
12. If you have a tag with zero direct matches that triggers the tag-fallback full-text search (the fallback notice banner appears), confirm "関連度順" DOES appear as an option in that state, since a real FTS5 search is running underneath the tag fallback.

- [ ] **Step 4: Report results**

No commit for this task — it is verification only. If any manual check fails, return to the relevant task above and fix before proceeding.

---

## Self-Review Notes

- **Spec coverage:** Sort dropdown (Tasks 1, 2, 10) ✓; relevance-only-during-search (Tasks 1, 10) ✓; persistence to chrome.storage.local (Tasks 9, 10) ✓; existing date-preset buttons left untouched (no task modifies `renderCalendarNav`'s button markup) ✓; all three backends covered (Tasks 6, 7, 8) ✓.
- **Type consistency:** `sortBy: 'created_at' | 'relevance'`, `sortDir: 'ASC' | 'DESC'` used identically across Tasks 1, 2, 3, 4, 5, 6, 7, 8, 10. The wire-level `orderBy: 'rank' | 'created_at'` (used only from Task 2 downstream through the backends) is a distinct but related type — `sortBy: 'relevance'` maps to `orderBy: 'rank'`, `sortBy: 'created_at'` maps to `orderBy: 'created_at'`; this mapping is made explicit in Task 2 Step 3 and consistent thereafter.
- **No placeholders:** All code blocks contain complete, concrete implementations. Where a task step depends on inspecting existing code first (Tasks 4, 6, 7, 8, 10), the step includes the exact `grep`/`find` command to run and explains how to adapt the shown code to what's found — this is necessary because the exact current shape of `DashboardSqliteHandlerDeps`, `IdbVfsBackend`'s constructor, and existing test mocking conventions could not be fully confirmed from static reading and must be verified live during implementation.

### Adversarial review findings (2026-08-15), addressed inline above

- **Task 1 — `search` action only handled the clear direction.** The original reducer logic only reset `relevance` → `created_at` when a query was cleared; it never switched `created_at` → `relevance` when a search *started*, contradicting the PBI's "becomes the default when a search starts" scenario. Fixed by adding the `startingSearch` branch (empty→non-empty transition only, so it doesn't override a sort chosen mid-search) and three new test cases covering start / refine-with-created_at / refine-with-relevance.
- **Task 2 — tag-filter + `TAG_FILTER_FETCH_LIMIT` + sort direction interaction was unaddressed.** Making `orderDir` user-controlled on the tag-filter over-fetch query silently changes what the 5000-row cap means: previously a stable "most recent 5000, tag-filtered" limitation, it becomes "oldest 5000" under an ASC sort, making recently-tagged entries vanish from that view — a new failure mode this plan did not originally flag. Not fixed (would require a larger change to the tag-filter fetch strategy, out of scope for this PBI); instead documented as a known limitation with an explicit code comment, a test asserting `orderDir` is forwarded (not hardcoded), and a manual-verification checklist item (Task 11, item 10) so it surfaces as expected behavior rather than a surprise bug report.
- **Not fixed, tracked as pre-existing/out-of-scope:** `sqliteHistoryPanel.ts` has two separate, hand-duplicated implementations of the calendar nav's `onRangeSelect`/`onClearFilters` callbacks (`renderState` and `updateDynamicRegions`), one of which bypasses the reducer entirely with direct `state.x = ...` mutation. This plan's Task 10 only wires `renderSortControl` into both existing call sites without touching this duplication — deeper unification is a separate refactor, not part of this PBI's scope.

### Second-pass findings (2026-08-16, root-cause "why" analysis on the first-pass fixes), addressed inline above

- **Task 10 — `hasActiveSearch` conflated "search box has text" with "an FTS5 search is actually running."** `state.searchQuery` is set to the tag name as a display label by the `tagInitiated` action / `onActivate`'s `searchTag` branch, but `fetchData` never passes `search` in that path — only `tagFilter` — so `queryHistory` takes the non-search `queryLogs` branch where `orderBy` is hardcoded to `created_at` (Task 2) and `sortBy: 'relevance'` has no effect. The original `Boolean(state.searchQuery.trim())` condition would show "関連度順" as a selectable option in this state even though selecting it changes nothing — a silently-broken UI control. A naive fix ("hide relevance whenever `activeTagFilter` is set") would introduce the opposite bug: when a tag filter matches nothing and falls back to full-text search (`pendingTagFallback` set), a real FTS5 search *is* running while `activeTagFilter` is still non-null, so relevance must still be offered there. Fixed by replacing the boolean expression with an `isFullTextSearchActive(state)` helper that accounts for both cases, plus two new UI test cases (tag-active-without-fallback hides relevance; tag-fallback-active shows it).
- **Scope boundary confirmed, not changed:** editing the search box while a tag filter is active (`state.searchQuery` starts as the tag-label string, non-empty) does not trigger the `startingSearch`→`relevance` auto-switch, because the reducer only checks "was `searchQuery` empty before." This is left as existing tag-filter/search-box coupling behavior — introducing a scenario for "user edits the search box while a tag filter is active" would require redesigning what `searchQuery` means when a tag filter is active (it currently serves double duty as both a label and, later, a fallback search term), which is a larger pre-existing design question this PBI does not take on.
