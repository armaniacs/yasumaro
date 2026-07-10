# PBI-3: content（本文）保存 + 保持ポリシー — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save content (page body text) to SQLite `browsing_logs.content` and add configurable retention policy (days-based, count-based, starred-entry protection) with daily purge + dashboard UI + fallback storage support.

**Architecture:** Pipeline `createSaveSqliteStep` sets `content: data.content || null` (was hardcoded `null` for PBI-3). New `purgeContent()` function follows existing `purgeOldRecords()` pattern (2-stage: OPFS Worker delegation → direct SQL → `usingFallbackStorage`). Retention settings stored via StorageKeys. Dashboard UI mirrors existing retention policy section. offscreen.ts INSERT/INSERT_BATCH handlers receive full BrowsingLogRecord payload (PBI-1 metadata was silently dropped — fixed here). storageFallback.ts insert/insertBatch expanded to store all metadata + content + purgeContent.

**Design doc:** `docs/superpowers/specs/2026-07-07-pbi3-content-retention-design.md`

**Tech Stack:** SQLite (wa-sqlite), OPFS Worker, TypeScript, Jest/Vitest, Chrome Extension Manifest V3

**深掘りセッション決定事項（反映済み）:**
1. offscreen.ts INSERT/INSERT_BATCH ハンドラを全31フィールド対応に拡張（PBI-1 の metadata 消失バグを修正）
2. is_starred 保護を設定可能なチェックボックスに（デフォルト ON=保護）。キー: `CONTENT_PURGE_INCLUDE_STARRED`
3. storageFallback.ts に全メタデータ + content 保存 + purgeContent() を実装（スコープ外→スコープ内に変更）

---

### Task 1: Storage keys + defaults

**Files:**
- Modify: `src/utils/storage/types.ts` (StorageKeys enum, StorageKeyValues interface)
- Modify: `src/utils/storage/defaults.ts` (DEFAULT_SETTINGS)

- [ ] **Step 1: Add StorageKeys to types.ts**

Insert after `SQLITE_MAX_RECORDS` (line 200):

```typescript
    // PBI-3: content retention policy (null = unlimited / no purge)
    CONTENT_RETENTION_DAYS: 'content_retention_days',
    CONTENT_MAX_RECORDS: 'content_max_records',
    CONTENT_PURGE_INCLUDE_STARRED: 'content_purge_include_starred',
```

- [ ] **Step 2: Add StorageKeyValues to types.ts**

Insert after `[StorageKeys.SQLITE_MAX_RECORDS]: number | null` (line 360):

```typescript
    [StorageKeys.CONTENT_RETENTION_DAYS]: number | null;
    [StorageKeys.CONTENT_MAX_RECORDS]: number | null;
    [StorageKeys.CONTENT_PURGE_INCLUDE_STARRED]: boolean;
```

- [ ] **Step 3: Add defaults to defaults.ts**

Insert after `[StorageKeys.SQLITE_MAX_RECORDS]: null` (line 145):

```typescript
    [StorageKeys.CONTENT_RETENTION_DAYS]: null,
    [StorageKeys.CONTENT_MAX_RECORDS]: null,
    [StorageKeys.CONTENT_PURGE_INCLUDE_STARRED]: false,
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/utils/storage/types.ts src/utils/storage/defaults.ts
git commit -m "feat(pbi3): add content retention storage keys and defaults"
```

---

### Task 2: Pipeline — set content field from context

**Files:**
- Modify: `src/background/pipeline/RecordingPipeline.ts` (createSaveSqliteStep)

- [ ] **Step 1: Update content assignment**

In `src/background/pipeline/RecordingPipeline.ts`, find the BrowsingLogRecord construction inside `createSaveSqliteStep()`. Change:

```typescript
// Before (PBI-1 placeholder):
content: null, // content storage reserved for PBI-3

// After:
content: data.content || null,
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Run pipeline tests**

```bash
npx vitest run src/background/pipeline/__tests__/ --reporter=verbose 2>&1 | tail -20
```
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/background/pipeline/RecordingPipeline.ts
git commit -m "feat(pbi3): save content field in pipeline"
```

---

### Task 3: offscreen.ts — update INSERT/INSERT_BATCH for full field passthrough

**Files:**
- Modify: `src/offscreen/offscreen.ts` (SQLITE_INSERT handler, SQLITE_INSERT_BATCH handler)

This fixes PBI-1 metadata field loss (masked_count, ai_provider, etc.) and enables PBI-3 content field to persist through the offscreen path.

- [ ] **Step 1: Create a helper function `buildRecordFromPayload`**

At the top of the message handler section (before the `if/else if` chain, or as a module-level function outside `handleOffscreenMessage`), add:

```typescript
// Helper: extract BrowsingLogRecord fields from an untrusted payload.
// Explicit mapping ensures type safety and prevents SQL injection via raw spread.
function buildRecordFromPayload(payload: Record<string, unknown>): BrowsingLogRecord {
  const record: BrowsingLogRecord = {
    url: String(payload.url || ''),
    title: payload.title != null ? String(payload.title) : null,
    summary: payload.summary != null ? String(payload.summary) : null,
    tags: payload.tags != null ? String(payload.tags) : null,
    created_at: Number(payload.created_at || Date.now()),
    domain: payload.domain != null ? String(payload.domain) : null,
    visit_duration: payload.visit_duration != null ? Number(payload.visit_duration) : null,
    scroll_ratio: payload.scroll_ratio != null ? Number(payload.scroll_ratio) : null,
    is_starred: payload.is_starred != null ? Number(payload.is_starred) : 0,
    is_deleted: payload.is_deleted != null ? Number(payload.is_deleted) : 0,
    obsidian_synced: payload.obsidian_synced != null ? Number(payload.obsidian_synced) : 0,
    // PBI-1: diagnostic metadata (was missing — content always null)
    content: payload.content != null ? String(payload.content) : null,
    masked_count: payload.masked_count != null ? Number(payload.masked_count) : null,
    cleansed_reason: payload.cleansed_reason != null ? String(payload.cleansed_reason) : null,
    ai_provider: payload.ai_provider != null ? String(payload.ai_provider) : null,
    ai_model: payload.ai_model != null ? String(payload.ai_model) : null,
    ai_duration_ms: payload.ai_duration_ms != null ? Number(payload.ai_duration_ms) : null,
    obsidian_duration_ms: payload.obsidian_duration_ms != null ? Number(payload.obsidian_duration_ms) : null,
    sent_tokens: payload.sent_tokens != null ? Number(payload.sent_tokens) : null,
    received_tokens: payload.received_tokens != null ? Number(payload.received_tokens) : null,
    original_tokens: payload.original_tokens != null ? Number(payload.original_tokens) : null,
    cleansed_tokens: payload.cleansed_tokens != null ? Number(payload.cleansed_tokens) : null,
    page_bytes: payload.page_bytes != null ? Number(payload.page_bytes) : null,
    candidate_bytes: payload.candidate_bytes != null ? Number(payload.candidate_bytes) : null,
    original_bytes: payload.original_bytes != null ? Number(payload.original_bytes) : null,
    cleansed_bytes: payload.cleansed_bytes != null ? Number(payload.cleansed_bytes) : null,
    ai_summary_original_bytes: payload.ai_summary_original_bytes != null ? Number(payload.ai_summary_original_bytes) : null,
    ai_summary_cleansed_bytes: payload.ai_summary_cleansed_bytes != null ? Number(payload.ai_summary_cleansed_bytes) : null,
    extracted_sentences_bytes: payload.extracted_sentences_bytes != null ? Number(payload.extracted_sentences_bytes) : null,
    extracted_sentences_original_bytes: payload.extracted_sentences_original_bytes != null ? Number(payload.extracted_sentences_original_bytes) : null,
    fallback_triggered: payload.fallback_triggered != null ? Number(payload.fallback_triggered) : 0,
  };
  return record;
}
```

Import `BrowsingLogRecord` at the top of offscreen.ts (add to existing import from `./sqlite.js` or import from `../utils/sqlite-types.js`):

```typescript
import type { BrowsingLogRecord } from '../utils/sqlite-types.js';
```

- [ ] **Step 2: Replace INSERT handler body with helper call**

Replace lines 203-214 (the inline record construction in SQLITE_INSERT):

```typescript
            } else if (msg.type === 'SQLITE_INSERT') {
                const payload = msg.payload as Record<string, unknown>;

                if (typeof payload.summary === 'string' && payload.summary.length > 1024 * 1024) {
                    sendResponse({ success: false, error: 'Payload too large: summary exceeds 1MB limit' });
                    return;
                }

                const record = buildRecordFromPayload(payload);
                const result = await sqliteInsert(record);
                sendResponse(result);
```

- [ ] **Step 3: Replace INSERT_BATCH handler body with helper call**

Replace lines 222-233 (the inline map in SQLITE_INSERT_BATCH):

```typescript
            } else if (msg.type === 'SQLITE_INSERT_BATCH') {
                const payload = msg.payload as Record<string, unknown>;
                const rawRecords = (payload.records || []) as Record<string, unknown>[];

                const records = rawRecords.map(r => buildRecordFromPayload(r));
                const result = await sqliteInsertBatch(records);
                sendResponse(result);
```

- [ ] **Step 4: Update SQLITE_UPDATE allowed keys to include new fields**

Find the `SQLITE_UPDATE` handler (line 284). Extend the allowed keys array:

```typescript
                const changes: Record<string, unknown> = {};
                for (const key of [
                  'url', 'title', 'summary', 'tags', 'domain', 'visit_duration', 'scroll_ratio',
                  'is_starred', 'is_deleted', 'obsidian_synced',
                  // PBI-1/PBI-3: allow updating diagnostic metadata + content
                  'content', 'masked_count', 'cleansed_reason',
                  'ai_provider', 'ai_model', 'ai_duration_ms', 'obsidian_duration_ms',
                  'sent_tokens', 'received_tokens', 'original_tokens', 'cleansed_tokens',
                  'page_bytes', 'candidate_bytes', 'original_bytes', 'cleansed_bytes',
                  'ai_summary_original_bytes', 'ai_summary_cleansed_bytes',
                  'extracted_sentences_bytes', 'extracted_sentences_original_bytes',
                  'fallback_triggered',
                ]) {
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 6: Run offscreen tests**

```bash
npx vitest run src/offscreen/__tests__/ --reporter=verbose 2>&1 | tail -20
```
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/offscreen/offscreen.ts
git commit -m "fix(pbi3): passthrough all BrowsingLogRecord fields in offscreen INSERT handlers"
```

---

### Task 4: sqlite.ts — add purgeContent()

**Files:**
- Modify: `src/offscreen/sqlite.ts` (add `purgeContent` function + `OPFS_PROXY_METHODS` registration)

- [ ] **Step 1: Add purgeContent function**

Add after `purgeOldRecords()` (after line 1240), before `getFtsIndexSize()`:

```typescript
/**
 * Purge content (page body) from old records based on retention policy.
 * Sets content = NULL (does NOT delete records).
 * Respects is_starred protection based on includeStarred flag.
 */
export async function purgeContent(
  retentionDays?: number | null,
  maxRecords?: number | null,
  includeStarred?: boolean | null,
): Promise<{ success: true; purged: number } | { success: false; error: string }> {
  try {
    const opfsResult = await tryOpfsProxy<{ purged: number }>('CONTENT_PURGE', {
      retentionDays,
      maxRecords,
      includeStarred,
    });
    if (opfsResult !== null) return { success: true, purged: opfsResult.purged };

    if (!dbHandle && !usingFallbackStorage) {
      await init();
    }

    if (usingFallbackStorage && fallbackStorage) {
      return fallbackStorage.purgeContent(retentionDays, maxRecords, includeStarred);
    }

    if (!dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    const starredClause = includeStarred ? '' : 'AND is_starred = 0';
    let totalPurged = 0;

    // 1. Days-based: NULL content on old non-starred entries
    if (retentionDays != null && retentionDays > 0) {
      const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      await execWithCache(
        `UPDATE browsing_logs SET content = NULL
         WHERE content IS NOT NULL AND created_at < ? ${starredClause}`,
        [cutoffMs]
      );

      let changes1 = 0;
      await execWithCache('SELECT changes()', [], (row: SqliteValue[]) => {
        changes1 = Number(row[0]);
      });
      totalPurged += changes1;
    }

    // 2. Count-based: NULL oldest content when over limit
    if (maxRecords != null && maxRecords > 0) {
      let count = 0;
      await execWithCache(
        `SELECT COUNT(*) FROM browsing_logs WHERE content IS NOT NULL ${starredClause}`,
        [],
        (row: SqliteValue[]) => { count = Number(row[0]); }
      );

      if (count > maxRecords) {
        const excess = count - maxRecords;
        await execWithCache(
          `UPDATE browsing_logs SET content = NULL
           WHERE id IN (
             SELECT id FROM browsing_logs
             WHERE content IS NOT NULL ${starredClause}
             ORDER BY created_at ASC
             LIMIT ?
           )`,
          [excess]
        );

        let changes2 = 0;
        await execWithCache('SELECT changes()', [], (row: SqliteValue[]) => {
          changes2 = Number(row[0]);
        });
        totalPurged += changes2;
      }
    }

    return { success: true, purged: totalPurged };
  } catch (error) {
    logError('SQLite: purgeContent failed', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Run offscreen tests**

```bash
npx vitest run src/offscreen/__tests__/ --reporter=verbose 2>&1 | tail -20
```
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/offscreen/sqlite.ts
git commit -m "feat(pbi3): add purgeContent function to sqlite.ts"
```

---

### Task 5: opfsWorker.ts — add handleContentPurge()

**Files:**
- Modify: `src/offscreen/opfsWorker.ts` (add handleContentPurge dispatcher entry + handler function)

- [ ] **Step 1: Add handleContentPurge function**

Find the existing `handlePurgeOldRecords` function (around line 574). Add after it:

```typescript
async function handleContentPurge(payload: {
  retentionDays?: number | null;
  maxRecords?: number | null;
  includeStarred?: boolean | null;
}): Promise<{ purged: number }> {
  const starredClause = payload.includeStarred ? '' : 'AND is_starred = 0';
  let totalPurged = 0;

  // 1. Days-based
  if (payload.retentionDays != null && payload.retentionDays > 0) {
    const cutoffMs = Date.now() - payload.retentionDays * 24 * 60 * 60 * 1000;
    await sqlExec(
      `UPDATE browsing_logs SET content = NULL
       WHERE content IS NOT NULL AND created_at < ? ${starredClause}`,
      [cutoffMs]
    );
    await sqlQuery('SELECT changes() AS c', [], (row) => { totalPurged += Number(row.c); });
  }

  // 2. Count-based
  if (payload.maxRecords != null && payload.maxRecords > 0) {
    let count = 0;
    await sqlQuery(
      `SELECT COUNT(*) AS c FROM browsing_logs WHERE content IS NOT NULL ${starredClause}`,
      [],
      (row) => { count = Number(row.c); }
    );

    if (count > payload.maxRecords) {
      const excess = count - payload.maxRecords;
      await sqlExec(
        `UPDATE browsing_logs SET content = NULL
         WHERE id IN (
           SELECT id FROM browsing_logs
           WHERE content IS NOT NULL ${starredClause}
           ORDER BY created_at ASC
           LIMIT ?
         )`,
        [excess]
      );
      totalPurged += excess;
    }
  }

  return { purged: totalPurged };
}
```

- [ ] **Step 2: Register in the message handler switch**

Find the message dispatcher in opfsWorker.ts (the `if/else if` or `switch` chain). Add a `case 'CONTENT_PURGE':` entry:

```typescript
    } else if (msg.type === 'CONTENT_PURGE') {
      const payload = msg.payload as { retentionDays?: number; maxRecords?: number; includeStarred?: boolean } | undefined;
      const result = await handleContentPurge({
        retentionDays: payload?.retentionDays ?? null,
        maxRecords: payload?.maxRecords ?? null,
        includeStarred: payload?.includeStarred ?? null,
      });
      sendResponse({ success: true, purged: result.purged });
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/offscreen/opfsWorker.ts
git commit -m "feat(pbi3): add handleContentPurge to opfsWorker.ts"
```

---

### Task 6: offscreen.ts — add CONTENT_PURGE message handler

**Files:**
- Modify: `src/offscreen/offscreen.ts` (add CONTENT_PURGE handler, export purgeContent)

- [ ] **Step 1: Import purgeContent from sqlite.ts**

Update the import block at the top to add `purgeContent as sqlitePurgeContent`:

```typescript
import {
  init as sqliteInit,
  insert as sqliteInsert,
  insertBatch as sqliteInsertBatch,
  query as sqliteQuery,
  search as sqliteSearch,
  update as sqliteUpdate,
  hardDelete as sqliteHardDelete,
  toggleStar as sqliteToggleStar,
  getCount as sqliteGetCount,
  getStatus as sqliteGetStatus,
  serialize as sqliteSerialize,
  backupDb as sqliteBackupDb,
  restoreDb as sqliteRestoreDb,
  clearAll as sqliteClearAll,
  purgeOldRecords as sqlitePurgeOldRecords,
  purgeContent as sqlitePurgeContent,
  insertAuditLog as sqliteInsertAuditLog,
  queryAuditLog as sqliteQueryAuditLog,
  _resetForTesting as sqliteResetForTesting,
} from './sqlite.js';
```

- [ ] **Step 2: Add CONTENT_PURGE handler in the if/else if chain**

Add after the `SQLITE_PURGE` handler (after the `} else if (msg.type === 'SQLITE_PURGE')` block, before `SQLITE_OPFS_SPIKE`):

```typescript
            } else if (msg.type === 'CONTENT_PURGE') {
                const payload = msg.payload as Record<string, unknown> | undefined;
                const retentionDays = payload?.retentionDays != null ? Number(payload.retentionDays) : undefined;
                const maxRecords = payload?.maxRecords != null ? Number(payload.maxRecords) : undefined;
                const includeStarred = payload?.includeStarred != null ? Boolean(payload.includeStarred) : undefined;
                const result = await sqlitePurgeContent(retentionDays, maxRecords, includeStarred);
                sendResponse(result);
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/offscreen/offscreen.ts
git commit -m "feat(pbi3): add CONTENT_PURGE handler to offscreen.ts"
```

---

### Task 7: sqliteClient.ts — add purgeContent() method

**Files:**
- Modify: `src/background/sqliteClient.ts` (add purgeContent method)

- [ ] **Step 1: Add purgeContent method**

Add after `purgeOldRecords()` (after line 265):

```typescript
  async purgeContent(
    retentionDays?: number,
    maxRecords?: number,
    includeStarred?: boolean,
  ): Promise<{ purged: number } | null> {
    return this.call<{ purged: number }>(
      'CONTENT_PURGE',
      { retentionDays, maxRecords, includeStarred },
      (res) => ({ purged: Number(res.purged || 0) }),
    );
  }
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/background/sqliteClient.ts
git commit -m "feat(pbi3): add purgeContent method to SqliteClient"
```

---

### Task 8: dailyPurgeHandler.ts + service-worker.ts — integrate content purge

**Files:**
- Modify: `src/background/dailyPurgeHandler.ts` (add ContentPurgeFn parameter)
- Modify: `src/background/service-worker.ts` (pass purgeContent to handler)

- [ ] **Step 1: Update dailyPurgeHandler.ts**

Replace the entire file content:

```typescript
import { getSettings, StorageKeys } from '../utils/storage.js';
import { logInfo, logError, ErrorCode } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';

type PurgeFn = (retentionDays?: number, maxRecords?: number) => Promise<{ purged: number } | null>;
type ContentPurgeFn = (
  retentionDays?: number,
  maxRecords?: number,
  includeStarred?: boolean,
) => Promise<{ purged: number } | null>;

/**
 * Runs the daily SQLite purge according to user retention settings.
 * If both settings are null, purge is skipped (unlimited retention).
 */
export async function handleDailyPurgeAlarm(
  purgeOldRecords: PurgeFn,
  purgeContent?: ContentPurgeFn,
): Promise<void> {
  try {
    // Record-level purge (existing)
    const settings = await getSettings();
    const days = settings[StorageKeys.SQLITE_RETENTION_DAYS] ?? null;
    const max  = settings[StorageKeys.SQLITE_MAX_RECORDS]    ?? null;

    if (days !== null || max !== null) {
      const result = await purgeOldRecords(
        days  !== null ? days  : undefined,
        max   !== null ? max   : undefined,
      );
      logInfo('daily-purge completed', { purged: result?.purged ?? 0 }, 'dailyPurgeHandler');
    }

    // Content-level purge (PBI-3)
    if (purgeContent) {
      const contentDays = settings[StorageKeys.CONTENT_RETENTION_DAYS] ?? null;
      const contentMax  = settings[StorageKeys.CONTENT_MAX_RECORDS]    ?? null;
      const includeStarred = settings[StorageKeys.CONTENT_PURGE_INCLUDE_STARRED] ?? false;

      if (contentDays !== null || contentMax !== null) {
        const result = await purgeContent(
          contentDays !== null ? contentDays : undefined,
          contentMax  !== null ? contentMax  : undefined,
          includeStarred,
        );
        logInfo('daily-content-purge completed', {
          purged: result?.purged ?? 0,
        }, 'dailyPurgeHandler');
      }
    }
  } catch (error) {
    logError('daily-purge failed', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'dailyPurgeHandler');
  }
}
```

- [ ] **Step 2: Update service-worker.ts alarm handler**

Find the alarm listener (around line 914-917). Update to pass purgeContent:

```typescript
    // Daily purge alarm
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === 'yasumaro-daily-purge') {
            handleDailyPurgeAlarm(
              (days, max) => sqliteClient.purgeOldRecords(days, max),
              (days, max, starred) => sqliteClient.purgeContent(days, max, starred),
            );
        }
    });
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Run daily-purge-alarm tests**

```bash
npx vitest run src/background/__tests__/daily-purge-alarm.test.ts --reporter=verbose 2>&1 | tail -20
```
Expected: All tests pass (existing tests may need update since signature changed).

- [ ] **Step 5: Commit**

```bash
git add src/background/dailyPurgeHandler.ts src/background/service-worker.ts
git commit -m "feat(pbi3): integrate content purge into daily alarm"
```

---

### Task 9: storageFallback.ts — add metadata + content + purgeContent

**Files:**
- Modify: `src/offscreen/storageFallback.ts` (insert/insertBatch expanded, add purgeContent)

- [ ] **Step 1: Update insert() to include all metadata + content fields**

Replace the `newRecord` construction in `insert()` (lines 44-57):

```typescript
      const newRecord: BrowsingLogRecord = {
        id,
        url: record.url,
        title: record.title ?? null,
        summary: record.summary ?? null,
        tags: record.tags ?? null,
        created_at: record.created_at,
        domain,
        visit_duration: record.visit_duration ?? null,
        scroll_ratio: record.scroll_ratio ?? null,
        is_starred: record.is_starred ?? 0,
        is_deleted: record.is_deleted ?? 0,
        obsidian_synced: record.obsidian_synced ?? 0,
        // PBI-1/PBI-3: diagnostic metadata + content
        content: record.content ?? null,
        masked_count: record.masked_count ?? null,
        cleansed_reason: record.cleansed_reason ?? null,
        ai_provider: record.ai_provider ?? null,
        ai_model: record.ai_model ?? null,
        ai_duration_ms: record.ai_duration_ms ?? null,
        obsidian_duration_ms: record.obsidian_duration_ms ?? null,
        sent_tokens: record.sent_tokens ?? null,
        received_tokens: record.received_tokens ?? null,
        original_tokens: record.original_tokens ?? null,
        cleansed_tokens: record.cleansed_tokens ?? null,
        page_bytes: record.page_bytes ?? null,
        candidate_bytes: record.candidate_bytes ?? null,
        original_bytes: record.original_bytes ?? null,
        cleansed_bytes: record.cleansed_bytes ?? null,
        ai_summary_original_bytes: record.ai_summary_original_bytes ?? null,
        ai_summary_cleansed_bytes: record.ai_summary_cleansed_bytes ?? null,
        extracted_sentences_bytes: record.extracted_sentences_bytes ?? null,
        extracted_sentences_original_bytes: record.extracted_sentences_original_bytes ?? null,
        fallback_triggered: record.fallback_triggered ?? 0,
      };
```

- [ ] **Step 2: Update insertBatch() to include all metadata + content fields**

Replace the inline record construction in `insertBatch()` (lines 84-97) with the same expanded set from Step 1.

- [ ] **Step 3: Add purgeContent() method**

Add after `purgeOldRecords()`:

```typescript
  async purgeContent(
    retentionDays?: number,
    maxRecords?: number,
    includeStarred?: boolean,
  ): Promise<{ success: true; purged: number } | { success: false; error: string }> {
    try {
      const data = await this.loadData();
      const includeAll = includeStarred === true;
      let totalPurged = 0;

      // Filter: records with non-null content
      let candidates = data.records.filter(r => r.content != null && r.content !== undefined);
      if (!includeAll) {
        candidates = candidates.filter(r => r.is_starred !== 1);
      }

      // 1. Days-based
      if (retentionDays != null && retentionDays > 0) {
        const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
        const toPurge = candidates.filter(r => r.created_at < cutoffMs);
        for (const r of toPurge) {
          r.content = null;
        }
        totalPurged += toPurge.length;
      }

      // 2. Count-based
      if (maxRecords != null && maxRecords > 0) {
        // Re-filter for records whose content is still non-null
        let remaining = data.records.filter(r => r.content != null);
        if (!includeAll) {
          remaining = remaining.filter(r => r.is_starred !== 1);
        }
        if (remaining.length > maxRecords) {
          const excess = remaining.length - maxRecords;
          const sorted = [...remaining].sort((a, b) => a.created_at - b.created_at);
          const toPurge = sorted.slice(0, excess);
          for (const r of toPurge) {
            const record = data.records.find(rec => rec.id === r.id);
            if (record) record.content = null;
          }
          totalPurged += toPurge.length;
        }
      }

      await this.saveData(data);
      return { success: true, purged: totalPurged };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 5: Run offscreen tests**

```bash
npx vitest run src/offscreen/__tests__/ --reporter=verbose 2>&1 | tail -20
```
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/offscreen/storageFallback.ts
git commit -m "feat(pbi3): add metadata+content fields and purgeContent to storageFallback.ts"
```

---

### Task 10: dashboardSqliteHandlers.ts — add CONTENT_PURGE_NOW handler

**Files:**
- Modify: `src/background/handlers/dashboardSqliteHandlers.ts` (add content_purge_now case)

- [ ] **Step 1: Add content_purge_now case**

After the `purge_now` case (after line 216), add:

```typescript
            case 'content_purge_now': {
                const settings = await getSettings();
                const contentDays = settings[StorageKeys.CONTENT_RETENTION_DAYS] ?? null;
                const contentMax  = settings[StorageKeys.CONTENT_MAX_RECORDS]    ?? null;
                const includeStarred = settings[StorageKeys.CONTENT_PURGE_INCLUDE_STARRED] ?? false;
                if (contentDays === null && contentMax === null) {
                    return { success: true, purged: 0, skipped: true };
                }
                const result = await sqliteClient.purgeContent(
                    contentDays !== null ? Number(contentDays) : undefined,
                    contentMax  !== null ? Number(contentMax)  : undefined,
                    includeStarred,
                );
                return { success: true, purged: result?.purged ?? 0, skipped: false };
            }
```

Also add the import for `StorageKeys` if not already present at the top of the file:

```typescript
import { getSettings, StorageKeys } from '../../utils/storage.js';
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/background/handlers/dashboardSqliteHandlers.ts
git commit -m "feat(pbi3): add content_purge_now handler to dashboardSqliteHandlers"
```

---

### Task 11: Dashboard UI — HTML + TypeScript for content retention settings

**Files:**
- Modify: `entrypoints/options/index.html` (add content retention HTML section)
- Modify: `src/dashboard/dashboard.ts` (add element refs, settings mapping, event handler)

- [ ] **Step 1: Add HTML for content retention section**

After the existing retention policy section (after `</div>` of `.settings-section` at line 505), add:

```html
        <!-- コンテンツ保持設定 -->
        <div class="settings-section">
          <h3 class="settings-section-title" data-i18n="contentRetentionPolicyTitle">コンテンツ保持設定</h3>
          <p class="settings-section-desc" data-i18n="contentRetentionPolicyDesc">content（本文）のみを対象とし、レコード自体は削除しません</p>
          <div class="form-group">
            <label for="contentRetentionDays" data-i18n="contentRetentionDaysLabel">content（本文）保持期間</label>
            <select id="contentRetentionDays">
              <option value="" data-i18n="retentionUnlimited">無制限（削除しない）</option>
              <option value="7" data-i18n="retention7days">7日</option>
              <option value="30" data-i18n="retention30days">30日</option>
              <option value="90" data-i18n="retention90days">90日</option>
              <option value="180" data-i18n="retention180days">180日</option>
            </select>
          </div>
          <div class="form-group">
            <label for="contentMaxRecords" data-i18n="contentMaxRecordsLabel">content（本文）最大保持件数</label>
            <select id="contentMaxRecords">
              <option value="" data-i18n="retentionUnlimited">無制限（削除しない）</option>
              <option value="100">100</option>
              <option value="500">500</option>
              <option value="1000">1,000</option>
              <option value="10000">10,000</option>
            </select>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="contentPurgeIncludeStarred">
              <span data-i18n="contentPurgeIncludeStarredLabel">スター付きエントリの content も削除対象にする</span>
            </label>
          </div>
          <div class="form-group">
            <button id="contentPurgeNowBtn" class="secondary-btn" data-i18n="contentPurgeNowBtn">今すぐ content を削除</button>
            <span id="contentPurgeNowStatus" aria-live="polite"></span>
          </div>
        </div>
```

- [ ] **Step 2: Add dashboard.ts element selectors**

In the `DashboardElements` interface (around line 216), add:

```typescript
  contentRetentionDaysSelect: HTMLSelectElement | null;
  contentMaxRecordsSelect: HTMLSelectElement | null;
  contentPurgeIncludeStarredCheckbox: HTMLInputElement | null;
  contentPurgeNowBtn: HTMLButtonElement | null;
```

In `getDashboardElements()` (around line 275), add:

```typescript
      contentRetentionDaysSelect: document.getElementById('contentRetentionDays') as HTMLSelectElement | null,
      contentMaxRecordsSelect: document.getElementById('contentMaxRecords') as HTMLSelectElement | null,
      contentPurgeIncludeStarredCheckbox: document.getElementById('contentPurgeIncludeStarred') as HTMLInputElement | null,
      contentPurgeNowBtn: document.getElementById('contentPurgeNowBtn') as HTMLButtonElement | null,
```

In `resetDashboardElements()` (around line 305), add:

```typescript
    contentRetentionDaysSelect: null, contentMaxRecordsSelect: null,
    contentPurgeIncludeStarredCheckbox: null, contentPurgeNowBtn: null,
```

- [ ] **Step 3: Add settings mapping**

In the settings mapping array (around line 351), add:

```typescript
    [StorageKeys.CONTENT_RETENTION_DAYS]: el.contentRetentionDaysSelect,
    [StorageKeys.CONTENT_MAX_RECORDS]: el.contentMaxRecordsSelect,
    [StorageKeys.CONTENT_PURGE_INCLUDE_STARRED]: el.contentPurgeIncludeStarredCheckbox,
```

- [ ] **Step 4: Add settings value transformation**

In the save handler (around line 553), add after the SQLITE_* transformations:

```typescript
  // Content retention (PBI-3) — same null handling as SQLITE_RETENTION
  const contentDaysRaw = newSettings[StorageKeys.CONTENT_RETENTION_DAYS];
  newSettings[StorageKeys.CONTENT_RETENTION_DAYS] =
    contentDaysRaw === '' || contentDaysRaw === undefined ? null : Number(contentDaysRaw);
  const contentMaxRaw = newSettings[StorageKeys.CONTENT_MAX_RECORDS];
  newSettings[StorageKeys.CONTENT_MAX_RECORDS] =
    contentMaxRaw === '' || contentMaxRaw === undefined ? null : Number(contentMaxRaw);
```

- [ ] **Step 5: Add content purge now handler**

Add a new function (after `handlePurgeNow`):

```typescript
export async function handleContentPurgeNow(): Promise<void> {
  const el = getDashboardElements();
  const statusEl = document.getElementById('contentPurgeNowStatus');
  if (!el.contentPurgeNowBtn || !statusEl) return;

  el.contentPurgeNowBtn.disabled = true;
  statusEl.textContent = '';
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'DASHBOARD_SQLITE',
      payload: { subtype: 'content_purge_now' },
    }) as { success: boolean; purged: number; skipped?: boolean; error?: string } | undefined;

    if (result?.skipped) {
      statusEl.textContent = getMessage('contentPurgeNowSkipped') || 'コンテンツ保持ポリシーが未設定のため、削除をスキップしました';
    } else if (result?.success) {
      const msg = getMessage('contentPurgeNowSuccess') || '$COUNT$ 件の content を削除しました';
      statusEl.textContent = msg.replace('$COUNT$', String(result.purged));
    } else {
      statusEl.textContent = result?.error ?? 'Error';
    }
  } finally {
    el.contentPurgeNowBtn.disabled = false;
  }
}
```

- [ ] **Step 6: Wire event listener**

Find where `purgeNowBtn` event listener is registered (around line 1398). Add after it:

```typescript
    el.contentPurgeNowBtn?.addEventListener('click', async () => {
      await handleContentPurgeNow();
    });
```

- [ ] **Step 7: Type-check**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add entrypoints/options/index.html src/dashboard/dashboard.ts
git commit -m "feat(pbi3): add content retention settings UI to dashboard"
```

---

### Task 12: i18n messages (Japanese + English)

**Files:**
- Modify: `public/_locales/ja/messages.json` (add content retention keys)
- Modify: `public/_locales/en/messages.json` (add content retention keys)

- [ ] **Step 1: Add to ja/messages.json**

Add after the `purgeNowSkipped` entry:

```json
  "contentRetentionPolicyTitle": {
    "message": "コンテンツ保持設定"
  },
  "contentRetentionPolicyDesc": {
    "message": "content（本文）のみを対象とし、レコード自体は削除しません"
  },
  "contentRetentionDaysLabel": {
    "message": "content（本文）保持期間"
  },
  "contentMaxRecordsLabel": {
    "message": "content（本文）最大保持件数"
  },
  "contentPurgeIncludeStarredLabel": {
    "message": "スター付きエントリの content も削除対象にする"
  },
  "contentPurgeNowBtn": {
    "message": "今すぐ content を削除"
  },
  "contentPurgeNowSuccess": {
    "message": "$COUNT$ 件の content を削除しました"
  },
  "contentPurgeNowSkipped": {
    "message": "コンテンツ保持ポリシーが未設定のため、削除をスキップしました"
  },
```

- [ ] **Step 2: Add to en/messages.json**

Add after the `purgeNowSkipped` entry:

```json
  "contentRetentionPolicyTitle": {
    "message": "Content Retention Settings"
  },
  "contentRetentionPolicyDesc": {
    "message": "Only content (page body) will be purged; records themselves are kept"
  },
  "contentRetentionDaysLabel": {
    "message": "Content retention period"
  },
  "contentMaxRecordsLabel": {
    "message": "Max content records"
  },
  "contentPurgeIncludeStarredLabel": {
    "message": "Include starred entries in content purge"
  },
  "contentPurgeNowBtn": {
    "message": "Purge content now"
  },
  "contentPurgeNowSuccess": {
    "message": "Purged $COUNT$ content entries"
  },
  "contentPurgeNowSkipped": {
    "message": "No content retention policy set — purge skipped"
  },
```

- [ ] **Step 3: Verify i18n key uniqueness**

```bash
grep -c '"contentRetentionPolicyTitle"' public/_locales/ja/messages.json
grep -c '"contentRetentionPolicyTitle"' public/_locales/en/messages.json
```
Expected: Both return `1`.

- [ ] **Step 4: Commit**

```bash
git add public/_locales/ja/messages.json public/_locales/en/messages.json
git commit -m "feat(pbi3): add content retention i18n messages"
```

---

### Task 13: Tests

**Files:**
- Create: `src/offscreen/__tests__/pbi3-purge-content.test.ts` (purgeContent unit tests)
- Create or modify: `src/dashboard/__tests__/content-retention-settings.test.ts` (dashboard UI tests)
- Modify: `src/background/__tests__/daily-purge-alarm.test.ts` (update for content purge)

- [ ] **Step 1: Write purgeContent unit tests**

Create `src/offscreen/__tests__/pbi3-purge-content.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.stubGlobal('chrome', {
  storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } },
  runtime: { getURL: vi.fn() },
});

import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';

// Mock the sqlite module to test purgeContent directly
const mockExecWithCache = vi.fn();
const mockTryOpfsProxy = vi.fn().mockResolvedValue(null);
const mockLogError = vi.fn();

vi.mock('../sqlite.js', async () => {
  const actual = await vi.importActual('../sqlite.js');
  return {
    ...actual,
    execWithCache: mockExecWithCache,
    tryOpfsProxy: mockTryOpfsProxy,
  };
});

// Re-import after mocking
const { purgeContent } = await import('../sqlite.js');

describe('purgeContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTryOpfsProxy.mockResolvedValue(null);
  });

  it('returns success with 0 purged when retentionDays is null and maxRecords is null', async () => {
    const result = await purgeContent(null, null, false);
    expect(result).toEqual({ success: true, purged: 0 });
    expect(mockExecWithCache).not.toHaveBeenCalled();
  });

  it('returns success with 0 purged when retentionDays is 0', async () => {
    const result = await purgeContent(0, null, false);
    expect(result).toEqual({ success: true, purged: 0 });
    expect(mockExecWithCache).not.toHaveBeenCalled();
  });

  it('executes days-based purge SQL for non-null retentionDays', async () => {
    // execWithCache returns changes=5 for SELECT changes()
    mockExecWithCache.mockImplementation((sql: string, _params: unknown[], callback?: (row: unknown[]) => void) => {
      if (sql.includes('SELECT changes()') && callback) {
        callback(['5']);
      }
    });

    const result = await purgeContent(30, null, false);
    expect(result).toEqual({ success: true, purged: 5 });
    // Should have called UPDATE with cutoff and AND is_starred = 0
    const updateCall = mockExecWithCache.mock.calls.find(
      (c: [string]) => c[0].includes('UPDATE browsing_logs SET content = NULL')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toContain('AND is_starred = 0');
  });

  it('executes days-based purge without is_starred filter when includeStarred=true', async () => {
    mockExecWithCache.mockImplementation((sql: string, _params: unknown[], callback?: (row: unknown[]) => void) => {
      if (sql.includes('SELECT changes()') && callback) {
        callback(['3']);
      }
    });

    const result = await purgeContent(30, null, true);
    expect(result).toEqual({ success: true, purged: 3 });
    const updateCall = mockExecWithCache.mock.calls.find(
      (c: [string]) => c[0].includes('UPDATE browsing_logs SET content = NULL')
    );
    expect(updateCall).toBeDefined();
    // When includeStarred=true, the starredClause is empty (no AND is_starred = 0)
    expect(updateCall[0]).not.toContain('AND is_starred');
  });
});
```

- [ ] **Step 2: Run purgeContent tests**

```bash
npx vitest run src/offscreen/__tests__/pbi3-purge-content.test.ts --reporter=verbose 2>&1
```
Expected: All tests pass.

- [ ] **Step 3: Write dashboard content retention UI tests**

Create `src/dashboard/__tests__/content-retention-settings.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.stubGlobal('chrome', {
    i18n: { getMessage: vi.fn((k: string) => k), getUILanguage: vi.fn(() => 'en') },
    runtime: { sendMessage: vi.fn().mockResolvedValue({}) },
    storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
});

vi.mock('../../popup/i18n.js', () => ({ getMessage: vi.fn((k: string) => k) }));
vi.mock('../../popup/domainFilter.js', () => ({ init: vi.fn() }));
vi.mock('../../popup/privacySettings.js', () => ({ init: vi.fn() }));
vi.mock('../../popup/contentSettings.js', () => ({ init: vi.fn() }));
vi.mock('../../popup/trustSettings.js', () => ({ init: vi.fn(), loadTrustSettings: vi.fn() }));
vi.mock('../../popup/customPromptManager.js', () => ({ initCustomPromptManager: vi.fn() }));
vi.mock('../../popup/aiSummaryCleansingSettings.js', () => ({
    getAiSummaryCleansingSettings: vi.fn().mockResolvedValue({}),
    applyAiSummaryCleansingSettingsToUI: vi.fn(),
    setupAiSummaryCleansingEventListeners: vi.fn(),
}));
vi.mock('../../popup/settings/aiProvider.js', () => ({
    setupAIProviderChangeListener: vi.fn(),
    updateAIProviderVisibility: vi.fn(),
    updateAIProviderVisibilityMulti: vi.fn(),
}));
vi.mock('../../popup/settings/fieldValidation.js', () => ({
    clearAllFieldErrors: vi.fn(),
    validateAllFields: vi.fn().mockReturnValue(true),
    setupAllFieldValidations: vi.fn(),
}));
vi.mock('../../popup/privacyConsent.js', () => ({
    getPrivacyConsent: vi.fn().mockResolvedValue(null),
    withdrawPrivacyConsent: vi.fn(),
}));
vi.mock('../../dashboard/cspSettings.js', () => ({ CSPSettings: class { load = vi.fn(); } }));

const { mockGetSettings, mockSaveSettings } = vi.hoisted(() => ({
    mockGetSettings: vi.fn(),
    mockSaveSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/storage.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../utils/storage.js')>();
    return {
        ...actual,
        getSettings: mockGetSettings,
        saveSettingsWithAllowedUrls: mockSaveSettings,
    };
});

import {
    resetDashboardElements,
    loadGeneralSettings,
    getSettingsMapping,
} from '../dashboard.js';
import { StorageKeys } from '../../utils/storage.js';

function buildDom() {
    document.body.innerHTML = `
        <select id="contentRetentionDays">
            <option value="">unlimited</option>
            <option value="7">7</option>
            <option value="30">30</option>
            <option value="90">90</option>
            <option value="180">180</option>
        </select>
        <select id="contentMaxRecords">
            <option value="">unlimited</option>
            <option value="100">100</option>
            <option value="500">500</option>
            <option value="1000">1000</option>
            <option value="10000">10000</option>
        </select>
        <input type="checkbox" id="contentPurgeIncludeStarred">
        <button id="contentPurgeNowBtn"></button>
        <input id="apiKey" /><input id="protocol" value="https" /><input id="port" value="27124" />
        <input id="dailyPath" /><input id="obsidianEnabled" type="checkbox" />
        <select id="aiProvider"></select>
        <div id="geminiSettings"></div><div id="openaiSettings"></div>
        <div id="openai2Settings"></div><div id="lm-studioSettings"></div>
        <div id="openai-compatibleSettings"></div><div id="ollamaSettings"></div>
        <input id="geminiApiKey" /><input id="geminiModel" />
        <input id="openaiBaseUrl" /><input id="openaiApiKey" /><input id="openaiModel" />
        <input id="openai2BaseUrl" /><input id="openai2ApiKey" /><input id="openai2Model" />
        <input id="lmStudioBaseUrl" /><input id="lmStudioModel" />
        <input id="ollamaBaseUrl" /><input id="ollamaModel" />
        <input id="providerBaseUrl" /><input id="providerApiKey" /><input id="providerModel" />
        <button id="save"></button>
        <button id="testObsidianBtn"></button><button id="testAiBtn"></button>
        <div id="status"></div>
    `;
}

describe('Content retention settings UI', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetDashboardElements();
        buildDom();
    });

    it('getSettingsMapping includes content retention keys', () => {
        const mapping = getSettingsMapping();
        expect(mapping[StorageKeys.CONTENT_RETENTION_DAYS]).not.toBeUndefined();
        expect(mapping[StorageKeys.CONTENT_MAX_RECORDS]).not.toBeUndefined();
        expect(mapping[StorageKeys.CONTENT_PURGE_INCLUDE_STARRED]).not.toBeUndefined();
    });

    it('loadGeneralSettings sets content retention selects to null (unlimited) by default', async () => {
        mockGetSettings.mockResolvedValue({
            [StorageKeys.CONTENT_RETENTION_DAYS]: null,
            [StorageKeys.CONTENT_MAX_RECORDS]: null,
            [StorageKeys.CONTENT_PURGE_INCLUDE_STARRED]: false,
        });

        await loadGeneralSettings();

        const daysEl = document.getElementById('contentRetentionDays') as HTMLSelectElement;
        const maxEl  = document.getElementById('contentMaxRecords') as HTMLSelectElement;
        const starredEl = document.getElementById('contentPurgeIncludeStarred') as HTMLInputElement;
        expect(daysEl.value).toBe('');
        expect(maxEl.value).toBe('');
        expect(starredEl.checked).toBe(false);
    });

    it('loadGeneralSettings populates selects with stored values', async () => {
        mockGetSettings.mockResolvedValue({
            [StorageKeys.CONTENT_RETENTION_DAYS]: 30,
            [StorageKeys.CONTENT_MAX_RECORDS]: 500,
            [StorageKeys.CONTENT_PURGE_INCLUDE_STARRED]: true,
        });

        await loadGeneralSettings();

        const daysEl = document.getElementById('contentRetentionDays') as HTMLSelectElement;
        const maxEl  = document.getElementById('contentMaxRecords') as HTMLSelectElement;
        const starredEl = document.getElementById('contentPurgeIncludeStarred') as HTMLInputElement;
        expect(daysEl.value).toBe('30');
        expect(maxEl.value).toBe('500');
        expect(starredEl.checked).toBe(true);
    });
});
```

- [ ] **Step 4: Run content retention UI tests**

```bash
npx vitest run src/dashboard/__tests__/content-retention-settings.test.ts --reporter=verbose 2>&1
```
Expected: All tests pass.

- [ ] **Step 5: Update daily-purge-alarm.test.ts**

Read the existing test file and update the `handleDailyPurgeAlarm` calls to pass the second argument (content purge function). The existing tests call `handleDailyPurgeAlarm(purgeOldRecords)` — they should still work since the second parameter is optional (`purgeContent?: ContentPurgeFn`). Verify they pass:

```bash
npx vitest run src/background/__tests__/daily-purge-alarm.test.ts --reporter=verbose 2>&1
```
Expected: All tests pass (backward compatible).

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run --reporter=verbose --exclude='src/utils/__tests__/versionConsistency.test.ts' 2>&1 | tail -10
```
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/offscreen/__tests__/pbi3-purge-content.test.ts src/dashboard/__tests__/content-retention-settings.test.ts
git commit -m "test(pbi3): add purgeContent and content retention UI tests"
```

---

### Task 14: Final verification

- [ ] **Step 1: Full type-check**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 2: Full test suite (excluding version consistency test)**

```bash
npx vitest run --reporter=verbose --exclude='src/utils/__tests__/versionConsistency.test.ts' 2>&1 | tail -10
```
Expected: All tests pass (same count as before + ~10 new tests).

- [ ] **Step 3: Verify CHANGELOG is up to date**

If any significant changes were made beyond what's already in the CHANGELOG, update it with relevant PBI-3 entries.

- [ ] **Step 4: Final commit**

```bash
git add -A && git commit -m "feat(pbi3): complete content retention and storage"
```
