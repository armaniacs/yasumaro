# C5: Pipeline Mapper Extraction — Design Spec

**Date:** 2026-07-13
**Scope:** Extract the 30-field `BrowsingLogRecord` mapping from `RecordingPipeline.createSaveSqliteStep()` into a dedicated mapper module. Extract alarm/chrome.storage concerns from `saveLocalMarkdownStep` into a `MarkdownBufferManager`.

## Motivation

`RecordingPipeline.createSaveSqliteStep()` contains 68 lines (155-223) that destructure 15+ context fields, call `sanitizeRegex()`, `extractDomain()`, read `StorageKeys`, and construct a `BrowsingLogRecord`. `saveLocalMarkdownStep` imports alarm constants and calls `chrome.alarms` directly. The 5-Why deep-dig identified that the accumulate-and-map pattern itself is fine — the problem is the mapper living inline in the pipeline. A `StorageAdapter` interface is YAGNI (only 2 output targets, no 3rd planned).

## Decision

Extract two independent modules from the pipeline:

### 1. BrowsingLogRecordMapper

```typescript
// src/background/pipeline/mappers/BrowsingLogRecordMapper.ts

/**
 * Maps the accumulated RecordingContext to a BrowsingLogRecord.
 * Pure function — no side effects, no storage access, no chrome APIs.
 */
function mapToBrowsingLogRecord(context: RecordingContext): BrowsingLogRecord;
```

### 2. MarkdownBufferManager

```typescript
// src/background/pipeline/buffers/MarkdownBufferManager.ts

class MarkdownBufferManager {
  /** Add an entry to the buffer. Does NOT write to storage. */
  add(entry: MarkdownEntry): void;

  /** Write all buffered entries to chrome.storage.local. */
  flush(): Promise<void>;

  /** Schedule a daily flush via chrome.alarms. */
  scheduleDailyFlush(alarmName: string): void;

  /** Number of entries currently buffered. */
  get count(): number;
}
```

### Pipeline Changes

```typescript
// Before (RecordingPipeline.ts, ~68 lines inline):
createSaveSqliteStep() {
  return async (context) => {
    const {
      url, title, content, summary, tags, visitedAt,
      duration, scrollDepth, readingTime, ...
    } = context;
    const contentStorageEnabled = await getSetting(StorageKeys.CONTENT_STORAGE_ENABLED);
    const sanitized = sanitizeRegex(context.truncatedContent ?? '');
    const record: BrowsingLogRecord = {
      url, title,
      domain: extractDomain(url),
      content: contentStorageEnabled ? sanitized : '',
      // ... 30 fields total
    };
    await saveSqliteStep({ recordId: context.recordId, record, sqliteClient: this.sqliteClient });
  };
}

// After:
createSaveSqliteStep() {
  return async (context) => {
    const record = mapToBrowsingLogRecord(context);
    await saveSqliteStep({
      recordId: context.recordId,
      record,
      sqliteClient: this.sqliteClient,
    });
  };
}
```

### Files Changed

| File | Change |
|------|--------|
| `src/background/pipeline/mappers/BrowsingLogRecordMapper.ts` | New: pure mapping function |
| `src/background/pipeline/buffers/MarkdownBufferManager.ts` | New: alarm + storage management |
| `src/background/pipeline/RecordingPipeline.ts` | Remove inline mapping code; call mapper. Remove inline alarm calls; use MarkdownBufferManager |
| `src/background/pipeline/steps/saveLocalMarkdownStep.ts` | Remove `chrome.alarms` / `chrome.storage.local` direct access; use MarkdownBufferManager |

### What Gets Deleted

- `RecordingPipeline.ts` lines 155-223 (inline BrowsingLogRecord construction)
- `saveLocalMarkdownStep.ts` direct `chrome.alarms.create` / `chrome.alarms.clear` calls
- `saveLocalMarkdownStep.ts` direct `chrome.storage.local.get` / `chrome.storage.local.set` calls

### What Does NOT Change

- `RecordingContext` shape — the accumulate-and-map pattern stays
- `RecordingPipeline` orchestration — step ordering, conditional execution, error handling
- `saveSqliteStep` function signature — it already accepts a `BrowsingLogRecord`
- `saveToObsidianStep` — already clean, no mapping logic

### Tests

- **Unit**: `mapToBrowsingLogRecord` — given a full context, assert all 30 fields mapped correctly
- **Unit**: `mapToBrowsingLogRecord` — given partial context (content disabled), assert content field is empty
- **Unit**: `mapToBrowsingLogRecord` — PII sanitized content flows through
- **Unit**: `MarkdownBufferManager` — add/flush/schedule cycle
- **Unit**: `MarkdownBufferManager` — deduplication of alarm scheduling

### Future: StorageAdapter

If a 3rd output target is concretely planned (e.g., Notion API), introduce:

```typescript
interface StorageAdapter {
  write(event: RecordingCompletedEvent): Promise<void>;
}
```

`BrowsingLogRecordMapper` becomes an implementation detail of `SqliteAdapter`. This is deferred (YAGNI).
