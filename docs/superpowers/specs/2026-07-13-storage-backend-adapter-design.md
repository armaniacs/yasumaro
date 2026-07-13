# Design: StorageBackend Adapter — Unify Three-Backend Dispatch

**Date:** 2026-07-13
**PBI:** [2026-07-13-01-fix-storage-backend-adapter](../pbi/2026-07-13-01-fix-storage-backend-adapter.md)
**Status:** Draft

---

## Architecture Overview

### Current State (Problem)

Every repository function in `recordsRepo.ts`, `dbMaintenance.ts`, and `auditLogRepo.ts` carries identical four-way backend-selection logic:

```
function operation(args):
  try opfsWorker proxy →
  if not, init engine →
  if fallback storage, use fallback →
  if dbHandle, direct IDB VFS →
  else error
```

This pattern repeats ~20 times across 3 files (~240 lines of duplication). Adding a new backend or changing selection order requires touching every function.

### Target State

Introduce a `StorageBackend` interface with three adapter implementations. `SqliteEngineContext` selects the adapter once at init time. Repository functions delegate to `backend.operation()` — a single call.

```
┌─────────────────────────────────────────────────┐
│ SqliteEngineContext                              │
│   selectBackend() → StorageBackend (once)        │
│   ┌──────────────┐ ┌──────────────┐ ┌─────────┐ │
│   │OpfsWorker    │ │IdbVfs        │ │Fallback │ │
│   │Backend       │ │Backend       │ │Backend  │ │
│   │postMessage→  │ │execWithCache │ │chrome.  │ │
│   │Worker        │ │→wa-sqlite    │ │storage  │ │
│   └──────┬───────┘ └──────┬───────┘ └────┬────┘ │
└──────────┼────────────────┼──────────────┼──────┘
           │                │              │
  ┌────────┴───────┐  ┌─────┴──────┐  ┌───┴────────┐
  │recordsRepo.ts  │  │dbMaintenance│  │auditLogRepo │
  │insert/query/   │  │purge/backup │  │insert/query │
  │search/update/  │  │/restore/    │  │             │
  │delete/toggle★  │  │healthCheck  │  │             │
  └────────────────┘  └─────────────┘  └─────────────┘
```

---

## StorageBackend Interface

```ts
// src/offscreen/StorageBackend.ts
interface StorageBackend {
  // CRUD
  insert(record: BrowsingLogRecord): Promise<{ success: true; id: number } | { success: false; error: string }>;
  insertBatch(records: BrowsingLogRecord[]): Promise<{ success: true; inserted: number; skipped: number } | { success: false; error: string }>;
  query(options: QueryOptions): Promise<{ success: true; rows: BrowsingLogEntry[]; total: number } | { success: false; error: string }>;
  search(query: string, limit: number, offset: number): Promise<{ success: true; rows: SearchResultEntry[]; total: number } | { success: false; error: string }>;
  update(id: number, changes: Record<string, unknown>): Promise<{ success: true } | { success: false; error: string }>;
  delete(id: number): Promise<{ success: true } | { success: false; error: string }>;
  toggleStar(id: number): Promise<{ success: true; is_starred: number } | { success: false; error: string }>;

  // Maintenance
  purgeOldRecords(retentionDays: number, maxRecords: number): Promise<{ success: true; purged: number } | { success: false; error: string }>;
  purgeContent(retentionDays?: number, maxRecords?: number, includeStarred?: boolean): Promise<{ success: true; purged: number } | { success: false; error: string }>;
  getFtsIndexSize(): Promise<{ success: true; count: number } | { success: false; error: string }>;
  backupDb(): Promise<{ success: true; data: Uint8Array } | { success: false; error: string }>;
  restoreDb(data: Uint8Array): Promise<{ success: true } | { success: false; error: string }>;
  healthCheck(): Promise<{ success: true } | { success: false; error: string }>;
  getStatus(): Promise<StatusResult>;

  // Audit log
  insertAuditLog(record: AuditLogRecord): Promise<{ success: true; id: number } | { success: false; error: string }>;
  queryAuditLog(options: { limit?: number; offset?: number }): Promise<{ success: true; rows: AuditLogEntry[]; total: number } | { success: false; error: string }>;

  // Utility
  getCount(): Promise<{ success: true; count: number } | { success: false; error: string }>;
  clearAll(): Promise<{ success: true } | { success: false; error: string }>;
}
```

### StatusResult (capability query)

```ts
interface StatusResult {
  initialized: boolean;
  fallback: boolean;
  fts5: boolean;
  supportsBinaryBackup: boolean;  // OPFS Worker only
  compileOptions?: string[];
  compileOptionsSource?: 'opfs-worker' | 'idb' | 'fallback';
  initError?: string;
}
```

### NoopBackend (Null Object Pattern)

When all three backends fail to initialize, `getBackend()` returns `NoopBackend` instead of throwing. Every method returns `{ success: false, error: 'Database not initialized' }`. This preserves the existing error pattern without forcing repositories to add try-catch blocks.

### Worker SQL backdoor (for migrations only)

The OPFS Worker exposes `SQL_EXEC` and `SQL_QUERY` message types for schema operations. These are used by `MigrationEngine` (PBI #5) only — not by repository functions. Repository functions continue using typed operation messages (`INSERT`, `QUERY`, `SEARCH`) for type safety and SQL injection prevention.

```ts
// Worker handles these additional message types:
// 'SQL_EXEC': { sql: string, params: SqliteValue[] } → { changes: number, lastInsertId: number }
// 'SQL_QUERY': { sql: string, params: SqliteValue[] } → { rows: SqliteRow[] }
```

---

## Adapter Implementations

### 1. OpfsWorkerBackend

Delegates to the OPFS Worker via `postMessage`. Each method sends a typed message and awaits the response.

```ts
class OpfsWorkerBackend implements StorageBackend {
  constructor(private engine: SqliteEngineContext) {}

  async insert(record: BrowsingLogRecord) {
    const result = await this.engine.sendToOpfsWorker('INSERT', record);
    return { success: true, id: result.id };
  }

  async query(options: QueryOptions) {
    const result = await this.engine.tryOpfsProxy('QUERY', options);
    if (result === null) return { success: false, error: 'OPFS Worker unavailable' };
    return { success: true, rows: result.rows, total: result.total };
  }
  // ... all other methods follow the same pattern
}
```

### 2. IdbVfsBackend

Executes SQL directly via `execWithCache`. Uses the existing prepared statement cache.

```ts
class IdbVfsBackend implements StorageBackend {
  constructor(private engine: SqliteEngineContext) {}

  async insert(record: BrowsingLogRecord) {
    const params = buildInsertParams(record, record.domain || extractDomain(record.url));
    await this.engine.execWithCache(INSERT_SQL, params);
    let id = 0;
    await this.engine.execWithCache('SELECT last_insert_rowid()', [], (row) => { id = Number(row[0]); });
    return { success: true, id };
  }
  // ... all other methods
}
```

### 3. FallbackBackend

Wraps the existing `FallbackStorage` class. Its interface is already close to `StorageBackend`; only minor adapter glue needed.

```ts
class FallbackStorageAdapter implements StorageBackend {
  constructor(private fallback: FallbackStorage) {}

  async insert(record: BrowsingLogRecord) {
    return this.fallback.insert(record);
  }
  // ... wraps FallbackStorage methods with StorageBackend-compatible return types
}
```

---

## Backend Selection Logic

In `SqliteEngineContext`. Uses lazy initialization — the first repository call triggers `getBackend()`, which performs backend selection. This avoids offscreen document creation timeout (Chrome limits offscreen setup to 5-10s; WASM loading + OPFS init + migration can exceed this).

```ts
class SqliteEngineContext {
  private backend: StorageBackend | null = null;

  async getBackend(): Promise<StorageBackend> {
    if (this.backend) return this.backend;

    // Try OPFS Worker first
    try { this.backend = await this.tryInitOpfsWorker(); return this.backend; } catch {}
    // Try IDB VFS
    try { this.backend = await this.tryInitIdbVfs(); return this.backend; } catch {}
    // Try Fallback
    try { this.backend = await this.tryInitFallback(); return this.backend; } catch {}

    // Null Object — never throw. All operations return { success: false, error: 'Database not initialized' }
    this.backend = new NoopBackend();
    return this.backend;
  }
}
```

**Backend selection is one-time per offscreen document lifetime.** The environment factors that cause backend failure (OPFS unsupported, WASM URL unresolvable) never change within a session. Re-selection would switch to a different physical database (OPFS file vs IndexedDB store), causing apparent data loss. This is an intentional constraint — not a missing feature.

When the offscreen document is recreated (e.g., Chrome evicts it for memory), `SqliteEngineContext` is a new instance and re-selects from scratch.

---

## Repository Changes

After this change, each repository function becomes a single delegation:

```ts
// Before (~30 lines)
export async function insert(record: BrowsingLogRecord) {
  const opfsResult = await engine.tryOpfsProxy('INSERT', record);
  if (opfsResult !== null) return { success: true, id: opfsResult.id };

  if (!engine.dbHandle && !engine.usingFallbackStorage) {
    await engine.init();
  }
  if (engine.usingFallbackStorage && engine.fallbackStorage) {
    return engine.fallbackStorage.insert(record);
  }
  if (!engine.dbHandle) {
    return { success: false, error: 'Database not initialized' };
  }

  const params = buildInsertParams(record, ...);
  await engine.execWithCache(INSERT_SQL, params);
  // ...
}

// After (~5 lines)
export async function insert(record: BrowsingLogRecord) {
  const backend = await engine.getBackend();
  return backend.insert(record);
}
```

---

## Error Handling

All adapters return `{ success: false, error: string }` on failure. Repositories pass through without inspection. Error categorization (transient vs permanent) is done by the adapter internally:

- OpfsWorkerBackend: worker unavailability → "OPFS Worker unavailable"
- IdbVfsBackend: SQL execution failure → original SQLite error message
- FallbackBackend: quota exceeded → "Storage quota exceeded"

---

## Migration Strategy

1. Add `StorageBackend.ts` interface and three adapter files (no existing code changed)
2. Add `getBackend()` to `SqliteEngineContext` (additive)
3. Replace each repository function one at a time, verifying tests after each
4. Remove unused helper methods from `SqliteEngineContext` (`tryOpfsProxy` remains for migration/utility use, not for repos)
5. Remove `FallbackStorage` direct imports from repos (now only accessed through adapter)

---

## Rollback

Each repo function change is independent. Can roll back any function individually by restoring the original four-way branch. No schema or data migration involved — purely code reorganization.

---

## Dependencies

- **Blocks**: PBI #2 (opfsWorker dedup), PBI #5 (shared migrations)
- **Blocked by**: None
- **Parallel with**: PBI #3 (history panel), PBI #4 (error propagation)
