# dashboardSqliteHandlers 3分割 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **軽量モデル向け注記:** 各タスクのコードブロックは完成品です。判断・要約・書き換えをせず、指定されたファイルパスにそのままコピー＆ペーストしてください。「〜のように実装する」という指示文は無く、常に「このコードをこのパスに書く」という指示のみです。

**Goal:** `src/background/handlers/dashboardSqliteHandlers.ts` の `createDashboardSqliteHandler` にある17分岐switch文を、性質（関心事）で3つのサブハンドラ（read-only / coreCrud / maintenanceBatch）に分割し、トークンチェックのみをルーター層に残す。

**Architecture:** `src/background/handlers/dashboardSqlite/` ディレクトリを新設し、`index.ts`（ルーター）+ `readOnlyHandler.ts` + `coreCrudHandler.ts` + `maintenanceBatchHandler.ts` + `deps.ts`（Deps型定義と`createSqliteClientDeps`）に分割する。既存の `src/background/handlers/dashboardSqliteHandlers.ts` は新ディレクトリからの re-export のみを行う薄いファイルとして残し、`service-worker.ts` や全テストファイルの既存import文を一切変更しない。外部インターフェース `createDashboardSqliteHandler(deps): (payload) => Promise<unknown>` は完全に不変。

**Tech Stack:** TypeScript (ESM, `.js`拡張子import), Vitest

---

## 前提となる事実（読み飛ばし厳禁）

1. `src/messaging/sqliteOperationSecurity.ts` が `TOKEN_REQUIRED_SUBTYPES` の唯一の真実源。**このファイルは変更しない。**
2. 分割後もテストファイルは**1文字も変更しない**。以下の4ファイルは絶対に編集しないこと:
   - `src/background/handlers/__tests__/dashboardSqliteHandlers-extra.test.ts`
   - `src/background/handlers/__tests__/dashboardSqliteHandlers-lastError.test.ts`
   - `src/background/handlers/__tests__/dashboardSqliteHandlers-token-guard.test.ts`
   - `src/background/handlers/__tests__/dashboardSqliteHandlers-wiring.test.ts`
   - `src/background/handlers/__tests__/dashboardSqliteTestHarness.ts`
3. 以下のファイルも**変更しない**（importパスが変わらないことを前提にしている）:
   - `src/background/service-worker.ts`
   - `src/background/handlers/dashboardSqliteProtocol.ts`
4. Task 1〜5では**新規ファイルの作成のみ**を行う。既存ファイル `src/background/handlers/dashboardSqliteHandlers.ts` を書き換えるのは Task 5 Step 2 のみ。それまでは既存ファイルに一切触れないこと（新旧の実装が一時的に共存しても構わない。型チェックがTask 4まで通らなくても正常）。

---

## 20 subtypeの3分類（この表の通りに実装する。追加・削除・移動は禁止）

| グループ | ファイル | subtype一覧（順不同ではなく記載順でswitch文に書く） |
|---|---|---|
| readOnly | `readOnlyHandler.ts` | `confirm_token`, `query`, `search`, `get_count`, `status`, `opfs_spike`, `audit_log_query` |
| coreCrud | `coreCrudHandler.ts` | `toggle_star`, `delete`, `update`, `clear_all`, `append_to_obsidian` |
| maintenanceBatch | `maintenanceBatchHandler.ts` | `migrate`, `import`, `restore_db`, `backup_db`, `backfill_metadata`, `cleanup_legacy`, `purge_now`, `content_purge_now` |

合計 7 + 5 + 8 = 20。

---

## File Structure（最終形）

```
src/background/handlers/
  dashboardSqliteHandlers.ts          # Task 5 Step 2 で書き換え（既存パス維持）
  dashboardSqlite/                     # Task 1〜5 で新規作成
    deps.ts
    readOnlyHandler.ts
    coreCrudHandler.ts
    maintenanceBatchHandler.ts
    index.ts
  __tests__/                           # 変更しない
```

`manifest.json` の `web_accessible_resources` 更新は不要（`src/background/` はservice worker側のコードであり、content scriptからの動的import対象ではない）。この点についてタスクは発生しない。

---

### Task 1: `deps.ts` を新規作成する

**Files:**
- Create: `src/background/handlers/dashboardSqlite/deps.ts`（新規ファイル。既存ファイルの変更は無し）

- [ ] **Step 1: 以下のファイル内容をそのまま `src/background/handlers/dashboardSqlite/deps.ts` として新規作成する**

```typescript
import { StorageKeys, getSettings } from '../../../utils/storage.js';
import { formatEntriesToMarkdown } from '../../../dashboard/obsidianFormatter.js';
import { ObsidianClient } from '../../obsidianClient.js';
import type { BrowsingLogEntry } from '../../../utils/sqlite-types.js';
import { bytesToBase64, base64ToBytes } from '../../../utils/crypto/index.js';
import type { CallResult, SqliteError } from '../../sqliteClient.js';

export const ALLOWED_UPDATE_FIELDS = ['url', 'title', 'summary', 'tags', 'domain', 'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted', 'obsidian_synced'];
export const MAX_APPEND_IDS = 100;
// VULN-006: cap bulk import rows to prevent SW/offscreen queue saturation
// (the append path already caps at MAX_APPEND_IDS).
export const MAX_IMPORT_ROWS = 5000;

/**
 * Every result the SqliteClient-backed deps return carries its own failure
 * reason. The call that produced the failure is the only place that knows
 * why it failed, so the reason travels with the return value instead of
 * being read back out of shared state afterward.
 */
export type DepsResult<T> = CallResult<T>;

/**
 * Common failure mapping: every *Result deps call classifies its failure
 * (kind, message, retriable), so the handler only forwards the message and
 * retriable flag instead of reinterpreting them per case.
 */
export function toFailure(result: { success: false; error: SqliteError }): { success: false; error: string; retriable: boolean } {
  return { success: false, error: result.error.message, retriable: result.error.retriable };
}

/** Deps consumed by the read-only subtype group (never mutates, never needs a confirmToken). */
export interface ReadOnlyDeps {
  query: (params: Record<string, unknown>) => Promise<DepsResult<{ rows: unknown[]; total: number }>>;
  search: (query: string, limit: number, offset: number, options?: { orderBy?: 'rank' | 'created_at'; orderDir?: 'ASC' | 'DESC' }) => Promise<DepsResult<{ rows: unknown[]; total: number }>>;
  getCount: () => Promise<DepsResult<number>>;
  /**
   * Deliberately not a DepsResult: getStatus() reports initialization
   * failure inside its success value (as `initError`) so the diagnostics
   * panel can display it, rather than as a DepsResult failure — see
   * SqliteClient.getStatus().
   */
  getStatus: () => Promise<Record<string, unknown> | null>;
  runOpfsSpike: () => Promise<DepsResult<Record<string, unknown>>>;
  queryAuditLog: (options: { limit?: number; offset?: number }) => Promise<DepsResult<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number }>>;
  getConfirmToken: () => Promise<string>;
}

/** Deps consumed by the everyday dashboard mutation group (toggle_star/delete/update/clear_all/append_to_obsidian). */
export interface CoreCrudDeps {
  toggleStar: (id: number) => Promise<DepsResult<{ is_starred: number }>>;
  delete: (id: number) => Promise<DepsResult<void>>;
  update: (id: number, changes: Record<string, unknown>) => Promise<DepsResult<void>>;
  clearAll: () => Promise<DepsResult<void>>;
  query: (params: Record<string, unknown>) => Promise<DepsResult<{ rows: unknown[]; total: number }>>;
  getSettings: () => Promise<Record<string, unknown>>;
  formatEntriesToMarkdown: (entries: BrowsingLogEntry[]) => string | null;
  appendToDailyNote: (markdown: string) => Promise<void>;
}

/** Deps consumed by the maintenance/migration/backup group. */
export interface MaintenanceBatchDeps {
  insert: (record: Record<string, unknown>) => Promise<DepsResult<{ id: number }>>;
  getSettings: () => Promise<Record<string, unknown>>;
  restoreDb: (data: Uint8Array) => Promise<DepsResult<void>>;
  purgeOldRecords: (days?: number, max?: number) => Promise<DepsResult<{ purged: number }>>;
  purgeContent: (days?: number, max?: number, includeStarred?: boolean) => Promise<DepsResult<{ purged: number }>>;
  backupDb: () => Promise<DepsResult<Uint8Array>>;
  runMigration: () => Promise<
    | { success: true; count: number; read: number; inserted: number; error?: string }
    | { success: false; error?: string; count?: number; read?: number; inserted?: number }
  >;
  runBackfill: () => Promise<{ updated: number; total: number }>;
  runCleanup: () => Promise<{ removed: string[]; totalBytes: number }>;
}

/** Union of the three groups — what createDashboardSqliteHandler needs as a whole. Unchanged external shape. */
export type DashboardSqliteHandlerDeps = ReadOnlyDeps & CoreCrudDeps & MaintenanceBatchDeps;

/**
 * The operations this handler needs that a SqliteClient can supply.
 *
 * Everything outside this set (migration, confirm tokens, backfill, cleanup)
 * is owned by the Service Worker and has to be passed in separately.
 */
export interface SqliteClientBackedDeps {
  runMigration: DashboardSqliteHandlerDeps['runMigration'];
  getConfirmToken: DashboardSqliteHandlerDeps['getConfirmToken'];
  runBackfill: DashboardSqliteHandlerDeps['runBackfill'];
  runCleanup: DashboardSqliteHandlerDeps['runCleanup'];
}

/**
 * Builds the handler's dependencies from a SqliteClient.
 *
 * Both the Service Worker and the tests go through this, so there is one
 * answer to "how is this handler wired". Previously the two were assembled
 * independently and had drifted: the test-only wrapper stubbed migration,
 * confirm-token, backfill and cleanup, so the Service Worker's real
 * implementations of those four were never exercised by any test.
 */
export function createSqliteClientDeps(
  sqliteClient: import('../../sqliteClient.js').SqliteClient,
  serviceWorkerDeps: SqliteClientBackedDeps,
): DashboardSqliteHandlerDeps {
  return {
    // Every *Result variant keeps the failure reason attached to the call
    // that produced it, rather than routing it through shared client state.
    query: (params) => sqliteClient.queryResult(params),
    search: (query, limit, offset, options) => sqliteClient.searchResult(query, limit, offset, options),
    toggleStar: (id) => sqliteClient.toggleStarResult(id),
    delete: (id) => sqliteClient.deleteResult(id),
    update: (id, changes) => sqliteClient.updateResult(id, changes),
    getCount: () => sqliteClient.getCountResult(),
    clearAll: () => sqliteClient.clearAllResult(),
    insert: (record) => sqliteClient.insertResult(record as any),
    restoreDb: (data) => sqliteClient.restoreDbResult(data),
    // Deliberately not *Result: getStatus() reports initialization failure
    // inside its success value so the diagnostics panel can display it.
    getStatus: () => sqliteClient.getStatus(),
    runOpfsSpike: () => sqliteClient.runOpfsSpikeResult() as Promise<DepsResult<Record<string, unknown>>>,
    purgeOldRecords: (days, max) => sqliteClient.purgeOldRecordsResult(days, max),
    purgeContent: (days, max, includeStarred) => sqliteClient.purgeContentResult(days, max, includeStarred),
    backupDb: () => sqliteClient.backupDbResult(),
    getSettings: () => getSettings(),
    formatEntriesToMarkdown: (entries) => formatEntriesToMarkdown(entries),
    queryAuditLog: (options) => sqliteClient.queryAuditLogResult(options),
    appendToDailyNote: async (markdown) => {
      const obsidianClient = new ObsidianClient();
      await obsidianClient.appendToDailyNote(markdown);
    },
    ...serviceWorkerDeps,
  };
}
```

- [ ] **Step 2: ファイルが存在することを確認する**

Run: `test -f src/background/handlers/dashboardSqlite/deps.ts && echo "OK: file exists"`
Expected出力: `OK: file exists`

もし `OK: file exists` が表示されなければ、Step 1のファイル作成をやり直すこと。ここで先に進んではいけない。

- [ ] **Step 3: git add してコミットする（この時点でビルド確認はしない。Task 5完了後にまとめて確認する）**

以下のコマンドをこの順番のまま実行する:

```bash
git add src/background/handlers/dashboardSqlite/deps.ts
```

```bash
git commit -m "refactor(dashboard-sqlite): deps.tsにDeps型とcreateSqliteClientDepsを分離"
```

---

### Task 2: `readOnlyHandler.ts` を新規作成する

**Files:**
- Create: `src/background/handlers/dashboardSqlite/readOnlyHandler.ts`（新規ファイル）

- [ ] **Step 1: 以下のファイル内容をそのまま `src/background/handlers/dashboardSqlite/readOnlyHandler.ts` として新規作成する**

```typescript
import { logError, ErrorCode } from '../../../utils/logger.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import type { DashboardSqliteRequest } from '../dashboardSqliteProtocol.js';
import type { ReadOnlyDeps } from './deps.js';
import { toFailure } from './deps.js';

export function createReadOnlyHandler(deps: ReadOnlyDeps) {
  return async (payload: DashboardSqliteRequest): Promise<unknown> => {
    const subtype = payload.subtype;
    try {
      switch (subtype) {
        case 'confirm_token': {
          const token = await deps.getConfirmToken();
          if (!token) {
            return { success: false, error: 'Confirm token not available' };
          }
          return { success: true, confirmToken: token };
        }
        case 'query': {
          const result = await deps.query({
            limit: payload.limit ?? 100,
            offset: payload.offset ?? 0,
            domain: payload.domain,
            isStarred: payload.isStarred,
            since: payload.since,
            until: payload.until,
            orderBy: payload.orderBy || 'created_at',
            orderDir: payload.orderDir || 'DESC',
            tagFilter: payload.tagFilter,
          });
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true, rows: result.data.rows, total: result.data.total };
        }
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
        case 'get_count': {
          const result = await deps.getCount();
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true, count: result.data };
        }
        case 'status': {
          const status = await deps.getStatus();
          if (status) {
            return { success: true, ...status };
          }
          // Unreachable via a real SqliteClient (getStatus() always resolves
          // to an object, even on failure — see its doc comment), but the
          // type keeps `| null` since deps.getStatus is not a DepsResult.
          return { success: false, error: 'Status check failed' };
        }
        case 'opfs_spike': {
          const result = await deps.runOpfsSpike();
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true, report: result.data };
        }
        case 'audit_log_query': {
          const result = await deps.queryAuditLog({
            limit: payload.limit,
            offset: payload.offset,
          });
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true, rows: result.data.rows, total: result.data.total };
        }
        default:
          return { success: false, error: `Unknown subtype: ${subtype}` };
      }
    } catch (error) {
      logError('Dashboard SQLite error', {
        subtype,
        error: errorMessage(error),
      }, ErrorCode.UNKNOWN_ERROR);
      return { success: false, error: 'An internal error occurred' };
    }
  };
}
```

- [ ] **Step 2: ファイルが存在することを確認する**

Run: `test -f src/background/handlers/dashboardSqlite/readOnlyHandler.ts && echo "OK: file exists"`
Expected出力: `OK: file exists`

- [ ] **Step 3: コミットする**

```bash
git add src/background/handlers/dashboardSqlite/readOnlyHandler.ts
```

```bash
git commit -m "refactor(dashboard-sqlite): readOnlyHandlerを分離"
```

---

### Task 3: `coreCrudHandler.ts` を新規作成する

**Files:**
- Create: `src/background/handlers/dashboardSqlite/coreCrudHandler.ts`（新規ファイル）

- [ ] **Step 1: 以下のファイル内容をそのまま `src/background/handlers/dashboardSqlite/coreCrudHandler.ts` として新規作成する**

```typescript
import { logError, logInfo, ErrorCode } from '../../../utils/logger.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { StorageKeys } from '../../../utils/storage.js';
import type { BrowsingLogEntry } from '../../../utils/sqlite-types.js';
import type { DashboardSqliteRequest } from '../dashboardSqliteProtocol.js';
import type { CoreCrudDeps } from './deps.js';
import { toFailure, ALLOWED_UPDATE_FIELDS, MAX_APPEND_IDS } from './deps.js';

export function createCoreCrudHandler(deps: CoreCrudDeps) {
  return async (payload: DashboardSqliteRequest): Promise<unknown> => {
    const subtype = payload.subtype;
    try {
      switch (subtype) {
        case 'toggle_star': {
          const result = await deps.toggleStar(payload.id);
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true, ...result.data };
        }
        case 'delete': {
          const result = await deps.delete(payload.id);
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true };
        }
        case 'update': {
          const changes = payload.changes || {};
          const invalidKeys = Object.keys(changes).filter((k) => !ALLOWED_UPDATE_FIELDS.includes(k));
          if (invalidKeys.length > 0) {
            return { success: false, error: `Invalid update fields: ${invalidKeys.join(', ')}` };
          }
          const result = await deps.update(payload.id, changes);
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true };
        }
        case 'clear_all': {
          const result = await deps.clearAll();
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true };
        }
        case 'append_to_obsidian': {
          const ids = payload.ids;
          // Check 1: array shape
          if (!Array.isArray(ids) || ids.length === 0) {
            return { success: false, error: 'No IDs provided' };
          }
          // Check 2: upper bound (before type check — safe on length property)
          if (ids.length > MAX_APPEND_IDS) {
            return { success: false, error: `Maximum ${MAX_APPEND_IDS} IDs allowed` };
          }
          // Check 3: all elements are finite numbers (safe — at most 100 elements)
          if (!ids.every((id: unknown): id is number => typeof id === 'number' && Number.isFinite(id))) {
            return { success: false, error: 'All IDs must be finite numbers' };
          }

          const allSettings = await deps.getSettings();
          const apiKey = allSettings[StorageKeys.OBSIDIAN_API_KEY] as string | undefined;
          if (!apiKey || apiKey.length < 16) {
            return { success: false, error: 'Obsidian API key not configured' };
          }

          const allResult = await deps.query({ ids, limit: ids.length, orderBy: 'id', orderDir: 'ASC' });
          if (!allResult.success) {
            // Report the read failure rather than letting it fall through to
            // "No matching entries found", which suggests the ids were wrong.
            return { success: false, error: allResult.error.message };
          }
          const selectedEntries = allResult.data.rows as BrowsingLogEntry[];

          if (selectedEntries.length === 0) {
            return { success: false, error: 'No matching entries found' };
          }

          const markdown = deps.formatEntriesToMarkdown(selectedEntries);
          if (!markdown) {
            return { success: false, error: 'Failed to format entries' };
          }

          try {
            await deps.appendToDailyNote(markdown);
            logInfo('Appended entries to Obsidian', { count: selectedEntries.length });
            return { success: true, appended: selectedEntries.length };
          } catch (error) {
            logError('Failed to append to Obsidian', {
              error: errorMessage(error),
              count: selectedEntries.length,
            }, ErrorCode.UNKNOWN_ERROR);
            return { success: false, error: errorMessage(error) };
          }
        }
        default:
          return { success: false, error: `Unknown subtype: ${subtype}` };
      }
    } catch (error) {
      logError('Dashboard SQLite error', {
        subtype,
        error: errorMessage(error),
      }, ErrorCode.UNKNOWN_ERROR);
      return { success: false, error: 'An internal error occurred' };
    }
  };
}
```

- [ ] **Step 2: ファイルが存在することを確認する**

Run: `test -f src/background/handlers/dashboardSqlite/coreCrudHandler.ts && echo "OK: file exists"`
Expected出力: `OK: file exists`

- [ ] **Step 3: コミットする**

```bash
git add src/background/handlers/dashboardSqlite/coreCrudHandler.ts
```

```bash
git commit -m "refactor(dashboard-sqlite): coreCrudHandlerを分離"
```

---

### Task 4: `maintenanceBatchHandler.ts` を新規作成する

**Files:**
- Create: `src/background/handlers/dashboardSqlite/maintenanceBatchHandler.ts`（新規ファイル）

- [ ] **Step 1: 以下のファイル内容をそのまま `src/background/handlers/dashboardSqlite/maintenanceBatchHandler.ts` として新規作成する**

```typescript
import { logError, ErrorCode } from '../../../utils/logger.js';
import { errorMessage } from '../../../utils/errorUtils.js';
import { StorageKeys } from '../../../utils/storage.js';
import type { DashboardSqliteRequest } from '../dashboardSqliteProtocol.js';
import type { SqliteError } from '../../sqliteClient.js';
import { bytesToBase64, base64ToBytes } from '../../../utils/crypto/index.js';
import type { MaintenanceBatchDeps } from './deps.js';
import { toFailure, MAX_IMPORT_ROWS } from './deps.js';

export function createMaintenanceBatchHandler(deps: MaintenanceBatchDeps) {
  return async (payload: DashboardSqliteRequest): Promise<unknown> => {
    const subtype = payload.subtype;
    try {
      switch (subtype) {
        case 'migrate': {
          const migrateResult = await deps.runMigration();
          return migrateResult.success
            ? { success: true, count: migrateResult.count, read: migrateResult.read, inserted: migrateResult.inserted, error: migrateResult.error }
            : { success: false, error: migrateResult.error || 'Migration failed' };
        }
        case 'import': {
          const rows = payload.rows;
          if (!Array.isArray(rows) || rows.length === 0) {
            return { success: false, error: 'No rows provided' };
          }
          // VULN-006: reject oversized collections instead of looping unbounded.
          if (rows.length > MAX_IMPORT_ROWS) {
            return { success: false, error: `Maximum ${MAX_IMPORT_ROWS} rows allowed` };
          }
          const BATCH = 50;
          let inserted = 0;
          let skipped = 0;
          // Kept in a local instead of shared state: the reason belongs to
          // this call, not to whatever else on the client failed most
          // recently — see the module doc comment in deps.ts.
          let lastInsertError: SqliteError | null = null;
          for (let i = 0; i < rows.length; i += BATCH) {
            const batch = rows.slice(i, i + BATCH);
            for (const row of batch) {
              try {
                const result = await deps.insert({
                  url: row.url,
                  title: row.title ?? null,
                  summary: row.summary ?? null,
                  tags: row.tags ?? null,
                  created_at: row.created_at,
                  domain: row.domain ?? null,
                  visit_duration: row.visit_duration ?? null,
                  scroll_ratio: row.scroll_ratio ?? null,
                  is_starred: row.is_starred ?? 0,
                  is_deleted: row.is_deleted ?? 0,
                });
                if (result.success) {
                  inserted++;
                } else {
                  skipped++;
                  lastInsertError = result.error;
                }
              } catch {
                skipped++;
              }
            }
          }
          if (lastInsertError && inserted === 0) {
            return { success: false, error: lastInsertError.message };
          }
          return { success: true, inserted, skipped, total: rows.length };
        }
        case 'restore_db': {
          const data = payload.data;
          if (typeof data !== 'string' || data.length === 0) {
            return { success: false, error: 'No data provided' };
          }
          // VULN-008 fix: reject oversized base64 payload before decoding
          // 100MB raw → ~134MB base64; use 150MB base64 as safe ceiling
          const MAX_RESTORE_BASE64_LENGTH = 150 * 1024 * 1024;
          if (data.length > MAX_RESTORE_BASE64_LENGTH) {
            return { success: false, error: `Restore data exceeds maximum size (${Math.round(data.length / 1024 / 1024)}MB > 100MB)` };
          }
          const result = await deps.restoreDb(base64ToBytes(data));
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true };
        }
        case 'purge_now': {
          const settings = await deps.getSettings();
          const days = settings[StorageKeys.SQLITE_RETENTION_DAYS] ?? null;
          const max  = settings[StorageKeys.SQLITE_MAX_RECORDS]    ?? null;
          if (days === null && max === null) {
            return { success: true, purged: 0, skipped: true };
          }
          const result = await deps.purgeOldRecords(
            days !== null ? Number(days) : undefined,
            max  !== null ? Number(max)  : undefined,
          );
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true, purged: result.data.purged, skipped: false };
        }
        case 'content_purge_now': {
          const settings = await deps.getSettings();
          const contentDays = settings[StorageKeys.CONTENT_RETENTION_DAYS] ?? null;
          const contentMax  = settings[StorageKeys.CONTENT_MAX_RECORDS]    ?? null;
          const includeStarred = settings[StorageKeys.CONTENT_PURGE_INCLUDE_STARRED] as boolean | undefined ?? false;
          if (contentDays === null && contentMax === null) {
            return { success: true, purged: 0, skipped: true };
          }
          const result = await deps.purgeContent(
            contentDays !== null ? Number(contentDays) : undefined,
            contentMax  !== null ? Number(contentMax)  : undefined,
            includeStarred,
          );
          if (!result.success) {
            return toFailure(result);
          }
          return { success: true, purged: result.data.purged, skipped: false };
        }
        case 'backup_db': {
          const result = await deps.backupDb();
          if (result.success) {
            return { success: true, data: bytesToBase64(result.data) };
          }
          return toFailure(result);
        }
        case 'backfill_metadata': {
          try {
            const backfillResult = await deps.runBackfill();
            return { success: true, ...backfillResult };
          } catch {
            return { success: false, error: 'Backfill not available' };
          }
        }
        case 'cleanup_legacy': {
          try {
            const cleanupResult = await deps.runCleanup();
            return { success: true, ...cleanupResult };
          } catch {
            return { success: false, error: 'Cleanup not available' };
          }
        }
        default:
          return { success: false, error: `Unknown subtype: ${subtype}` };
      }
    } catch (error) {
      logError('Dashboard SQLite error', {
        subtype,
        error: errorMessage(error),
      }, ErrorCode.UNKNOWN_ERROR);
      return { success: false, error: 'An internal error occurred' };
    }
  };
}
```

- [ ] **Step 2: ファイルが存在することを確認する**

Run: `test -f src/background/handlers/dashboardSqlite/maintenanceBatchHandler.ts && echo "OK: file exists"`
Expected出力: `OK: file exists`

- [ ] **Step 3: コミットする**

```bash
git add src/background/handlers/dashboardSqlite/maintenanceBatchHandler.ts
```

```bash
git commit -m "refactor(dashboard-sqlite): maintenanceBatchHandlerを分離"
```

---

### Task 5: ルーター `index.ts` を新規作成し、既存 `dashboardSqliteHandlers.ts` を書き換える

このタスクは2つのファイル操作からなる。**必ず Step 1 → Step 2 の順に行うこと。**

**Files:**
- Create: `src/background/handlers/dashboardSqlite/index.ts`（新規ファイル）
- Modify: `src/background/handlers/dashboardSqliteHandlers.ts`（既存ファイルの中身を全部消して置き換える）

- [ ] **Step 1: 以下のファイル内容をそのまま `src/background/handlers/dashboardSqlite/index.ts` として新規作成する**

```typescript
import { logError, ErrorCode } from '../../../utils/logger.js';
import { TOKEN_REQUIRED_SUBTYPES } from '../../../messaging/sqliteOperationSecurity.js';
import type { DashboardSqliteRequest, DashboardSqliteSubtype } from '../dashboardSqliteProtocol.js';
import type { DashboardSqliteHandlerDeps } from './deps.js';
import { createReadOnlyHandler } from './readOnlyHandler.js';
import { createCoreCrudHandler } from './coreCrudHandler.js';
import { createMaintenanceBatchHandler } from './maintenanceBatchHandler.js';

/** Which of the three sub-handlers owns each subtype. Single source of truth for the routing decision. */
const READ_ONLY_SUBTYPES: ReadonlySet<DashboardSqliteSubtype> = new Set([
  'confirm_token', 'query', 'search', 'get_count', 'status', 'opfs_spike', 'audit_log_query',
]);
const CORE_CRUD_SUBTYPES: ReadonlySet<DashboardSqliteSubtype> = new Set([
  'toggle_star', 'delete', 'update', 'clear_all', 'append_to_obsidian',
]);
// Everything else (migrate, import, restore_db, backup_db, backfill_metadata,
// cleanup_legacy, purge_now, content_purge_now) falls through to maintenance.
// An unrecognised subtype string also falls through here, and is reported by
// maintenanceBatchHandler's own `default` case.

export function createDashboardSqliteHandler(deps: DashboardSqliteHandlerDeps) {
  const readOnlyHandler = createReadOnlyHandler(deps);
  const coreCrudHandler = createCoreCrudHandler(deps);
  const maintenanceBatchHandler = createMaintenanceBatchHandler(deps);

  return async (
    payload: DashboardSqliteRequest & { confirmToken?: string },
  ): Promise<unknown> => {
    const subtype = payload.subtype;

    if (TOKEN_REQUIRED_SUBTYPES.has(subtype)) {
      const providedToken = payload.confirmToken;
      const validConfirmToken = await deps.getConfirmToken();
      if (!providedToken || providedToken !== validConfirmToken) {
        logError(
          'Dashboard SQLite: token mismatch',
          { subtype, hasToken: Boolean(providedToken) },
          ErrorCode.INTERNAL_ERROR,
        );
        return { success: false, error: 'Confirmation token mismatch' };
      }
    }

    if (READ_ONLY_SUBTYPES.has(subtype)) {
      return readOnlyHandler(payload);
    }
    if (CORE_CRUD_SUBTYPES.has(subtype)) {
      return coreCrudHandler(payload);
    }
    return maintenanceBatchHandler(payload);
  };
}

export {
  type DashboardSqliteHandlerDeps,
  type ReadOnlyDeps,
  type CoreCrudDeps,
  type MaintenanceBatchDeps,
  type SqliteClientBackedDeps,
  type DepsResult,
  createSqliteClientDeps,
  toFailure,
  ALLOWED_UPDATE_FIELDS,
  MAX_APPEND_IDS,
  MAX_IMPORT_ROWS,
} from './deps.js';
```

- [ ] **Step 2: `src/background/handlers/dashboardSqliteHandlers.ts` の中身を全部削除し、以下の内容だけに置き換える**

このファイルは既に存在する。中身を全て消してから、以下を書く（既存の17分岐switchのコードは全て削除する。deps.ts / readOnlyHandler.ts / coreCrudHandler.ts / maintenanceBatchHandler.ts / index.ts に既に移植済みなので、ここに残す必要はない）。

```typescript
/**
 * Thin re-export. The implementation lives in ./dashboardSqlite/ — split into
 * a router plus three sub-handlers grouped by concern (read-only / core CRUD /
 * maintenance batch). This file exists only so existing import paths
 * (service-worker.ts, __tests__/*) keep working unchanged.
 */
export {
  createDashboardSqliteHandler,
  type DashboardSqliteHandlerDeps,
  type SqliteClientBackedDeps,
  type DepsResult,
  createSqliteClientDeps,
} from './dashboardSqlite/index.js';
```

- [ ] **Step 3: 新規ファイルが存在することを確認する**

Run: `test -f src/background/handlers/dashboardSqlite/index.ts && echo "OK: file exists"`
Expected出力: `OK: file exists`

- [ ] **Step 4: `dashboardSqliteHandlers.ts` の行数が20行以下になっていることを確認する（switch文が残っていると100行を超える）**

Run: `wc -l src/background/handlers/dashboardSqliteHandlers.ts`
Expected: 20以下の数値が表示される。20を超える場合はStep 2をやり直す（既存コードの消し残しがある）。

- [ ] **Step 5: 型チェックを実行する**

Run: `npx tsc --noEmit -p .`
Expected: 何もエラーが出力されない（コマンドが正常終了する）。

エラーが出た場合、エラーメッセージに含まれるファイル名を見て、対応するTaskに戻って該当ファイルの内容を見直すこと。よくあるエラー原因:
- `Cannot find module './deps.js'` 等 → importパスのタイプミス。Task 1〜4のコードブロックをコピー＆ペーストし直す（手打ちしない）。
- `Property 'xxx' does not exist on type` → コードブロックの一部を書き換えてしまっている可能性がある。Task 1〜5のコードブロックを再度そのままコピーし直す。

- [ ] **Step 6: コミットする**

```bash
git add src/background/handlers/dashboardSqlite/index.ts src/background/handlers/dashboardSqliteHandlers.ts
```

```bash
git commit -m "refactor(dashboard-sqlite): ルーターを実装し、17分岐switchを3サブハンドラに分割"
```

---

### Task 6: 既存テストが全てgreenであることを確認する

このタスクでは**コードを一切書かない**。コマンドを実行して結果を確認するだけ。

**Files:**
- 変更対象なし。以下は実行のみ:
  - `src/background/handlers/__tests__/dashboardSqliteHandlers-extra.test.ts`
  - `src/background/handlers/__tests__/dashboardSqliteHandlers-lastError.test.ts`
  - `src/background/handlers/__tests__/dashboardSqliteHandlers-token-guard.test.ts`
  - `src/background/handlers/__tests__/dashboardSqliteHandlers-wiring.test.ts`

- [ ] **Step 1: 4つのテストファイルを実行する**

Run:
```bash
npx vitest run src/background/handlers/__tests__/dashboardSqliteHandlers-extra.test.ts src/background/handlers/__tests__/dashboardSqliteHandlers-lastError.test.ts src/background/handlers/__tests__/dashboardSqliteHandlers-token-guard.test.ts src/background/handlers/__tests__/dashboardSqliteHandlers-wiring.test.ts
```

Expected: 出力の末尾に `Test Files  4 passed (4)` のような、4ファイル全てpassedと表示される行が出る。1つでも failed があってはならない。

- [ ] **Step 2: テストが失敗した場合の対応表**

以下の表を上から順に確認し、失敗しているテストの説明文（`it(...)`の第一引数の文字列）に一致する行を探し、「疑うべきファイル」に書かれたファイルを、対応するTaskのコードブロックで**再度そのままコピーし直す**（自分で修正しようとしない）。

| 失敗したテストの説明文に含まれる単語 | 疑うべきファイル | 対応するTask |
|---|---|---|
| `query`, `search`, `get_count`, `status`, `opfs_spike`, `audit_log_query`, `confirm_token` | `src/background/handlers/dashboardSqlite/readOnlyHandler.ts` | Task 2 |
| `toggle_star`, `delete`, `update`, `clear_all` | `src/background/handlers/dashboardSqlite/coreCrudHandler.ts` | Task 3 |
| `import`, `restore_db`, `backup_db`, `backfill_metadata`, `cleanup_legacy`, `migrate`, `purge_now`, `content_purge_now` | `src/background/handlers/dashboardSqlite/maintenanceBatchHandler.ts` | Task 4 |
| `token`, `confirmToken`, `Confirmation` | `src/background/handlers/dashboardSqlite/index.ts` | Task 5 |
| `unknown subtype`, `catch block` | `src/background/handlers/dashboardSqlite/maintenanceBatchHandler.ts` の `default` 節、または `index.ts` のグループ判定 | Task 4 / Task 5 |

再コピー後は Step 1 のコマンドを再実行し、再度確認する。

- [ ] **Step 3: プロジェクト全体のテストと型チェックを実行する**

Run: `npm run validate`
Expected: コマンドが正常終了する（エラーなし、テスト全てpassed）。

`npm run validate` が失敗する場合は、Step 2の対応表を再度参照して該当ファイルを見直す。

---

## 完了条件（全て満たすことを確認してから完了とする）

- [ ] `npm run validate` が成功する（Task 6 Step 3で確認済み）
- [ ] 以下のコマンドを実行し、出力が何も無いことを確認する（＝これらのファイルに一切差分が無いことの確認）

Run:
```bash
git diff --stat src/background/service-worker.ts src/background/handlers/dashboardSqliteProtocol.ts src/background/handlers/__tests__/
```
Expected出力: 何も表示されない（空）

- [ ] 以下のコマンドを実行し、5つの新規ファイルが存在することを確認する

Run:
```bash
ls src/background/handlers/dashboardSqlite/
```
Expected出力（この5行がこの順で、または順不同で表示される）:
```
coreCrudHandler.ts
deps.ts
index.ts
maintenanceBatchHandler.ts
readOnlyHandler.ts
```

全て確認できたら作業完了。
