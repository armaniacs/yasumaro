# Design: sqliteClient.call() Error Propagation

**Date:** 2026-07-13
**PBI:** [2026-07-13-04-fix-sqlite-client-error-propagation](../pbi/2026-07-13-04-fix-sqlite-client-error-propagation.md)
**Status:** Draft

---

## Architecture Overview

### Current State (Problem)

`SqliteClient.call()` returns `T | null`. All failure modes (timeout, offscreen document lost, disk I/O error, quota exceeded, schema corruption) are collapsed into `null`. Callers cannot distinguish transient errors from permanent ones.

```ts
// Before
private async call<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    // ... acquire mutex, ensure offscreen, execute fn ...
    return await fn();
  } catch (error) {
    logError(...);
    return null; // All errors vanish here
  }
}
```

Every caller in `SqliteClient` (query, search, insert, update, delete, toggleStar, migrate, etc.) and every caller in `dashboardSqliteService.ts` (queryLogs, searchLogs, toggleStar, deleteLog, etc.) sees only `null`.

### Target State

Change `call()` to return structured results. Callers can inspect `result.error` for actionable messages.

```ts
// After
type CallResult<T> = { success: true; data: T } | { success: false; error: string };

private async call<T>(fn: () => Promise<T>): Promise<CallResult<T>> {
  try {
    // ... acquire mutex, ensure offscreen, execute fn ...
    const data = await fn();
    return { success: true, data };
  } catch (error) {
    const message = categorizeError(error);
    logError(...); // still logs full details
    return { success: false, error: message };
  }
}
```

---

## Error Categorization

```ts
function categorizeError(error: unknown): string {
  const msg = errorMessage(error);

  if (msg.includes('timed out') || msg.includes('Timeout')) {
    return `SQLite request timed out. The database may still be initializing. Retrying...`;
  }
  if (msg.includes('offscreen') || msg.includes('offscreenDocument')) {
    return `Database connection lost. Please reload the extension.`;
  }
  if (msg.includes('quota') || msg.includes('QuotaExceededError')) {
    return `Storage quota exceeded. Some older records have been removed to free space.`;
  }
  if (msg.includes('SQLITE_') || msg.includes('disk I/O')) {
    return `Database error: ${msg}`;
  }
  return `Unexpected error: ${msg}`;
}
```

---

## Caller Changes

### SqliteClient methods

```ts
// Before
async query(options: QueryOptions): Promise<QueryResult | null> {
  return this.call(async () => { ... });
}

// After
async query(options: QueryOptions): Promise<QueryResult | null> {
  const result = await this.call(async () => { ... });
  if (!result.success) {
    this.lastError = result.error;
    return null; // Callers that expect null still work
  }
  return result.data;
}
```

Note: `SqliteClient` still returns `null` to the SW handler — the SW handler extracts error info from `this.lastError` when constructing the response.

### dashboardSqliteService.ts

```ts
// Before
const response = await sendDashboardMessage({ subtype: 'query', ...options });
if (response.success) return { rows: response.rows, total: response.total };
return null;

// After
const response = await sendDashboardMessage({ subtype: 'query', ...options });
if (response.success) return { rows: response.rows, total: response.total };
console.warn('queryLogs failed:', response.error); // Now actionable
return null;
```

### sqliteHistoryPanel.ts

```ts
// Before
state.error = t('historyLoadError');
// After
state.error = result.error || t('historyLoadError'); // Specific message when available
```

---

## DashboardSqliteProtocol Changes

The protocol's `DashboardSqliteFailure` already defines `{ success: false; error: string }`. The SW handler (`dashboardSqliteHandlers.ts`) needs to propagate `SqliteClient.lastError` into this field:

```ts
// In dashboardSqliteHandlers.ts
case 'query': {
  const result = await sqliteClient.query(payload);
  if (result === null) {
    const error = sqliteClient.lastError || 'Query failed';
    sendResponse({ success: false, error });
    return;
  }
  sendResponse({ success: true, rows: result.rows, total: result.total });
}
```

---

## Dependencies

- **Blocks**: Nothing
- **Blocked by**: None
- **Parallel with**: All other PBIs
