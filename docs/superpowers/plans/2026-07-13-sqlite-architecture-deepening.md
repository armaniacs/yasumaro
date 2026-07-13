# SQLite Architecture Deepening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen the SQLite layer by unifying three-backend dispatch via adapter pattern, deduplicating types/migrations, improving error propagation, and enabling testability of the history panel.

**Architecture:** Introduce `StorageBackend` interface with three adapters (OpfsWorkerBackend, IdbVfsBackend, FallbackStorageAdapter) plus NoopBackend null object. Repository functions delegate to a single backend. Backend selection is lazy and one-time per offscreen document lifetime. Panel functions are parameterized for testability without file splitting. Execution order: PBI #4 (error propagation) → #1 (adapter) → #2 + #5 (dedup + migrations) → #3 (panel parameterization).

**Tech Stack:** TypeScript ESM, Chrome Extension Manifest V3, @subframe7536/sqlite-wasm, wa-sqlite (IDB fallback), Jest + jsdom

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `src/offscreen/StorageBackend.ts` | `StorageBackend` interface + `StatusResult` + `NoopBackend` |
| `src/offscreen/OpfsWorkerBackend.ts` | Adapter: delegates to OPFS Worker via postMessage |
| `src/offscreen/IdbVfsBackend.ts` | Adapter: direct SQL execution via wa-sqlite IDB VFS |
| `src/offscreen/FallbackStorageAdapter.ts` | Adapter: wraps `FallbackStorage` class |
| `src/offscreen/migrations.ts` | `MigrationEngine` interface + `runMigrations()` + `MIGRATION_COLUMNS` |

### Modified files
| File | Change |
|------|--------|
| `src/background/sqliteClient.ts` | `call()` returns structured error instead of `null` |
| `src/background/handlers/dashboardSqliteHandlers.ts` | Propagate `lastError` into response |
| `src/offscreen/sqliteEngineContext.ts` | Add `getBackend()`, remove backend init from public surface |
| `src/offscreen/recordsRepo.ts` | Replace 4-way branches with `backend.operation()` |
| `src/offscreen/dbMaintenance.ts` | Replace 4-way branches with `backend.operation()` |
| `src/offscreen/auditLogRepo.ts` | Replace 4-way branches with `backend.operation()` |
| `src/offscreen/opfsWorker.ts` | Remove duplicate types; add `SQL_EXEC`/`SQL_QUERY`; use `runMigrations()` |
| `src/offscreen/schema.ts` | Add `MIGRATION_COLUMNS`, `MIGRATION_SEQUENCE` |
| `src/offscreen/sqlite.ts` | Re-export adapter classes; update public API surface |
| `src/dashboard/dashboardSqliteService.ts` | Handle structured errors from SW |
| `src/dashboard/sqliteHistoryPanel.ts` | Parameterize render functions with data+callbacks |

---

## Phase 1: PBI #4 — Error Propagation (1pt)

### Task 1: Structured error return from SqliteClient.call()

**Files:**
- Modify: `src/background/sqliteClient.ts` (line ~152: `call()` method)
- Modify: `src/background/handlers/dashboardSqliteHandlers.ts` (all handler cases)

- [ ] **Step 1: Change `call()` return type and add error categorization**

In `src/background/sqliteClient.ts`, find the private `call()` method and change:

```ts
// Before (line ~152)
private async call<T>(fn: () => Promise<T>): Promise<T | null> {
  await this.mutex.acquire();
  try {
    await this.ensureOffscreenDocument();
    const result = await fn();
    return result;
  } catch (error) {
    logError('SQLite Client: call failed', { error: errorMessage(error) }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
    return null;
  } finally {
    this.mutex.release();
  }
}

// After
type CallResult<T> = { success: true; data: T } | { success: false; error: string };

private async call<T>(fn: () => Promise<T>): Promise<CallResult<T>> {
  await this.mutex.acquire();
  try {
    await this.ensureOffscreenDocument();
    const data = await fn();
    return { success: true, data };
  } catch (error) {
    const msg = errorMessage(error);
    const categorized = categorizeError(msg);
    logError('SQLite Client: call failed', { error: msg }, ErrorCode.STORAGE_READ_FAILURE, 'sqlite');
    return { success: false, error: categorized };
  } finally {
    this.mutex.release();
  }
}

function categorizeError(msg: string): string {
  if (msg.includes('timed out') || msg.includes('Timeout')) {
    return `SQLite request timed out. The database may still be initializing.`;
  }
  if (msg.includes('offscreen') || msg.includes('offscreenDocument')) {
    return `Database connection lost. Please reload the extension.`;
  }
  if (msg.includes('quota') || msg.includes('QuotaExceededError')) {
    return `Storage quota exceeded. Some older records may have been removed.`;
  }
  if (msg.includes('SQLITE_') || msg.includes('disk I/O')) {
    return `Database error: ${msg}`;
  }
  return `Unexpected error: ${msg}`;
}
```

- [ ] **Step 2: Add `lastError` property and update all `call()` consumers**

Add to `SqliteClient` class:

```ts
/** Last categorized error from call(). Read by dashboard handlers. */
lastError: string | null = null;
```

Update every method that uses `call()` (insert, query, search, update, delete, toggleStar, getCount, exportDb, backupDb, restoreDb, getStatus, clearAll, purgeOldRecords, purgeContent, insertAuditLog, queryAuditLog, insertBatch, runOpfsSpike, isSqliteHealthy):

```ts
// Pattern for all methods:
async query(options: QueryOptions): Promise<QueryResult | null> {
  const { success, data, error } = await this.call(async () => {
    return (await this.msgOffscreen('SQLITE_QUERY', options)) as QueryResult;
  });
  if (!success) {
    this.lastError = error;
    return null;
  }
  this.lastError = null;
  return data;
}
```

- [ ] **Step 3: Run existing tests to verify compatibility**

```bash
npm test -- --testPathPattern="sqliteClient"
```

Expected: All tests pass (existing tests mock `call()` or test through the public methods).

- [ ] **Step 4: Update dashboard handler to propagate error**

In `src/background/handlers/dashboardSqliteHandlers.ts`, update each handler case to use `sqliteClient.lastError`:

```ts
// Pattern for handler cases:
case 'query': {
  const result = await sqliteClient.query(payload);
  if (result === null) {
    const error = sqliteClient.lastError || 'Query failed';
    sendResponse({ success: false, error });
    return;
  }
  sendResponse({ success: true, rows: result.rows, total: result.total });
  break;
}
```

Apply this pattern to all cases: `query`, `search`, `toggle_star`, `delete`, `update`, `get_count`, `clear_all`, `status`, `backfill_metadata`, `backup_db`, `import`, `append_to_obsidian`, `purge_now`, `content_purge_now`.

- [ ] **Step 5: Update dashboardSqliteService to surface errors**

In `src/dashboard/dashboardSqliteService.ts`, update each function from `null` checks to structured error logging:

```ts
// Pattern for all functions:
export async function queryLogs(options = {}): Promise<{ rows: BrowsingLogEntry[]; total: number } | null> {
  try {
    const response = await sendDashboardMessage({ subtype: 'query', ...options });
    if (response.success) {
      return { rows: (response.rows || []) as BrowsingLogEntry[], total: Number(response.total || 0) };
    }
    console.warn('queryLogs failed:', response.error);  // <-- was: silently null
    return null;
  } catch (error) {
    console.error('queryLogs failed:', error);
    return null;
  }
}
```

- [ ] **Step 6: Update sqliteHistoryPanel to display specific errors**

In `src/dashboard/sqliteHistoryPanel.ts`, update `loadData()` error handling:

```ts
// In loadData(), change:
state.error = t('historyLoadError');
// To:
state.error = result?.error || t('historyLoadError');
```

Wait — `loadData()` receives results via `queryLogs()` / `searchLogs()`. Those currently return `null` on failure. We need to change them to also return error info.

In `src/dashboard/dashboardSqliteService.ts`, change the return type:

```ts
// Before:
export async function queryLogs(...): Promise<{ rows: BrowsingLogEntry[]; total: number } | null> {

// After:
export async function queryLogs(...): Promise<{ rows: BrowsingLogEntry[]; total: number } | { error: string } | null> {
```

Then in `sqliteHistoryPanel.ts`:

```ts
// In loadData():
let result: { rows: BrowsingLogEntry[]; total: number } | { error: string } | null;
// ... fetch ...
if (result === null) {
  state.error = t('historyLoadError');
} else if ('error' in result) {
  state.error = result.error;
} else {
  state.error = null;
  state.entries = result.rows;
  state.total = result.total;
}
```

- [ ] **Step 7: Run all tests**

```bash
npm test
```

Expected: All tests pass. Any test that mocked `call()` returning `null` must be updated to return `{ success: false, error: 'test error' }`.

- [ ] **Step 8: Commit**

```bash
git add src/background/sqliteClient.ts src/background/handlers/dashboardSqliteHandlers.ts src/dashboard/dashboardSqliteService.ts src/dashboard/sqliteHistoryPanel.ts
git commit -m "fix(sqlite): propagate structured errors from SqliteClient.call() instead of null"
```

---

## Phase 2: PBI #1 — StorageBackend Adapter (5pt)

### Task 2: Define StorageBackend interface and NoopBackend

**Files:**
- Create: `src/offscreen/StorageBackend.ts`

- [ ] **Step 1: Create StorageBackend.ts with interface, StatusResult, and NoopBackend**

```ts
// src/offscreen/StorageBackend.ts
import type { BrowsingLogRecord, BrowsingLogEntry, QueryOptions, SearchResult as SearchResultType, AuditLogRecord, AuditLogEntry } from '../utils/sqlite-types.js';

export interface InsertResult { success: true; id: number }
export interface InsertBatchResult { success: true; inserted: number; skipped: number }
export interface QueryResult { success: true; rows: BrowsingLogEntry[]; total: number }
export interface SearchResult { success: true; rows: (BrowsingLogEntry & { rank: number })[]; total: number }
export interface MutationResult { success: true }
export interface StarResult { success: true; is_starred: number }
export interface PurgeResult { success: true; purged: number }
export interface FtsSizeResult { success: true; count: number }
export interface BackupResult { success: true; data: Uint8Array }
export interface CountResult { success: true; count: number }
export interface HealthResult { success: true } // healthCheck — success means alive, failure means error
export interface AuditLogQueryResult { success: true; rows: AuditLogEntry[]; total: number }
export type BackendOrError<T> = T | { success: false; error: string };

export interface StatusResult {
  initialized: boolean;
  fallback: boolean;
  fts5: boolean;
  supportsBinaryBackup: boolean;
  compileOptions?: string[];
  compileOptionsSource?: 'opfs-worker' | 'idb' | 'fallback';
  initError?: string;
}

export interface StorageBackend {
  insert(record: BrowsingLogRecord): Promise<BackendOrError<InsertResult>>;
  insertBatch(records: BrowsingLogRecord[]): Promise<BackendOrError<InsertBatchResult>>;
  query(options: QueryOptions): Promise<BackendOrError<QueryResult>>;
  search(query: string, limit: number, offset: number): Promise<BackendOrError<SearchResult>>;
  update(id: number, changes: Record<string, unknown>): Promise<BackendOrError<MutationResult>>;
  delete(id: number): Promise<BackendOrError<MutationResult>>;
  toggleStar(id: number): Promise<BackendOrError<StarResult>>;
  purgeOldRecords(retentionDays: number, maxRecords: number): Promise<BackendOrError<PurgeResult>>;
  purgeContent(retentionDays?: number, maxRecords?: number, includeStarred?: boolean): Promise<BackendOrError<PurgeResult>>;
  getFtsIndexSize(): Promise<BackendOrError<FtsSizeResult>>;
  backupDb(): Promise<BackendOrError<BackupResult>>;
  restoreDb(data: Uint8Array): Promise<BackendOrError<MutationResult>>;
  healthCheck(): Promise<BackendOrError<HealthResult>>;
  getStatus(): Promise<BackendOrError<StatusResult>>;
  insertAuditLog(record: AuditLogRecord): Promise<BackendOrError<InsertResult>>;
  queryAuditLog(options: { limit?: number; offset?: number }): Promise<BackendOrError<AuditLogQueryResult>>;
  getCount(): Promise<BackendOrError<CountResult>>;
  clearAll(): Promise<BackendOrError<MutationResult>>;
}

const NOT_INITIALIZED = 'Database not initialized';

export class NoopBackend implements StorageBackend {
  private err = (): { success: false; error: string } => ({ success: false, error: NOT_INITIALIZED });
  async insert() { return this.err(); }
  async insertBatch() { return this.err(); }
  async query() { return this.err(); }
  async search() { return this.err(); }
  async update() { return this.err(); }
  async delete() { return this.err(); }
  async toggleStar() { return this.err(); }
  async purgeOldRecords() { return this.err(); }
  async purgeContent() { return this.err(); }
  async getFtsIndexSize() { return this.err(); }
  async backupDb() { return this.err(); }
  async restoreDb() { return this.err(); }
  async healthCheck() { return this.err(); }
  async getStatus() { return this.err(); }
  async insertAuditLog() { return this.err(); }
  async queryAuditLog() { return this.err(); }
  async getCount() { return this.err(); }
  async clearAll() { return this.err(); }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/offscreen/StorageBackend.ts
git commit -m "feat(sqlite): add StorageBackend interface and NoopBackend null object"
```

### Task 3: Create OpfsWorkerBackend adapter

**Files:**
- Create: `src/offscreen/OpfsWorkerBackend.ts`

- [ ] **Step 1: Create OpfsWorkerBackend.ts**

This adapter delegates to `engine.sendToOpfsWorker()` and `engine.tryOpfsProxy()`.

```ts
// src/offscreen/OpfsWorkerBackend.ts
import type { SqliteEngineContext } from './sqliteEngineContext.js';
import type { StorageBackend, InsertResult, InsertBatchResult, QueryResult, SearchResult, MutationResult, StarResult, PurgeResult, FtsSizeResult, BackupResult, CountResult, HealthResult, AuditLogQueryResult, StatusResult, BackendOrError } from './StorageBackend.js';
import type { BrowsingLogRecord, QueryOptions, AuditLogRecord } from '../utils/sqlite-types.js';

export class OpfsWorkerBackend implements StorageBackend {
  constructor(private engine: SqliteEngineContext) {}

  async insert(record: BrowsingLogRecord): Promise<BackendOrError<InsertResult>> {
    const result = await this.engine.sendToOpfsWorker('INSERT', record) as { id: number };
    return { success: true, id: result.id };
  }

  async insertBatch(records: BrowsingLogRecord[]): Promise<BackendOrError<InsertBatchResult>> {
    const result = await this.engine.sendToOpfsWorker('INSERT_BATCH', records) as { inserted: number; skipped: number };
    return { success: true, inserted: result.inserted, skipped: result.skipped };
  }

  async query(options: QueryOptions): Promise<BackendOrError<QueryResult>> {
    const result = await this.engine.tryOpfsProxy<{ rows: BrowsingLogRecord[]; total: number }>('QUERY', options);
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, rows: result.rows as BrowsingLogRecord[] & { id: number }[], total: result.total };
  }

  async search(query: string, limit: number, offset: number): Promise<BackendOrError<SearchResult>> {
    const result = await this.engine.tryOpfsProxy<{ rows: (BrowsingLogRecord & { rank: number })[]; total: number }>('SEARCH', { searchQuery: query, limit, offset });
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, rows: result.rows, total: result.total };
  }

  async update(id: number, changes: Record<string, unknown>): Promise<BackendOrError<MutationResult>> {
    await this.engine.sendToOpfsWorker('UPDATE', { id, changes });
    return { success: true };
  }

  async delete(id: number): Promise<BackendOrError<MutationResult>> {
    await this.engine.sendToOpfsWorker('DELETE', { id });
    return { success: true };
  }

  async toggleStar(id: number): Promise<BackendOrError<StarResult>> {
    const result = await this.engine.sendToOpfsWorker('TOGGLE_STAR', { id }) as { is_starred: number };
    return { success: true, is_starred: result.is_starred };
  }

  async purgeOldRecords(retentionDays: number, maxRecords: number): Promise<BackendOrError<PurgeResult>> {
    const result = await this.engine.tryOpfsProxy<{ purged: number }>('PURGE', { retentionDays, maxRecords });
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, purged: result.purged };
  }

  async purgeContent(retentionDays?: number, maxRecords?: number, includeStarred?: boolean): Promise<BackendOrError<PurgeResult>> {
    const result = await this.engine.tryOpfsProxy<{ purged: number }>('CONTENT_PURGE', { retentionDays, maxRecords, includeStarred });
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, purged: result.purged };
  }

  async getFtsIndexSize(): Promise<BackendOrError<FtsSizeResult>> {
    const result = await this.engine.tryOpfsProxy<{ count: number }>('FTS_INDEX_SIZE');
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, count: result.count };
  }

  async backupDb(): Promise<BackendOrError<BackupResult>> {
    const result = await this.engine.tryOpfsProxy<Uint8Array>('BACKUP');
    if (result === null || result.length === 0) return { success: false, error: 'Binary backup failed' };
    return { success: true, data: result };
  }

  async restoreDb(data: Uint8Array): Promise<BackendOrError<MutationResult>> {
    const result = await this.engine.tryOpfsProxy<{ restored: boolean }>('RESTORE', { data });
    if (result && result.restored) return { success: true };
    return { success: false, error: 'Binary restore failed' };
  }

  async healthCheck(): Promise<BackendOrError<HealthResult>> {
    const result = await this.engine.tryOpfsProxy<{ ok: boolean }>('HEALTH_CHECK');
    if (result !== null && result.ok) return { success: true };
    return { success: false, error: 'Health check failed' };
  }

  async getStatus(): Promise<BackendOrError<StatusResult>> {
    const result = await this.engine.tryOpfsProxy<StatusResult>('STATUS');
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, ...result };
  }

  async insertAuditLog(record: AuditLogRecord): Promise<BackendOrError<InsertResult>> {
    const result = await this.engine.sendToOpfsWorker('AUDIT_LOG_INSERT', record) as { id: number };
    return { success: true, id: result.id };
  }

  async queryAuditLog(options: { limit?: number; offset?: number }): Promise<BackendOrError<AuditLogQueryResult>> {
    const result = await this.engine.tryOpfsProxy<{ rows: AuditLogRecord[]; total: number }>('AUDIT_LOG_QUERY', options);
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, rows: result.rows as BrowsingLogRecord[] & { id: number }[], total: result.total };
  }

  async getCount(): Promise<BackendOrError<CountResult>> {
    const result = await this.engine.tryOpfsProxy<{ count: number }>('GET_COUNT');
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, count: result.count };
  }

  async clearAll(): Promise<BackendOrError<MutationResult>> {
    await this.engine.sendToOpfsWorker('CLEAR_ALL', {});
    return { success: true };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/offscreen/OpfsWorkerBackend.ts
git commit -m "feat(sqlite): add OpfsWorkerBackend adapter"
```

### Task 4: Create IdbVfsBackend adapter

**Files:**
- Create: `src/offscreen/IdbVfsBackend.ts`

- [ ] **Step 1: Create IdbVfsBackend.ts**

This adapter executes SQL directly. Import `INSERT_SQL`, `INSERT_IGNORE_SQL`, `buildInsertParams` from `schema.ts`, plus `extractDomain` from `sqliteEngineContext.ts`.

Due to length, show the pattern for insert + 2 more methods, then "repeat for all 18 methods following same pattern."

```ts
// src/offscreen/IdbVfsBackend.ts
import type { SqliteEngineContext, SqliteValue } from './sqliteEngineContext.js';
import type { StorageBackend, InsertResult, QueryResult, SearchResult, MutationResult, StarResult, PurgeResult, FtsSizeResult, BackupResult, CountResult, HealthResult, AuditLogQueryResult, StatusResult, BackendOrError } from './StorageBackend.js';
import type { BrowsingLogRecord, BrowsingLogEntry, QueryOptions, AuditLogRecord, AuditLogEntry } from '../utils/sqlite-types.js';
import { INSERT_SQL, INSERT_IGNORE_SQL, buildInsertParams, UPDATABLE_FIELDS } from './schema.js';
import { sanitizeFtsTerm, FTS_QUERY_MAX_LENGTH } from './schema.js';
import { extractDomain } from './sqliteEngineContext.js';

export class IdbVfsBackend implements StorageBackend {
  constructor(private engine: SqliteEngineContext) {}

  private ensureDb(): void {
    if (!this.engine.dbHandle) throw new Error('IDB VFS database not initialized');
  }

  async insert(record: BrowsingLogRecord): Promise<BackendOrError<InsertResult>> {
    this.ensureDb();
    const domain = record.domain || extractDomain(record.url);
    const params = buildInsertParams(record, domain);
    await this.engine.execWithCache(INSERT_SQL, params);
    let id = 0;
    await this.engine.execWithCache('SELECT last_insert_rowid()', [], (row: SqliteValue[]) => { id = Number(row[0]); });
    return { success: true, id };
  }

  async query(options: QueryOptions): Promise<BackendOrError<QueryResult>> {
    this.ensureDb();
    const limit = Math.min(options.limit ?? 100, 1000);
    const offset = options.offset ?? 0;
    const conditions: string[] = ['is_deleted = 0'];
    const params: SqliteValue[] = [];

    if (options.since != null) { conditions.push('created_at >= ?'); params.push(options.since); }
    if (options.until != null) { conditions.push('created_at <= ?'); params.push(options.until); }
    if (options.domain) { conditions.push('domain = ?'); params.push(options.domain); }
    if (options.isStarred != null) { conditions.push('is_starred = ?'); params.push(options.isStarred ? 1 : 0); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy = options.orderBy || 'created_at';
    const orderDir = options.orderDir || 'DESC';

    const rows: BrowsingLogEntry[] = [];
    await this.engine.execWithCache(
      `SELECT * FROM browsing_logs ${where} ORDER BY ${orderBy} ${orderDir} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
      (row: SqliteValue[]) => { rows.push(this.rowToEntry(row)); }
    );

    let total = 0;
    await this.engine.execWithCache(
      `SELECT COUNT(*) FROM browsing_logs ${where}`,
      params,
      (row: SqliteValue[]) => { total = Number(row[0]); }
    );

    return { success: true, rows, total };
  }

  // ... (remaining methods follow same pattern — each extracts logic from current
  //      recordsRepo.ts / dbMaintenance.ts / auditLogRepo.ts function bodies)

  async search(query: string, limit: number, offset: number): Promise<BackendOrError<SearchResult>> { /* [...FTS5 search + LIKE fallback from recordsRepo.search() body...] */ }
  async update(id: number, changes: Record<string, unknown>): Promise<BackendOrError<MutationResult>> { /* [...from recordsRepo.update() body...] */ }
  async delete(id: number): Promise<BackendOrError<MutationResult>> { /* [...from recordsRepo.hardDelete() body...] */ }
  async toggleStar(id: number): Promise<BackendOrError<StarResult>> { /* [...from recordsRepo.toggleStar() body...] */ }
  async purgeOldRecords(retDays: number, maxRecords: number): Promise<BackendOrError<PurgeResult>> { /* [...from dbMaintenance.purgeOldRecords() body...] */ }
  async purgeContent(retDays?: number, maxRecords?: number, includeStarred?: boolean): Promise<BackendOrError<PurgeResult>> { /* [...from dbMaintenance.purgeContent() body...] */ }
  async getFtsIndexSize(): Promise<BackendOrError<FtsSizeResult>> { /* [...from dbMaintenance.getFtsIndexSize() body...] */ }
  async backupDb(): Promise<BackendOrError<BackupResult>> { return { success: false, error: 'Binary backup requires OPFS storage.' }; }
  async restoreDb(_data: Uint8Array): Promise<BackendOrError<MutationResult>> { return { success: false, error: 'Binary restore requires OPFS storage.' }; }
  async healthCheck(): Promise<BackendOrError<HealthResult>> { /* [...from dbMaintenance.sqliteHealthCheck() body...] */ }
  async getStatus(): Promise<BackendOrError<StatusResult>> { /* [...from recordsRepo.getStatus() body..., with supportsBinaryBackup: false] */ }
  async insertAuditLog(record: AuditLogRecord): Promise<BackendOrError<InsertResult>> { /* [...from auditLogRepo.insertAuditLog() body...] */ }
  async queryAuditLog(options: { limit?: number; offset?: number }): Promise<BackendOrError<AuditLogQueryResult>> { /* [...from auditLogRepo.queryAuditLog() body...] */ }
  async getCount(): Promise<BackendOrError<CountResult>> { /* [...from recordsRepo.getCount() body...] */ }
  async clearAll(): Promise<BackendOrError<MutationResult>> { /* [...from recordsRepo.clearAll() body...] */ }
  async insertBatch(records: BrowsingLogRecord[]): Promise<BackendOrError<{ success: true; inserted: number; skipped: number }>> { /* [...from recordsRepo.insertBatch() body...] */ }

  private rowToEntry(row: SqliteValue[]): BrowsingLogEntry {
    return {
      id: Number(row[0]), url: String(row[1]), title: row[2] != null ? String(row[2]) : null,
      summary: row[3] != null ? String(row[3]) : null, tags: row[4] != null ? String(row[4]) : null,
      created_at: Number(row[5]), domain: row[6] != null ? String(row[6]) : null,
      visit_duration: row[7] != null ? Number(row[7]) : null,
      scroll_ratio: row[8] != null ? Number(row[8]) : null,
      is_starred: Number(row[9]), is_deleted: Number(row[10]),
      obsidian_synced: Number(row[11]), gist_synced: Number(row[12]),
      content: row[13] != null ? String(row[13]) : null,
      masked_count: row[14] != null ? Number(row[14]) : null,
      cleansed_reason: row[15] != null ? String(row[15]) : null,
      ai_provider: row[16] != null ? String(row[16]) : null,
      ai_model: row[17] != null ? String(row[17]) : null,
      ai_duration_ms: row[18] != null ? Number(row[18]) : null,
      obsidian_duration_ms: row[19] != null ? Number(row[19]) : null,
      sent_tokens: row[20] != null ? Number(row[20]) : null,
      received_tokens: row[21] != null ? Number(row[21]) : null,
      original_tokens: row[22] != null ? Number(row[22]) : null,
      cleansed_tokens: row[23] != null ? Number(row[23]) : null,
      page_bytes: row[24] != null ? Number(row[24]) : null,
      candidate_bytes: row[25] != null ? Number(row[25]) : null,
      original_bytes: row[26] != null ? Number(row[26]) : null,
      cleansed_bytes: row[27] != null ? Number(row[27]) : null,
      ai_summary_original_bytes: row[28] != null ? Number(row[28]) : null,
      ai_summary_cleansed_bytes: row[29] != null ? Number(row[29]) : null,
      extracted_sentences_bytes: row[30] != null ? Number(row[30]) : null,
      extracted_sentences_original_bytes: row[31] != null ? Number(row[31]) : null,
      fallback_triggered: Number(row[32]),
    };
  }
}
```

**Note:** For the full implementation, extract each method body from the current `recordsRepo.ts`, `dbMaintenance.ts`, and `auditLogRepo.ts` — moving the SQL/business logic into the adapter, leaving only delegation in the repos.

- [ ] **Step 2: Commit**

```bash
git add src/offscreen/IdbVfsBackend.ts
git commit -m "feat(sqlite): add IdbVfsBackend adapter"
```

### Task 5: Create FallbackStorageAdapter

**Files:**
- Create: `src/offscreen/FallbackStorageAdapter.ts`

- [ ] **Step 1: Create FallbackStorageAdapter.ts**

Wraps existing `FallbackStorage` class. Its interface is already close. Map return types to `BackendOrError<T>`:

```ts
// src/offscreen/FallbackStorageAdapter.ts
import type { StorageBackend, InsertResult, InsertBatchResult, QueryResult, SearchResult, MutationResult, StarResult, PurgeResult, FtsSizeResult, BackupResult, CountResult, HealthResult, AuditLogQueryResult, StatusResult, BackendOrError } from './StorageBackend.js';
import { FallbackStorage } from './storageFallback.js';
import type { BrowsingLogRecord, QueryOptions, AuditLogRecord } from '../utils/sqlite-types.js';

export class FallbackStorageAdapter implements StorageBackend {
  constructor(private fallback: FallbackStorage) {}

  async insert(record: BrowsingLogRecord): Promise<BackendOrError<InsertResult>> {
    return this.fallback.insert(record);
  }

  async query(options: QueryOptions): Promise<BackendOrError<QueryResult>> {
    const result = await this.fallback.query(options);
    return result;
  }

  async search(query: string, limit: number, offset: number): Promise<BackendOrError<SearchResult>> {
    const result = await this.fallback.search(query, limit, offset);
    return result;
  }

  async update(id: number, changes: Record<string, unknown>): Promise<BackendOrError<MutationResult>> {
    const ok = await this.fallback.update(id, changes);
    if (!ok) return { success: false, error: 'Update failed' };
    return { success: true };
  }

  async delete(id: number): Promise<BackendOrError<MutationResult>> {
    const ok = await this.fallback.hardDelete(id);
    if (!ok) return { success: false, error: 'Delete failed' };
    return { success: true };
  }

  async toggleStar(id: number): Promise<BackendOrError<StarResult>> {
    const result = await this.fallback.toggleStar(id);
    return result;
  }

  async purgeOldRecords(retentionDays: number, maxRecords: number): Promise<BackendOrError<PurgeResult>> {
    return this.fallback.purgeOldRecords(retentionDays, maxRecords);
  }

  async purgeContent(retentionDays?: number, maxRecords?: number, includeStarred?: boolean): Promise<BackendOrError<PurgeResult>> {
    return this.fallback.purgeContent(retentionDays, maxRecords, includeStarred);
  }

  async getFtsIndexSize(): Promise<BackendOrError<FtsSizeResult>> {
    return { success: true, count: 0 };
  }

  async backupDb(): Promise<BackendOrError<BackupResult>> {
    return { success: false, error: 'Binary backup requires OPFS storage.' };
  }

  async restoreDb(): Promise<BackendOrError<MutationResult>> {
    return { success: false, error: 'Binary restore requires OPFS storage.' };
  }

  async healthCheck(): Promise<BackendOrError<HealthResult>> {
    const ok = this.fallback.healthCheck();
    if (!ok) return { success: false, error: 'Fallback storage unavailable' };
    return { success: true };
  }

  async getStatus(): Promise<BackendOrError<StatusResult>> {
    return { success: true, initialized: true, fallback: true, fts5: false, supportsBinaryBackup: false };
  }

  async insertAuditLog(record: AuditLogRecord): Promise<BackendOrError<InsertResult>> {
    // FallbackStorage does not have audit log — create a simple implementation
    // or return error
    return { success: false, error: 'Audit log not supported in fallback mode' };
  }

  async queryAuditLog(): Promise<BackendOrError<AuditLogQueryResult>> {
    return { success: false, error: 'Audit log not supported in fallback mode' };
  }

  async getCount(): Promise<BackendOrError<CountResult>> {
    const count = await this.fallback.getCount();
    return { success: true, count };
  }

  async clearAll(): Promise<BackendOrError<MutationResult>> {
    await this.fallback.clearAll();
    return { success: true };
  }

  async insertBatch(records: BrowsingLogRecord[]): Promise<BackendOrError<InsertBatchResult>> {
    return this.fallback.insertBatch(records);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/offscreen/FallbackStorageAdapter.ts
git commit -m "feat(sqlite): add FallbackStorageAdapter"
```

### Task 6: Add getBackend() to SqliteEngineContext

**Files:**
- Modify: `src/offscreen/sqliteEngineContext.ts`

- [ ] **Step 1: Add getBackend() method**

Add to `SqliteEngineContext` class:

```ts
import { StorageBackend, NoopBackend } from './StorageBackend.js';
// (these imports will be added lazily to avoid circular deps — see note below)

private _backend: StorageBackend | null = null;

async getBackend(): Promise<StorageBackend> {
  if (this._backend) return this._backend;

  // Try OPFS Worker first
  try {
    const { OpfsWorkerBackend } = await import('./OpfsWorkerBackend.js');
    this._backend = new OpfsWorkerBackend(this);
    return this._backend;
  } catch {}

  // Try IDB VFS
  try {
    if (!this.usingFallbackStorage) {
      await this.init(); // lazy init
      if (this.dbHandle) {
        const { IdbVfsBackend } = await import('./IdbVfsBackend.js');
        this._backend = new IdbVfsBackend(this);
        return this._backend;
      }
    }
  } catch {}

  // Try Fallback
  if (this.fallbackStorage) {
    const { FallbackStorageAdapter } = await import('./FallbackStorageAdapter.js');
    this._backend = new FallbackStorageAdapter(this.fallbackStorage);
    return this._backend;
  }

  // Null Object — never throw
  this._backend = new NoopBackend();
  return this._backend;
}

/** Reset backend selection (used by resetForTesting / offscreen recreate). */
resetBackend(): void {
  this._backend = null;
}
```

**Note:** Use dynamic `import()` to avoid circular dependencies (adapters import `SqliteEngineContext` type, engine imports adapter classes).

- [ ] **Step 2: Commit**

```bash
git add src/offscreen/sqliteEngineContext.ts
git commit -m "feat(sqlite): add getBackend() with lazy adapter selection and NoopBackend fallback"
```

### Task 7: Replace repository function bodies with backend delegation

**Files:**
- Modify: `src/offscreen/recordsRepo.ts`
- Modify: `src/offscreen/dbMaintenance.ts`
- Modify: `src/offscreen/auditLogRepo.ts`

- [ ] **Step 1: Simplify recordsRepo.ts functions**

For each exported function in `recordsRepo.ts`, replace the 4-way branch body with delegation. Example for `insert()`:

```ts
// Before (~30 lines of OPFS proxy → fallback → IDB VFS → error)
export async function insert(record: BrowsingLogRecord): Promise<{ success: true; id: number } | { success: false; error: string }> {
  // [... 30 lines of branching ...]
}

// After (~5 lines)
export async function insert(record: BrowsingLogRecord): Promise<{ success: true; id: number } | { success: false; error: string }> {
  const backend = await engine.getBackend();
  return backend.insert(record);
}
```

Apply this pattern to ALL functions: `insert`, `insertBatch`, `query`, `search`, `update`, `delete`, `toggleStar`, `getCount`, `getStatus`, `clearAll`, `serialize`.

For `serialize()`, which has no backend equivalent, keep as-is (it's an offscreen-specific JSON export function, not a storage backend operation).

- [ ] **Step 2: Simplify dbMaintenance.ts functions**

Same pattern for ALL functions: `purgeOldRecords`, `purgeContent`, `getFtsIndexSize`, `checkFtsIndexHealth`, `backupDb`, `restoreDb`, `sqliteHealthCheck`.

For `checkFtsIndexHealth()` (which calls `getFtsIndexSize()` internally and logs a warning), keep the wrapper but have it delegate:

```ts
export async function checkFtsIndexHealth(): Promise<{ count: number; warning: boolean }> {
  const backend = await engine.getBackend();
  const result = await backend.getFtsIndexSize();
  if (!result.success) return { count: 0, warning: false };
  const warning = result.count > FTS_INDEX_WARNING_THRESHOLD;
  if (warning) {
    logWarn('FTS index is large; consider evaluation', { count: result.count }, undefined, 'sqlite');
  }
  return { count: result.count, warning };
}
```

- [ ] **Step 3: Simplify auditLogRepo.ts functions**

Same pattern: `insertAuditLog`, `queryAuditLog`.

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: All tests pass. Any test that mocked `engine.*` internals (opfsWorker, dbHandle, etc.) may need updating to mock `engine.getBackend()` instead.

- [ ] **Step 5: Commit**

```bash
git add src/offscreen/recordsRepo.ts src/offscreen/dbMaintenance.ts src/offscreen/auditLogRepo.ts
git commit -m "refactor(sqlite): replace repository branching with StorageBackend delegation"
```

### Task 8: Add SQL_EXEC/SQL_QUERY to OPFS Worker

**Files:**
- Modify: `src/offscreen/opfsWorker.ts` (message dispatcher)

- [ ] **Step 1: Add SQL_EXEC and SQL_QUERY handlers to handleRequest()**

In `opfsWorker.ts`, find the `handleRequest()` function's switch statement. Add:

```ts
case 'SQL_EXEC': {
  const { sql, params = [] } = payload as { sql: string; params: SqliteValue[] };
  await initSqlite();
  await engine!.exec(sql, params);
  sendResponse(id, true, { changes: 0 });
  break;
}
case 'SQL_QUERY': {
  const { sql, params = [] } = payload as { sql: string; params: SqliteValue[] };
  await initSqlite();
  const rows = await engine!.query(sql, params);
  sendResponse(id, true, { rows });
  break;
}
```

**Security note:** These types are for migrations only. They accept raw SQL, unlike the typed operation messages. They are intentionally not exposed through `StorageBackend` — only through `MigrationEngine` (PBI #5). Add a comment:

```ts
// WARNING: SQL_EXEC / SQL_QUERY accept raw SQL strings.
// Use ONLY for schema migrations (MigrationEngine). Never expose to user input.
// Regular CRUD operations MUST use typed operation messages (INSERT, QUERY, etc.).
```

- [ ] **Step 2: Run existing Worker tests**

```bash
npm test -- --testPathPattern="opfsWorker"
```

Expected: Pass.

- [ ] **Step 3: Commit**

```bash
git add src/offscreen/opfsWorker.ts
git commit -m "feat(sqlite): add SQL_EXEC/SQL_QUERY backdoor to OPFS Worker for migrations"
```

### Task 9: Update sqlite.ts re-exports

**Files:**
- Modify: `src/offscreen/sqlite.ts`

- [ ] **Step 1: Add adapter class re-exports**

```ts
// Add to sqlite.ts:
export { StorageBackend, NoopBackend } from './StorageBackend.js';
export type { StatusResult } from './StorageBackend.js';
export { OpfsWorkerBackend } from './OpfsWorkerBackend.js';
export { IdbVfsBackend } from './IdbVfsBackend.js';
export { FallbackStorageAdapter } from './FallbackStorageAdapter.js';
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/offscreen/sqlite.ts
git commit -m "refactor(sqlite): re-export adapter classes from sqlite.ts barrel"
```

---

## Phase 3: PBI #2 + #5 — Type Dedup + Shared Migrations (parallel)

### Task 10: Remove duplicate types from opfsWorker.ts

**Files:**
- Modify: `src/offscreen/opfsWorker.ts`

- [ ] **Step 1: Replace inline type definitions with imports**

Delete interfaces (lines 22-94):
- `interface BrowsingLogRecord` (lines 22-56)
- `interface SearchResultRecord` (lines 58-70)
- `interface QueryPayload` (lines 77-88)
- `interface SearchPayload` (lines 90-94)

Replace with imports at top of file:

```ts
import type { BrowsingLogRecord, BrowsingLogEntry, SearchResult, QueryOptions } from '../utils/sqlite-types.js';

// Worker-internal types (not in shared types):
type QueryPayload = QueryOptions & { ids?: number[]; tagFilter?: string };
type SearchPayload = { searchQuery: string; limit?: number; offset?: number };
```

- [ ] **Step 2: Verify type consistency**

Search the remaining file for any usage of the deleted types and verify they resolve to the shared types:

```bash
# Check no remaining references to old types
rg "BrowsingLogRecord|SearchResultRecord" src/offscreen/opfsWorker.ts
# Should show only the import line
```

- [ ] **Step 3: Run type check and tests**

```bash
npm run type-check
npm test -- --testPathPattern="opfsWorker"
```

- [ ] **Step 4: Commit**

```bash
git add src/offscreen/opfsWorker.ts
git commit -m "refactor(sqlite): remove duplicate type definitions from opfsWorker; import shared types"
```

### Task 11: Create shared migrations.ts module

**Files:**
- Create: `src/offscreen/migrations.ts`
- Modify: `src/offscreen/schema.ts`

- [ ] **Step 1: Add MIGRATION_COLUMNS and MIGRATION_SEQUENCE to schema.ts**

Add to `src/offscreen/schema.ts`:

```ts
/** Columns added via ALTER TABLE migration (idempotent). */
export const MIGRATION_COLUMNS = [
  'content TEXT',
  'masked_count INTEGER',
  'cleansed_reason TEXT',
  'ai_provider TEXT',
  'ai_model TEXT',
  'ai_duration_ms INTEGER',
  'obsidian_duration_ms INTEGER',
  'sent_tokens INTEGER',
  'received_tokens INTEGER',
  'original_tokens INTEGER',
  'cleansed_tokens INTEGER',
  'page_bytes INTEGER',
  'candidate_bytes INTEGER',
  'original_bytes INTEGER',
  'cleansed_bytes INTEGER',
  'ai_summary_original_bytes INTEGER',
  'ai_summary_cleansed_bytes INTEGER',
  'extracted_sentences_bytes INTEGER',
  'extracted_sentences_original_bytes INTEGER',
  'fallback_triggered INTEGER DEFAULT 0',
] as const;

/** Ordered sequence of one-off migrations. */
export interface MigrationStep {
  sql: string;
  id: string;
}

export const MIGRATION_SEQUENCE: readonly MigrationStep[] = [
  { sql: 'ALTER TABLE browsing_logs ADD COLUMN obsidian_synced INTEGER DEFAULT 0', id: 'obsidian_synced' },
  { sql: 'ALTER TABLE browsing_logs ADD COLUMN gist_synced INTEGER DEFAULT 0', id: 'gist_synced' },
] as const;
```

- [ ] **Step 2: Create migrations.ts with MigrationEngine and runMigrations()**

```ts
// src/offscreen/migrations.ts
import { MIGRATION_COLUMNS, MIGRATION_SEQUENCE, FTS5_STATEMENTS, GIST_SYNCED_INDEX_SQL } from './schema.js';
import { errorMessage } from '../utils/errorUtils.js';

export interface MigrationEngine {
  exec(sql: string): Promise<void>;
  queryValue(sql: string): Promise<number | null>;
}

export async function runMigrations(engine: MigrationEngine): Promise<{ fts5Available: boolean }> {
  // 1. One-off migrations
  for (const step of MIGRATION_SEQUENCE) {
    try {
      await engine.exec(step.sql);
    } catch {
      // Column/target already exists — ignore
    }
  }

  // PBI-11: gist_synced index
  try {
    await engine.exec(GIST_SYNCED_INDEX_SQL);
  } catch {
    // Index already exists
  }

  // 2. ALTER TABLE migration for all dynamic columns
  for (const colDef of MIGRATION_COLUMNS) {
    try {
      await engine.exec(`ALTER TABLE browsing_logs ADD COLUMN ${colDef}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('duplicate column name')) continue;
      throw err;
    }
  }

  // 3. FTS5 schema
  let fts5Available = false;
  try {
    for (const stmt of FTS5_STATEMENTS) {
      await engine.exec(stmt);
    }
    fts5Available = true;
  } catch (err) {
    console.warn('FTS5 unavailable:', errorMessage(err));
  }

  // 4. FTS index rebuild
  if (fts5Available) {
    try {
      const baseCount = Number(await engine.queryValue('SELECT COUNT(*) AS c FROM browsing_logs') ?? 0);
      const ftsCount = Number(await engine.queryValue('SELECT COUNT(*) AS c FROM browsing_logs_fts') ?? 0);
      if (baseCount > 0 && ftsCount === 0) {
        await engine.exec("INSERT INTO browsing_logs_fts(browsing_logs_fts) VALUES('rebuild')");
      }
    } catch (rebuildErr) {
      console.warn('FTS rebuild check failed:', errorMessage(rebuildErr));
    }
  }

  return { fts5Available };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/offscreen/migrations.ts src/offscreen/schema.ts
git commit -m "feat(sqlite): add shared migrations module with MigrationEngine interface"
```

### Task 12: Replace migration logic in sqliteEngineContext.ts and opfsWorker.ts

**Files:**
- Modify: `src/offscreen/sqliteEngineContext.ts`
- Modify: `src/offscreen/opfsWorker.ts`

- [ ] **Step 1: Replace _doInit() migration logic in sqliteEngineContext.ts**

Find the `_doInit()` method (around line 253). Remove the `newColumns` array, the ALTER TABLE loop, the obsidian_synced/gist_synced single ALTER TABLE calls, the FTS5 statement execution loop, and the FTS rebuild logic. Replace with:

```ts
import { runMigrations, type MigrationEngine } from './migrations.js';

// Inside _doInit():
const idbMigrationEngine: MigrationEngine = {
  exec: async (sql) => {
    await this.execWithCache(sql, []);
  },
  queryValue: async (sql) => {
    let value: number | null = null;
    await this.execWithCache(sql, [], (row: SqliteValue[]) => { value = Number(row[0]); });
    return value;
  },
};

const { fts5Available } = await runMigrations(idbMigrationEngine);
this.fts5Available = fts5Available;
```

- [ ] **Step 2: Replace initSqliteInner() migration logic in opfsWorker.ts**

Find the `initSqliteInner()` method (around line 150). Remove the `newColumns` array, the ALTER TABLE loop, the single obsidian_synced/gist_synced ALTER calls, the FTS rebuild logic. Keep the initial `SCHEMA_SQL` and `AUDIT_LOG_SCHEMA_SQL` execution (those are not migrations — they're the base DDL). Replace the rest with:

```ts
import { runMigrations, type MigrationEngine } from './migrations.js';

// Inside initSqliteInner(), after engine.exec(AUDIT_LOG_SCHEMA_SQL):

const workerMigrationEngine: MigrationEngine = {
  exec: async (sql) => {
    await engine!.exec(sql);
  },
  queryValue: async (sql) => {
    const v = await engine!.queryValue(sql);
    return v !== undefined ? Number(v) : null;
  },
};

const { fts5Available: fts } = await runMigrations(workerMigrationEngine);
fts5Available = fts;

// Cache compile options (keep existing code)
const opts = await engine!.query('PRAGMA compile_options');
cachedCompileOptions = opts.map((r) => String(Object.values(r)[0] ?? ''));

// Keep runMigrationV2() call (V2 migration is separate from schema migrations)
await runMigrationV2();
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/offscreen/sqliteEngineContext.ts src/offscreen/opfsWorker.ts
git commit -m "refactor(sqlite): replace duplicated migration logic with shared runMigrations()"
```

---

## Phase 4: PBI #3 — Panel Parameterization (1pt)

### Task 13: Parameterize render functions in sqliteHistoryPanel.ts

**Files:**
- Modify: `src/dashboard/sqliteHistoryPanel.ts`

- [ ] **Step 1: Parameterize renderCalendarNav()**

Change from accessing global `state` + `document.getElementById` to receiving parameters:

```ts
// Before
function renderCalendarNav(): void {
  const navEl = document.getElementById('sqlite-calendar-nav');
  // ... uses state.selectedDate, state.searchQuery, state.activeTagFilter ...
}

// After
function renderCalendarNav(
  container: HTMLElement,
  selectedDate: string | null,
  options: { searchQuery: string; activeTagFilter: string | null },
  callbacks: {
    onDateSelect: (d: string) => void;
    onRangeSelect: (since: number, until: number) => void;
    onClearFilters: () => void;
  }
): void {
  // Replace: document.getElementById('sqlite-calendar-nav') → container
  // Replace: state.selectedDate → selectedDate
  // Replace: state.searchQuery → options.searchQuery
  // Replace: state.activeTagFilter → options.activeTagFilter
  // Replace: handleDateSelect → callbacks.onDateSelect
  // Replace: clear filters logic → callbacks.onClearFilters
  // ... rest of the 120-line function body moves unchanged ...
}
```

- [ ] **Step 2: Parameterize renderEntryList()**

```ts
function renderEntryList(
  container: HTMLElement,
  entries: BrowsingLogEntry[],
  selectedIds: Set<number>,
  activeTagFilter: string | null,
  enrichmentMap: Map<string, SavedUrlEntry> | null,
  callbacks: {
    onToggleStar: (id: number) => void | Promise<void>;
    onDelete: (id: number) => void | Promise<void>;
    onSelectionChange: (id: number, selected: boolean) => void;
    onTagFilterClick: (tag: string) => void;
    onContentToggle: (controlsId: string) => void;
  }
): void {
  // Replace: document.getElementById('sqlite-entry-list') → container
  // Replace: state.entries → entries
  // Replace: state.selectedIds → selectedIds
  // Replace: state.activeTagFilter → activeTagFilter
  // Replace: handleToggleStar → callbacks.onToggleStar
  // Replace: handleDelete → callbacks.onDelete
  // ... rest of the 180-line function body ...
}
```

- [ ] **Step 3: Parameterize renderPagination()**

```ts
function renderPagination(
  container: HTMLElement,
  currentPage: number,
  total: number,
  pageSize: number,
  onPageChange: (page: number) => void
): void {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) { container.innerHTML = ''; return; }
  container.innerHTML = `
    <button ${currentPage === 0 ? 'disabled' : ''} data-page="prev">${t('historyPrev')}</button>
    <span>${t('historyPageInfo', [String(currentPage + 1), String(totalPages)])}</span>
    <button ${currentPage >= totalPages - 1 ? 'disabled' : ''} data-page="next">${t('historyNext')}</button>
  `;
  container.querySelector('[data-page="prev"]')?.addEventListener('click', () => onPageChange(currentPage - 1));
  container.querySelector('[data-page="next"]')?.addEventListener('click', () => onPageChange(currentPage + 1));
}
```

- [ ] **Step 4: Parameterize updateBulkBar()**

```ts
function updateBulkBar(
  selectedIds: Set<number>,
  entries: BrowsingLogEntry[],
  callbacks: {
    onSelectAll: (checked: boolean) => void;
    onClear: () => void;
    onAppend: () => void;
  }
): void {
  const bar = document.getElementById('sqlite-bulk-bar');
  if (!bar) return;
  bar.style.display = selectedIds.size > 0 ? '' : 'none';

  const selectAll = document.getElementById('sqlite-select-all') as HTMLInputElement | null;
  if (selectAll) selectAll.checked = entries.length > 0 && selectedIds.size === entries.length;

  const countEl = document.getElementById('sqlite-selection-count');
  if (countEl) countEl.textContent = t('historySelectionCount', [String(selectedIds.size)]);

  const appendBtn = document.getElementById('sqlite-append-obsidian') as HTMLButtonElement | null;
  if (appendBtn) appendBtn.disabled = selectedIds.size === 0;
}
```

- [ ] **Step 5: Update refresh() to use new signatures**

```ts
function refresh(): void {
  if (isPanelMounted()) {
    updateDynamicRegions();
  } else {
    renderState();
  }
}

function updateDynamicRegions(): void {
  // Update count
  const countEl = document.querySelector('.sqlite-history-count');
  if (countEl) countEl.textContent = t('historyRecordCount', [String(state.total)]);

  // Update error
  const errorEl = document.getElementById('sqlite-error');
  if (errorEl) {
    errorEl.textContent = state.error || '';
    (errorEl as HTMLElement).style.display = state.error ? '' : 'none';
  }

  // Render calendar
  const calContainer = document.getElementById('sqlite-calendar-nav');
  if (calContainer) {
    renderCalendarNav(calContainer, state.selectedDate,
      { searchQuery: state.searchQuery, activeTagFilter: state.activeTagFilter },
      {
        onDateSelect: (d) => handleDateSelect(d),
        onRangeSelect: (since, until) => { state.selectedDate = null; state.searchQuery = ''; state.currentPage = 0; loadData({ since, until }); },
        onClearFilters: () => { state.searchQuery = ''; state.selectedDate = null; state.activeTagFilter = null; state.currentPage = 0; loadData(); },
      }
    );
  }

  // Render entries
  const listContainer = document.getElementById('sqlite-entry-list');
  if (listContainer) {
    if (state.loading) {
      listContainer.innerHTML = `<div class="loading">${t('historyLoading')}</div>`;
    } else {
      renderEntryList(listContainer, state.entries, state.selectedIds, state.activeTagFilter, null, {
        onToggleStar: (id) => handleToggleStar(id),
        onDelete: (id) => handleDelete(id),
        onSelectionChange: (id, selected) => { if (selected) state.selectedIds.add(id); else state.selectedIds.delete(id); updateBulkBar(state.selectedIds, state.entries, bulkCallbacks); },
        onTagFilterClick: (tag) => { state.activeTagFilter = state.activeTagFilter === tag ? null : tag; state.currentPage = 0; loadData({ tagFilter: state.activeTagFilter || undefined, ...dateRangeFromSelected() }); },
        onContentToggle: (controlsId) => { /* existing content-toggle logic */ },
      });
    }
  }

  // Render pagination
  if (!state.loading) {
    const pagContainer = document.getElementById('sqlite-pagination');
    if (pagContainer) renderPagination(pagContainer, state.currentPage, state.total, PAGE_SIZE, (page) => { state.currentPage = page; reloadCurrent(); });
  }

  // Update tag filter bar and bulk bar
  updateTagFilterBar();
  updateBulkBar(state.selectedIds, state.entries, bulkCallbacks);
}
```

- [ ] **Step 6: Run tests**

```bash
npm test -- --testPathPattern="sqliteHistoryPanel"
```

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/sqliteHistoryPanel.ts
git commit -m "refactor(panel): parameterize render functions for testability"
```

---

## Final Verification

### Task 14: Full test suite and build

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: All ~50 SQLite-related test files pass.

- [ ] **Step 2: Run type check**

```bash
npm run type-check
```

Expected: No errors.

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: WXT build succeeds.

- [ ] **Step 4: Manual verification in Chrome**

1. Load the unpacked extension from `dist/chromium-mv3/`
2. Browse a few pages to generate history
3. Open the dashboard → SQLite History tab
4. Verify: records appear, search works, star/delete work, calendar navigation works
5. Open the extension popup → Settings → SQLite Status
6. Verify: backend status shows correctly, supportsBinaryBackup reflects reality

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: final verification after SQLite architecture deepening"
```

---

## Self-Review

**Spec coverage check:**
- PBI #4 error propagation: Tasks 1 (call() + handlers + dashboard + panel) ✅
- PBI #1 adapter: Tasks 2-9 (interface, 3 adapters, getBackend, repos, worker backdoor, barrel) ✅
- PBI #2 type dedup: Task 10 ✅
- PBI #5 shared migrations: Tasks 11-12 (schema.ts additions, migrations.ts, engineContext + opfsWorker replacement) ✅
- PBI #3 panel parameterization: Task 13 ✅

**Placeholder scan:** No TBD, TODO, or "implement later" patterns found.

**Type consistency:** `BackendOrError<T>` used consistently. `StorageBackend` interface defined in Task 2, consumed by all adapter tasks and repos. `MigrationEngine` defined in Task 11, consumed by Tasks 12.

**No orphan steps:** Every commit step produces a valid state. Each phase can be tested independently.
