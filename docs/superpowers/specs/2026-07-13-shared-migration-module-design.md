# Design: Shared Migration Module

**Date:** 2026-07-13
**PBI:** [2026-07-13-05-fix-shared-migration-module](../pbi/2026-07-13-05-fix-shared-migration-module.md)
**Status:** Draft
**Depends on:** PBI #1 (StorageBackend Adapter)

---

## Architecture Overview

### Current State (Problem)

Schema migration logic is duplicated between:
- `sqliteEngineContext._doInit()` (lines 253–332): ALTER TABLE loop, FTS5 schema, FTS rebuild
- `opfsWorker.initSqliteInner()` (lines 150–239): Identical ALTER TABLE loop, FTS5 statements, FTS rebuild

Both contain:
- 19-column `newColumns` array — identical
- `ALTER TABLE ADD COLUMN` idempotent loop — identical
- `FTS5_STATEMENTS` execution — already shared via `schema.ts`
- FTS index rebuild logic — nearly identical

Adding a column (e.g., PBI-11's `gist_synced`) required editing both files in lockstep.

### Target State

Single `migrations.ts` module with `runMigrations(engine)`. Both `_doInit()` and `initSqliteInner()` call it.

```
Before:                              After:
sqliteEngineContext.ts                sqliteEngineContext.ts
  _doInit()                            _doInit()
    ├── exec(SCHEMA_SQL)                 ├── exec(SCHEMA_SQL)
    ├── exec(AUDIT_LOG_SCHEMA_SQL)       ├── exec(AUDIT_LOG_SCHEMA_SQL)
    ├── ALTER TABLE obsidian_synced      └── runMigrations(idbEngine)
    ├── ALTER TABLE gist_synced               ↓
    ├── ALTER TABLE content ←┐          migrations.ts
    ├── ALTER TABLE masked... │            runMigrations(engine)
    ...  (19 columns)         │              ├── MIGRATION_COLUMNS
    ├── FTS5_STATEMENTS       │              ├── ALTER TABLE each
    └── FTS rebuild           │              ├── FTS5_STATEMENTS
                              │              └── FTS rebuild if needed
opfsWorker.ts                 │          opfsWorker.ts
  initSqliteInner()           │            initSqliteInner()
    ├── exec(SCHEMA_SQL)      │              ├── exec(SCHEMA_SQL)
    ├── exec(AUDIT_LOG_...)   │              ├── exec(AUDIT_LOG_SCHEMA_SQL)
    ├── ALTER TABLE obsidian  │              └── runMigrations(workerEngine)
    ├── ALTER TABLE gist      │
    ├── ALTER TABLE content ──┘
    ... (19 columns)
    ├── FTS5_STATEMENTS
    └── FTS rebuild
```

---

## MigrationEngine Interface

```ts
// src/offscreen/migrations.ts
export interface MigrationEngine {
  exec(sql: string): Promise<void>;
  queryValue(sql: string): Promise<number | null>;
}
```

Minimal interface — only what migrations need. Two methods, no type parameterization.

### IDB VFS adapter

```ts
const idbEngine: MigrationEngine = {
  exec: async (sql) => {
    await engine.execWithCache(sql, []);
  },
  queryValue: async (sql) => {
    let value: number | null = null;
    await engine.execWithCache(sql, [], (row) => { value = Number(row[0]); });
    return value;
  },
};
```

### OPFS Worker adapter

The Worker provides `SQL_EXEC` / `SQL_QUERY` backdoor message types (added in PBI #1). These accept raw SQL — used only by MigrationEngine for schema operations:

```ts
const workerEngine: MigrationEngine = {
  exec: async (sql) => {
    await engine.sendToOpfsWorker('SQL_EXEC', { sql, params: [] });
  },
  queryValue: async (sql) => {
    const rows = await engine.sendToOpfsWorker('SQL_QUERY', { sql, params: [] }) as SqliteRow[];
    return rows.length > 0 ? Number(Object.values(rows[0]!)[0]) : null;
  },
};
```

---

## runMigrations() Logic

```ts
export async function runMigrations(engine: MigrationEngine): Promise<void> {
  // 1. Schema migrations: apply ALTER TABLE for each column
  for (const colDef of MIGRATION_COLUMNS) {
    try {
      await engine.exec(`ALTER TABLE browsing_logs ADD COLUMN ${colDef}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('duplicate column name')) continue;
      throw err; // Unexpected error — surface it
    }
  }

  // 2. FTS5 schema
  let fts5Available = false;
  try {
    for (const stmt of FTS5_STATEMENTS) {
      await engine.exec(stmt);
    }
    fts5Available = true;
  } catch (err) {
    console.warn('FTS5 unavailable:', errorMessage(err));
  }

  // 3. FTS index rebuild (if base has rows but FTS is empty)
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
}
```

---

## Shared Constants in schema.ts

```ts
// Already exists: SCHEMA_SQL, COLUMN_NAMES, FTS5_SQL, FTS5_STATEMENTS, AUDIT_LOG_SCHEMA_SQL
// New:

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

/** Ordered sequence of one-off migrations (not column additions). */
export const MIGRATION_SEQUENCE = [
  { sql: 'ALTER TABLE browsing_logs ADD COLUMN obsidian_synced INTEGER DEFAULT 0', id: 'obsidian_synced' },
  { sql: 'ALTER TABLE browsing_logs ADD COLUMN gist_synced INTEGER DEFAULT 0', id: 'gist_synced' },
] as const;
```

Both `MIGRATION_COLUMNS` and `MIGRATION_SEQUENCE` are applied in `runMigrations()`, in that order.

---

## Removal from Context Files

After `runMigrations()` is in place, remove from each context:

**sqliteEngineContext.ts**: Delete the `newColumns` array and its ALTER TABLE loop. Delete the FTS5 statement execution loop (already uses `FTS5_STATEMENTS` from `schema.ts`). Replace with `runMigrations(idbEngine)`.

**opfsWorker.ts**: Delete the `newColumns` array. Delete the `obsidian_synced` / `gist_synced` single ALTER TABLE calls. Delete the FTS rebuild logic. Replace with `runMigrations(workerEngine)`.

---

## Dependencies

- **Blocks**: Nothing directly
- **Blocked by**: PBI #1 (StorageBackend adapter — because `MigrationEngine` interface is similar to `StorageBackend.exec()`)
- **Parallel with**: PBI #2 (opfsWorker type dedup — both touch opfsWorker imports)
