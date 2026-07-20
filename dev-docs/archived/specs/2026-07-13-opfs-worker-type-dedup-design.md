# Design: opfsWorker.ts Type and Migration Deduplication

**Date:** 2026-07-13
**Status:** Implemented (2026-07-13) — v6.5.27
**PBI:** [2026-07-13-02-fix-opfs-worker-type-dedup](../pbi/2026-07-13-02-fix-opfs-worker-type-dedup.md)
**Depends on:** PBI #1 (StorageBackend Adapter)

---

## Architecture Overview

### Current State (Problem)

`opfsWorker.ts` (970 lines) contains inline copies of:
- `BrowsingLogRecord` interface (56 lines) — duplicated from `sqlite-types.ts`
- `SearchResultRecord`, `QueryPayload`, `SearchPayload` interfaces — duplicated types
- ALTER TABLE migration columns (19 entries) — duplicated from `sqliteEngineContext.ts`
- FTS rebuild logic — duplicated init sequence

Adding a column to `browsing_logs` requires editing 3 files. PBI-11 (gist_synced) exposed this drift.

### Target State

Worker imports shared types from `sqlite-types.ts` and shared migrations from `migrations.ts` (PBI #5). No inline type definitions remain.

```
Before:
  opfsWorker.ts
    ├── interface BrowsingLogRecord { ... 56 lines }     ← duplicated
    ├── const newColumns = ['content TEXT', ...]          ← duplicated
    └── same FTS rebuild logic as engineContext

After:
  opfsWorker.ts
    ├── import { BrowsingLogRecord } from '../utils/sqlite-types.js'
    ├── import { runMigrations } from './migrations.js'
    └── init → runMigrations(migrationEngine)
```

---

## Changes

### 1. Remove inline type definitions

Delete from `opfsWorker.ts`:
- `interface BrowsingLogRecord` (lines 22–56)
- `interface SearchResultRecord` (lines 58–70)
- `interface QueryPayload` (lines 77–88)
- `interface SearchPayload` (lines 90–94)

Replace with:
```ts
import type { BrowsingLogRecord, BrowsingLogEntry, SearchResult } from '../utils/sqlite-types.js';
```

Note: `sqlite-types.ts` already exports these. The worker can import them via ESM — WXT/Vite resolves the path during bundling.

### 2. Use shared migrations

The ALTER TABLE migration loop in `initSqliteInner()` (lines 221–232 in `opfsWorker.ts`) is replaced by:
```ts
await runMigrations({
  exec: (sql: string) => sqlExec(sql),
  queryValue: (sql: string) => engine!.queryValue(sql),
});
```

The migration engine interface is defined in `migrations.ts` (see PBI #5 design).

### 3. Verify ESM compatibility

Worker imports use `.js` extension (TypeScript ESM resolution):
```ts
// ✅ Correct
import type { BrowsingLogRecord } from '../utils/sqlite-types.js';
import { runMigrations } from './migrations.js';

// ❌ Wrong
import type { BrowsingLogRecord } from '../utils/sqlite-types.ts';
```

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Worker ESM import fails at bundle time | Low | WXT/Vite already resolves worker imports; `schema.ts` is already imported by the worker |
| Type mismatch between `sqlite-types.ts` and worker usage | Low | `npm run type-check` catches all mismatches |
| Run-time import failure | None | Type-only imports (`import type`) are erased at compile time |

---

## Rollback

Restore deleted inline interfaces. No data or schema changes involved — purely import restructuring.

---

## Dependencies

- **Blocks**: Nothing directly
- **Blocked by**: PBI #1 (adapter interface stabilizes types), PBI #5 (shared migrations module)
- **Parallel with**: PBI #5 (can implement migrations.ts and then apply to both backends)
