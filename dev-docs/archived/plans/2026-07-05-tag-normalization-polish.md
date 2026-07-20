# Tag Normalization Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the tag normalization feature by adding i18n messages, FTS5 server-side tag filter, and CSS styling.

**Architecture:** Three independent work items: (1) JSON-only i18n message additions to both locale files, (2) FTS5 tag filter via adding `tagFilter` to `QueryOptions` and propagating through the message-passing chain to offscreen SQL, (3) CSS class additions to `dashboard.css`.

**Tech Stack:** TypeScript, Manifest V3, FTS5, WXT

---

### Task 1: Add i18n Messages (ja)

**Files:**
- Modify: `public/_locales/ja/messages.json` (append before last `}`)

- [ ] **Step 1: Append 9 Japanese message definitions**

Insert these entries before the closing `}` on the last line:

```json
,
  "tagFilterLabel": {
    "message": "フィルター:"
  },
  "clearTagFilter": {
    "message": "クリア"
  },
  "noNormEntries": {
    "message": "ルールがありません"
  },
  "normEntriesTitle": {
    "message": "正規化ルール"
  },
  "tagNormalizationTitle": {
    "message": "タグ正規化"
  },
  "tagNormalizationDesc": {
    "message": "記録時に類似タグを自動的に正規化します（例: 「人工知能」→「AI」）。以下でルールを設定してください。"
  },
  "normFromPlaceholder": {
    "message": "元のタグ"
  },
  "normToPlaceholder": {
    "message": "正規化後のタグ"
  },
  "duplicateNormEntryError": {
    "message": "このFrom値は既に登録されています"
  }
```

- [ ] **Step 2: Verify JSON is valid**

Run: `python3 -m json.tool public/_locales/ja/messages.json > /dev/null && echo "valid" || echo "invalid"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add public/_locales/ja/messages.json
git commit -m "feat(i18n): add Japanese messages for tag normalization UI"
```

---

### Task 2: Add i18n Messages (en)

**Files:**
- Modify: `public/_locales/en/messages.json` (append before last `}`)

- [ ] **Step 1: Append 9 English message definitions**

Insert these entries before the closing `}` on the last line:

```json
,
  "tagFilterLabel": {
    "message": "Filter:"
  },
  "clearTagFilter": {
    "message": "Clear"
  },
  "noNormEntries": {
    "message": "No rules configured"
  },
  "normEntriesTitle": {
    "message": "Normalization Rules"
  },
  "tagNormalizationTitle": {
    "message": "Tag Normalization"
  },
  "tagNormalizationDesc": {
    "message": "Automatically normalize similar tags (e.g., \"Artificial Intelligence\" → \"AI\") when recording pages. Configure rules below."
  },
  "normFromPlaceholder": {
    "message": "Original tag"
  },
  "normToPlaceholder": {
    "message": "Normalized tag"
  },
  "duplicateNormEntryError": {
    "message": "This value is already registered"
  }
```

- [ ] **Step 2: Verify JSON is valid**

Run: `python3 -m json.tool public/_locales/en/messages.json > /dev/null && echo "valid" || echo "invalid"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add public/_locales/en/messages.json
git commit -m "feat(i18n): add English messages for tag normalization UI"
```

---

### Task 3: Add tagFilter to Type Definitions

**Files:**
- Modify: `src/utils/sqlite-types.ts` — add `tagFilter` to `QueryOptions`
- Modify: `src/offscreen/opfsWorker.ts` — add `tagFilter` to `QueryPayload`

- [ ] **Step 1: Add tagFilter to QueryOptions**

In `src/utils/sqlite-types.ts`, add `tagFilter` to the `QueryOptions` interface:

```typescript
export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
  domain?: string;
  isStarred?: boolean;
  excludeDeleted?: boolean;
  since?: number;
  until?: number;
  ids?: number[];
  tagFilter?: string;  // NEW: filter by tag name (without # prefix)
}
```

- [ ] **Step 2: Add tagFilter to QueryPayload**

In `src/offscreen/opfsWorker.ts`, add `tagFilter` to the `QueryPayload` interface:

```typescript
interface QueryPayload {
  limit?: number;
  offset?: number;
  since?: number;
  until?: number;
  domain?: string;
  isStarred?: boolean;
  orderBy?: string;
  orderDir?: string;
  ids?: number[];
  tagFilter?: string;  // NEW
}
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/sqlite-types.ts src/offscreen/opfsWorker.ts
git commit -m "feat: add tagFilter to QueryOptions and QueryPayload types"
```

---

### Task 4: Implement FTS5 Tag Filter in Offscreen SQL (OPFS)

**Files:**
- Modify: `src/offscreen/opfsWorker.ts` (around lines 289-346, in `handleQuery`)

- [ ] **Step 1: Add `tagFilter` destructuring and FTS5 condition**

In `handleQuery()`, add `tagFilter` to the destructuring, and add the FTS5 condition block. The `sanitizeFtsTerm()` function already exists at line 113.

```typescript
async function handleQuery(payload: QueryPayload): Promise<{ rows: BrowsingLogRecord[]; total: number }> {
  const {
    limit = 20, offset = 0, since, until, domain,
    isStarred, orderBy = 'created_at', orderDir = 'DESC', ids,
    tagFilter,  // NEW
  } = payload;

  // ... existing code ...

  const conditions: string[] = ['is_deleted = 0'];
  const params: SqliteValue[] = [];

  // ... existing conditions ...

  // NEW: FTS5 tag filter
  if (tagFilter) {
    const ftsQuery = `"#${sanitizeFtsTerm(tagFilter)}"`;
    conditions.push(`id IN (SELECT rowid FROM browsing_logs_fts WHERE tags MATCH ?)`);
    params.push(ftsQuery);
  }

  // ... rest remains the same ...
}
```

The `sanitizeFtsTerm` function (line 113) strips FTS5 special characters. We use `"#tagName"` wrapped in quotes for exact phrase match with the trigram tokenizer.

- [ ] **Step 2: Commit**

```bash
git add src/offscreen/opfsWorker.ts
git commit -m "feat: implement FTS5 tag filter in OPFS query handler"
```

---

### Task 5: Implement FTS5 Tag Filter in Offscreen SQL (IDB)

**Files:**
- Modify: `src/offscreen/sqlite.ts` (around lines 626-652, in `query()`)

- [ ] **Step 1: Add FTS5 condition block**

Add after the `ids` condition (around line 652):

```typescript
    // FTS5 tag filter
    if (options.tagFilter) {
      // Reuse existing sanitizeFtsTerm() (defined at line ~1220 in this module)
      const sanitized = sanitizeFtsTerm(`"#${options.tagFilter}"`);
      conditions.push(`id IN (SELECT rowid FROM browsing_logs_fts WHERE tags MATCH ?)`);
      params.push(sanitized);
    }
```

The tagFilter value is the raw tag name (no `#` prefix, e.g., `"AI"`). The FTS5 match expression wraps it as `"#AI"` — `#` prefix matches the stored format, quotes ensure exact phrase match.

- [ ] **Step 2: Commit**

```bash
git add src/offscreen/sqlite.ts
git commit -m "feat: implement FTS5 tag filter in IDB query handler"
```

---

### Task 6: Forward tagFilter Through the Message Chain

**Files:**
- Modify: `src/offscreen/sqlite.ts` — pass `tagFilter` to OPFS proxy and IDB call
- Modify: `src/dashboard/dashboardSqliteService.ts` — accept `tagFilter` in `queryLogs()`
- Modify: `src/background/handlers/dashboardSqliteHandlers.ts` — forward `tagFilter` to `sqliteClient.query()`

- [ ] **Step 1: Forward tagFilter in sqlite.ts proxy**

In `src/offscreen/sqlite.ts:query()` (~line 607), add `tagFilter` to the OPFS proxy payload:

```typescript
    const opfsResult = await tryOpfsProxy<{ ... }>('QUERY', {
      limit: options.limit, offset: options.offset, since: options.since, until: options.until,
      domain: options.domain, isStarred: options.isStarred, orderBy: options.orderBy, orderDir: options.orderDir,
      ids: options.ids,
      tagFilter: options.tagFilter,  // NEW
    });
```

- [ ] **Step 2: Accept tagFilter in dashboardSqliteService.queryLogs()**

In `src/dashboard/dashboardSqliteService.ts`, modify the `queryLogs` options parameter to include `tagFilter`:

```typescript
export async function queryLogs(options: {
  limit?: number;
  offset?: number;
  domain?: string;
  isStarred?: boolean;
  since?: number;
  until?: number;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
  tagFilter?: string;  // NEW
} = {}): Promise<{ rows: BrowsingLogEntry[]; total: number } | null> {
```

The function body already spreads `...options` into the payload, so `tagFilter` passes through automatically.

- [ ] **Step 3: Forward tagFilter in dashboardSqliteHandlers.ts**

In `src/background/handlers/dashboardSqliteHandlers.ts`, `case 'query'` block (~line 50), add `tagFilter`:

```typescript
            case 'query': {
                const result = await sqliteClient.query({
                    limit: (payload.limit as number) ?? 100,
                    offset: (payload.offset as number) ?? 0,
                    domain: payload.domain as string | undefined,
                    isStarred: payload.isStarred as boolean | undefined,
                    since: payload.since as number | undefined,
                    until: payload.until as number | undefined,
                    orderBy: (payload.orderBy as string) || 'created_at',
                    orderDir: (payload.orderDir as 'ASC' | 'DESC') || 'DESC',
                    tagFilter: payload.tagFilter as string | undefined,  // NEW
                });
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: no output (clean)

- [ ] **Step 5: Commit**

```bash
git add src/offscreen/sqlite.ts src/dashboard/dashboardSqliteService.ts src/background/handlers/dashboardSqliteHandlers.ts
git commit -m "feat: forward tagFilter through message chain"
```

---

### Task 7: Rewrite Tag Filter in SQLite History Panel (Server-Side)

**Files:**
- Modify: `src/dashboard/sqliteHistoryPanel.ts`

- [ ] **Step 1: Update `loadData()` to pass `tagFilter`**

Find the `loadData()` function. It currently accepts `options.search`, `options.since`, `options.until`. Add a new parameter. The function signature should accept `tagFilter` in the options object. Pass it to `queryLogs()`:

```typescript
async function loadData(options: {
  page?: number;
  search?: string;
  since?: number;
  until?: number;
  tagFilter?: string;  // NEW
} = {}): Promise<void> {
```

In the `queryLogs` call branch (when `!options.search`), pass `tagFilter:

```typescript
    result = await queryLogs({
      limit: PAGE_SIZE,
      offset: options.page !== undefined ? options.page * PAGE_SIZE : state.currentPage * PAGE_SIZE,
      since: options.since,
      until: options.until,
      tagFilter: options.tagFilter || state.activeTagFilter || undefined,  // NEW
    });
```

When search is active, use the existing `searchLogs` path — tagFilter doesn't apply in search mode (FTS5 search already covers tags).

- [ ] **Step 2: Update tag badge click handler to call `loadData({ tagFilter })`**

Replace the client-side filter logic in the tag badge click handler with a server-side load:

```typescript
  // Wire tag filter buttons — server-side via loadData
  listEl.querySelectorAll('[data-action="tag-filter"]').forEach((el) => {
    el.addEventListener('click', () => {
      const tag = (el as HTMLElement).getAttribute('data-tag');
      if (!tag) return;
      // Toggle: if already filtering by this tag, clear; otherwise set
      state.activeTagFilter = state.activeTagFilter === tag ? null : tag;
      state.currentPage = 0;
      loadData({ page: 0, tagFilter: state.activeTagFilter || undefined });
    });
  });
```

- [ ] **Step 3: Update `updateTagFilterBar()` to work with server-side filter**

The `updateTagFilterBar()` function already manages the filter bar DOM. No changes needed — `state.activeTagFilter` is still the source of truth for the bar visibility. The clear button handler should call `loadData({ tagFilter: undefined })`:

```typescript
      const clearBtn = bar.querySelector('#sqlite-tag-filter-clear') as HTMLButtonElement | null;
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          state.activeTagFilter = null;
          state.currentPage = 0;
          loadData({ page: 0 });
        });
      }
```

- [ ] **Step 4: Remove client-side filter from `renderEntryList()`**

In `renderEntryList()`, remove the `displayEntries` filter block (lines 463-469) that used `state.activeTagFilter` to client-side filter `state.entries`. The server now returns only matching entries:

```typescript
  // Remove this entire block:
  // const displayEntries = state.activeTagFilter
  //   ? state.entries.filter(entry => { ... })
  //   : state.entries;

  // Use state.entries directly:
  const displayEntries = state.entries;
```

Keep the rest of `renderEntryList()` unchanged — it already uses `state.activeTagFilter` for badge highlighting (`.filter-active` class) and `displayEntries` for iteration.

- [ ] **Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: no output (clean)

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/dashboard/__tests__/sqliteHistoryPanel.test.ts src/dashboard/__tests__/sqliteHistoryPanel-selection-ui.test.ts`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/sqliteHistoryPanel.ts
git commit -m "feat: replace client-side tag filter with server-side FTS5"
```

---

### Task 8: Add CSS Styling

**Files:**
- Modify: `entrypoints/options/dashboard.css` (append before file end)

- [ ] **Step 1: Add tag display styles for SQLite entries**

Find the `.sqlite-entry-summary` block ending around line 3479. After it, add:

```css
/* ── Tag badges in SQLite entries ── */
.sqlite-entry-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-top: var(--space-1);
  padding: 0 12px 8px;
}
```

- [ ] **Step 2: Add tag filter bar styles**

```css
/* ── Tag filter bar ── */
.sqlite-tag-filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  margin-top: 4px;
  background: var(--color-primary-bg);
  border: 1px solid var(--color-primary-border);
  border-radius: var(--radius-sm);
  font-size: 13px;
}

.tag-filter-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 600;
  color: #6b21a8;
  background: var(--color-primary-bg);
  border: 1px solid var(--color-primary-border);
}

.tag-filter-clear {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--color-text-muted);
  padding: 0 4px;
  line-height: 1;
}
.tag-filter-clear:hover {
  color: var(--color-danger);
}
```

- [ ] **Step 3: Add normalization dictionary UI styles**

```css
/* ── Tag normalization dictionary UI ── */
.norm-entries-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.norm-entry-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.norm-entry-label {
  font-size: 13px;
  color: var(--color-text);
}

.norm-entry-delete {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  color: var(--color-text-muted);
  padding: 2px 6px;
  line-height: 1;
}
.norm-entry-delete:hover {
  color: var(--color-danger);
}

.norm-arrow {
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  color: var(--color-text-muted);
  font-size: 14px;
  user-select: none;
}
```

- [ ] **Step 4: Add dark mode for tag-filter-badge**

Find the existing `prefers-color-scheme: dark` media query that styles `.tag-badge` (around line 2423). Add `.tag-filter-badge` to the same block:

```css
@media (prefers-color-scheme: dark) {
  .tag-badge,
  .tag-filter-badge {
    color: #e9d5ff !important;
    background: #1a1025 !important;
    border-color: #6b21a8 !important;
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add entrypoints/options/dashboard.css
git commit -m "feat: add CSS for tag filter bar and normalization dictionary UI"
```

---

### Task 9: Run Full Test Suite

- [ ] **Step 1: Run all relevant tests**

Run: `npx vitest run src/utils/__tests__/tagUtils.test.ts src/background/__tests__/privacyPipeline.test.ts src/dashboard/__tests__/sqliteHistoryPanel.test.ts src/dashboard/__tests__/sqliteHistoryPanel-selection-ui.test.ts src/background/__tests__/dashboardSqliteHandlers.test.ts`
Expected: All tests pass

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: no output (clean)

- [ ] **Step 3: Final commit if fixes needed**

```bash
git add -A
git commit -m "chore: fix type/test issues after tag normalization polish"
```
