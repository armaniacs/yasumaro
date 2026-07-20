# PBI-1: SQLite への診断メタデータ永続化 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) for syntax tracking.

**Goal:** Add 21 new columns to SQLite `browsing_logs` table for diagnostic metadata (tokens, bytes, AI info, durations, L0 extraction, fallback flag). Extend BrowsingLogRecord type, update pipeline to write these fields, add ALTER TABLE migration for existing DBs, and update insert/update in both sqlite.ts and opfsWorker.ts.

**Architecture:** Schema migration via `ALTER TABLE ADD COLUMN` with try/catch for idempotency. Pipeline `createSaveSqliteStep` extracts fields from context and passes to `saveSqliteStep`. New fields are nullable — existing records get NULL. Content column is added to schema but always saved as null (reserved for PBI-3).

**Tech Stack:** SQLite (wa-sqlite), OPFS Worker, TypeScript, Jest/Vitest

**Design doc:** `docs/superpowers/specs/2026-07-07-pbi1-sqlite-metadata-persist-design.md`

---

### Task 1: BrowsingLogRecord 型拡張

**Files:**
- Modify: `src/utils/sqlite-types.ts` (BrowsingLogRecord interface)

- [ ] **Step 1: Add new fields to BrowsingLogRecord interface**

```typescript
// src/utils/sqlite-types.ts — add after obsidian_synced
export interface BrowsingLogRecord {
  id?: number;
  url: string;
  title?: string | null;
  summary?: string | null;
  tags?: string | null;
  created_at: number;
  domain?: string | null;
  visit_duration?: number | null;
  scroll_ratio?: number | null;
  is_starred?: number;
  is_deleted?: number;
  obsidian_synced?: number;
  // === 新規フィールド (PBI-1) ===
  content?: string | null;
  masked_count?: number | null;
  cleansed_reason?: string | null;
  ai_provider?: string | null;
  ai_model?: string | null;
  ai_duration_ms?: number | null;
  obsidian_duration_ms?: number | null;
  sent_tokens?: number | null;
  received_tokens?: number | null;
  original_tokens?: number | null;
  cleansed_tokens?: number | null;
  page_bytes?: number | null;
  candidate_bytes?: number | null;
  original_bytes?: number | null;
  cleansed_bytes?: number | null;
  ai_summary_original_bytes?: number | null;
  ai_summary_cleansed_bytes?: number | null;
  extracted_sentences_bytes?: number | null;
  extracted_sentences_original_bytes?: number | null;
  fallback_triggered?: number | null;
}
```

Note: `BrowsingLogEntry` (`Omit<BrowsingLogRecord, 'is_deleted'> & { id: number }`) automatically inherits the new fields — no change needed.

- [ ] **Step 2: Run type-check to verify**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/utils/sqlite-types.ts
git commit -m "feat(pbi1): extend BrowsingLogRecord with diagnostic metadata fields"
```

---

### Task 2: スキーマ + ALTER TABLE マイグレーション

**Files:**
- Modify: `src/offscreen/schema.ts` (SCHEMA_SQL)
- Modify: `src/offscreen/sqlite.ts` (initDatabase — migration execution)

- [ ] **Step 1: Extend SCHEMA_SQL in schema.ts**

Replace the `CREATE TABLE IF NOT EXISTS browsing_logs` section in `src/offscreen/schema.ts` with the full column list:

```typescript
export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS browsing_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    title TEXT,
    summary TEXT,
    tags TEXT,
    created_at INTEGER NOT NULL,
    domain TEXT,
    visit_duration INTEGER CHECK(visit_duration IS NULL OR visit_duration >= 0),
    scroll_ratio REAL CHECK(scroll_ratio IS NULL OR (scroll_ratio >= 0 AND scroll_ratio <= 1)),
    is_starred INTEGER DEFAULT 0 CHECK(is_starred IN (0, 1)),
    is_deleted INTEGER DEFAULT 0 CHECK(is_deleted IN (0, 1)),
    obsidian_synced INTEGER DEFAULT 0,
    content TEXT,
    masked_count INTEGER,
    cleansed_reason TEXT,
    ai_provider TEXT,
    ai_model TEXT,
    ai_duration_ms INTEGER,
    obsidian_duration_ms INTEGER,
    sent_tokens INTEGER,
    received_tokens INTEGER,
    original_tokens INTEGER,
    cleansed_tokens INTEGER,
    page_bytes INTEGER,
    candidate_bytes INTEGER,
    original_bytes INTEGER,
    cleansed_bytes INTEGER,
    ai_summary_original_bytes INTEGER,
    ai_summary_cleansed_bytes INTEGER,
    extracted_sentences_bytes INTEGER,
    extracted_sentences_original_bytes INTEGER,
    fallback_triggered INTEGER DEFAULT 0,
    UNIQUE(url, created_at)
  );
  -- ... rest unchanged (indexes)
`;
```

- [ ] **Step 2: Add migration SQL and execution to initDatabase in sqlite.ts**

In `src/offscreen/sqlite.ts`, find the `initDatabase` function. After the `CREATE TABLE IF NOT EXISTS` / `exec` call, add the migration step:

```typescript
// After FTS5 schema creation in initDatabase(), around line ~230-250

// --- PBI-1: ALTER TABLE migration for new diagnostic metadata columns ---
// Each ALTER TABLE ADD COLUMN fails if column already exists, so we use try/catch.
const newColumns = [
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
];

for (const colDef of newColumns) {
  try {
    await sqlExec(`ALTER TABLE browsing_logs ADD COLUMN ${colDef}`);
  } catch {
    // Column already exists — safe to ignore
  }
}
```

Place this immediately after the schema creation block (after FTS5 creation), before any data operations.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/offscreen/schema.ts src/offscreen/sqlite.ts
git commit -m "feat(pbi1): extend SQLite schema with diagnostic metadata columns + migration"
```

---

### Task 3: sqlite.ts insert / update / batch-insert 更新

**Files:**
- Modify: `src/offscreen/sqlite.ts` (insert function, batch insert, migration insert, update, ALLOWED_ORDER_COLUMNS)

- [ ] **Step 1: Insert new columns into the individual `insert()` function SQL**

Find the `insert()` function (around line 504). Update the INSERT SQL and parameter bindings:

```typescript
// Before (line 505-506):
`INSERT INTO browsing_logs (url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio, is_starred, is_deleted)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

// After:
`INSERT INTO browsing_logs (
  url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio,
  is_starred, is_deleted, content, masked_count, cleansed_reason,
  ai_provider, ai_model, ai_duration_ms, obsidian_duration_ms,
  sent_tokens, received_tokens, original_tokens, cleansed_tokens,
  page_bytes, candidate_bytes, original_bytes, cleansed_bytes,
  ai_summary_original_bytes, ai_summary_cleansed_bytes,
  extracted_sentences_bytes, extracted_sentences_original_bytes,
  fallback_triggered
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,

// Before bindings (line 507-518):
[
  record.url,
  record.title ?? null,
  record.summary ?? null,
  record.tags ?? null,
  record.created_at,
  domain,
  record.visit_duration ?? null,
  record.scroll_ratio ?? null,
  record.is_starred ?? 0,
  record.is_deleted ?? 0,
]

// After bindings:
[
  record.url,
  record.title ?? null,
  record.summary ?? null,
  record.tags ?? null,
  record.created_at,
  domain,
  record.visit_duration ?? null,
  record.scroll_ratio ?? null,
  record.is_starred ?? 0,
  record.is_deleted ?? 0,
  record.content ?? null,
  record.masked_count ?? null,
  record.cleansed_reason ?? null,
  record.ai_provider ?? null,
  record.ai_model ?? null,
  record.ai_duration_ms ?? null,
  record.obsidian_duration_ms ?? null,
  record.sent_tokens ?? null,
  record.received_tokens ?? null,
  record.original_tokens ?? null,
  record.cleansed_tokens ?? null,
  record.page_bytes ?? null,
  record.candidate_bytes ?? null,
  record.original_bytes ?? null,
  record.cleansed_bytes ?? null,
  record.ai_summary_original_bytes ?? null,
  record.ai_summary_cleansed_bytes ?? null,
  record.extracted_sentences_bytes ?? null,
  record.extracted_sentences_original_bytes ?? null,
  record.fallback_triggered ?? 0,
]
```

- [ ] **Step 2: Insert new columns into the batch `insertBatch()` function**

Find the `insertBatch()` function (around line 562). Same change as Step 1 — update the INSERT SQL and parameters.

- [ ] **Step 3: Insert new columns into the migration helper insert**

Find the migration code block (around line 333). Same change — update the INSERT SQL and parameters.

- [ ] **Step 4: Insert new columns into `tryOpfsProxy`-based insert (offscreen.ts)**

In `src/offscreen/offscreen.ts`, find the `SQLITE_INSERT` handler (around line 300-320). The insert calls `sqlite.ts`'s `insert()` which handles both OPFS Worker and direct paths, so no change needed in `offscreen.ts`.

- [ ] **Step 5: Update `ALLOWED_ORDER_COLUMNS`**

In `src/offscreen/sqlite.ts`, add the new sortable columns:

```typescript
const ALLOWED_ORDER_COLUMNS = [
  'id', 'url', 'title', 'summary', 'tags', 'created_at',
  'domain', 'visit_duration', 'scroll_ratio', 'is_starred', 'is_deleted',
  // PBI-1: new sortable columns
  'ai_duration_ms', 'obsidian_duration_ms',
  'sent_tokens', 'received_tokens',
  'page_bytes', 'candidate_bytes',
  'fallback_triggered',
] as const;
```

Only add columns that make sense for sorting (numeric values). Skip TEXT columns like `ai_provider`, `ai_model` etc.

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 7: Run relevant tests**

```bash
npx vitest run --reporter=verbose src/offscreen/__tests__/ 2>&1 | tail -20
```

If any offscreen tests exist, they should pass. If no tests exist yet, verify with type-check only.

- [ ] **Step 8: Commit**

```bash
git add src/offscreen/sqlite.ts
git commit -m "feat(pbi1): update sqlite.ts insert/batch/ALLOWED_ORDER_COLUMNS with new columns"
```

---

### Task 4: opfsWorker.ts insert / update / batch-insert / migration 更新

**Files:**
- Modify: `src/offscreen/opfsWorker.ts` (handleInsert, handleInsertBatch, handleUpdate, handleOpenDatabase)

- [ ] **Step 1: Update handleInsert in opfsWorker.ts**

```typescript
// Around line 277 — update INSERT SQL
await sqlExec(
  `INSERT INTO browsing_logs (
    url, title, summary, tags, created_at, domain, visit_duration, scroll_ratio,
    is_starred, is_deleted, content, masked_count, cleansed_reason,
    ai_provider, ai_model, ai_duration_ms, obsidian_duration_ms,
    sent_tokens, received_tokens, original_tokens, cleansed_tokens,
    page_bytes, candidate_bytes, original_bytes, cleansed_bytes,
    ai_summary_original_bytes, ai_summary_cleansed_bytes,
    extracted_sentences_bytes, extracted_sentences_original_bytes,
    fallback_triggered
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [
    record.url, record.title ?? null, record.summary ?? null, record.tags ?? null,
    record.created_at, domain,
    record.visit_duration ?? null, record.scroll_ratio ?? null,
    record.is_starred ?? 0, record.is_deleted ?? 0,
    record.content ?? null,
    record.masked_count ?? null,
    record.cleansed_reason ?? null,
    record.ai_provider ?? null,
    record.ai_model ?? null,
    record.ai_duration_ms ?? null,
    record.obsidian_duration_ms ?? null,
    record.sent_tokens ?? null,
    record.received_tokens ?? null,
    record.original_tokens ?? null,
    record.cleansed_tokens ?? null,
    record.page_bytes ?? null,
    record.candidate_bytes ?? null,
    record.original_bytes ?? null,
    record.cleansed_bytes ?? null,
    record.ai_summary_original_bytes ?? null,
    record.ai_summary_cleansed_bytes ?? null,
    record.extracted_sentences_bytes ?? null,
    record.extracted_sentences_original_bytes ?? null,
    record.fallback_triggered ?? 0,
  ]
);
```

- [ ] **Step 2: Update handleInsertBatch in opfsWorker.ts**

Find `handleInsertBatch` (around line 410). Same change as Step 1 — update the INSERT SQL and parameters in the batch loop.

- [ ] **Step 3: Add ALTER TABLE migration to handleOpenDatabase in opfsWorker.ts**

Find the `handleOpenDatabase` function. After the schema creation (`CREATE TABLE IF NOT EXISTS`), add the same ALTER TABLE migration as in Task 2 Step 2:

```typescript
// In handleOpenDatabase, after schema creation + FTS5 setup

// PBI-1: ALTER TABLE migration for new columns
const newColumns = [
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
];

for (const colDef of newColumns) {
  try {
    await sqlExec(`ALTER TABLE browsing_logs ADD COLUMN ${colDef}`);
  } catch {
    // Column already exists — ignore
  }
}
```

Place this after the FTS5 setup and before any data operations.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/offscreen/opfsWorker.ts
git commit -m "feat(pbi1): update opfsWorker.ts insert/batch/migration with new columns"
```

---

### Task 5: Pipeline — createSaveSqliteStep 更新

**Files:**
- Modify: `src/background/pipeline/RecordingPipeline.ts` (createSaveSqliteStep)

- [ ] **Step 1: Add test for new fields in saveSqliteStep**

Create or modify test file `src/background/pipeline/__tests__/saveSqliteStep.test.ts`:

```typescript
// Add to existing describe block
describe('saveSqliteStep — PBI-1 diagnostic metadata', () => {
  it('passes full diagnostic metadata to BrowsingLogRecord', async () => {
    const mockInsert = vi.fn().mockResolvedValue({ id: 42 });
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const mockClient = { insert: mockInsert, update: mockUpdate } as unknown as SqliteClient;

    const record: BrowsingLogRecord = {
      url: 'https://example.com/page',
      title: 'Test Page',
      summary: 'AI summary text',
      tags: '#tag1 #tag2',
      created_at: Date.now(),
      domain: 'example.com',
      visit_duration: null,
      scroll_ratio: null,
      is_starred: 0,
      is_deleted: 0,
      // PBI-1 fields
      content: null,
      masked_count: 3,
      cleansed_reason: 'hard',
      ai_provider: 'openai',
      ai_model: 'gpt-4',
      ai_duration_ms: 5000,
      obsidian_duration_ms: 1200,
      sent_tokens: 100,
      received_tokens: 50,
      original_tokens: 200,
      cleansed_tokens: 150,
      page_bytes: 10000,
      candidate_bytes: 5000,
      original_bytes: 8000,
      cleansed_bytes: 4000,
      ai_summary_original_bytes: 2000,
      ai_summary_cleansed_bytes: 1500,
      extracted_sentences_bytes: 6000,
      extracted_sentences_original_bytes: 10000,
      fallback_triggered: 1,
    };

    await saveSqliteStep({
      recordId: 0,
      record,
      sqliteClient: mockClient,
    });

    expect(mockInsert).toHaveBeenCalledTimes(1);
    const insertedRecord = mockInsert.mock.calls[0][0] as BrowsingLogRecord;
    expect(insertedRecord.masked_count).toBe(3);
    expect(insertedRecord.ai_provider).toBe('openai');
    expect(insertedRecord.ai_duration_ms).toBe(5000);
    expect(insertedRecord.sent_tokens).toBe(100);
    expect(insertedRecord.fallback_triggered).toBe(1);
  });

  it('defaults new fields to null when not provided', async () => {
    const mockInsert = vi.fn().mockResolvedValue({ id: 1 });
    const mockClient = { insert: mockInsert, update: vi.fn() } as unknown as SqliteClient;

    // Minimal record — no PBI-1 fields
    const record: BrowsingLogRecord = {
      url: 'https://example.com/minimal',
      title: null,
      summary: null,
      tags: null,
      created_at: Date.now(),
      domain: 'example.com',
      visit_duration: null,
      scroll_ratio: null,
      is_starred: 0,
      is_deleted: 0,
    };

    await saveSqliteStep({
      recordId: 0,
      record,
      sqliteClient: mockClient,
    });

    const insertedRecord = mockInsert.mock.calls[0][0] as BrowsingLogRecord;
    expect(insertedRecord.content).toBeUndefined();
    expect(insertedRecord.ai_provider).toBeUndefined();
    expect(insertedRecord.sent_tokens).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test — should fail (new fields not yet in pipeline)**

```bash
npx vitest run src/background/pipeline/__tests__/saveSqliteStep.test.ts --reporter=verbose 2>&1 | tail -20
```
Expected: Tests exist and pass (the type is already extended in Task 1, and tests pass a direct BrowsingLogRecord, not through the pipeline).

- [ ] **Step 3: Update createSaveSqliteStep in RecordingPipeline.ts**

Find the `createSaveSqliteStep()` method (around line 153-188). Update the BrowsingLogRecord construction:

```typescript
// In RecordingPipeline.ts, inside createSaveSqliteStep()
private createSaveSqliteStep() {
  return async (context: RecordingContext): Promise<RecordingContext> => {
    if (!this.sqliteClient) {
      addLog(LogType.WARN, 'No SqliteClient available, skipping SQLite save', {
        url: context.data.url
      });
      return context;
    }

    const { data, privacyResult, aiDuration, obsidianDuration, extractedSentencesBytes, extractedSentencesOriginalBytes } = context;
    const { url, title } = data;

    // Build BrowsingLogRecord from pipeline context — including PBI-1 diagnostic fields
    const record: BrowsingLogRecord = {
      url,
      title: title || null,
      summary: privacyResult?.summary || null,
      tags: privacyResult?.tags && privacyResult.tags.length > 0
        ? privacyResult.tags.map(t => `#${t}`).join(' ')
        : null,
      created_at: Date.now(),
      domain: extractDomain(url) || null,
      visit_duration: null,
      scroll_ratio: null,
      is_starred: 0,
      is_deleted: 0,
      // PBI-1: diagnostic metadata
      content: null, // content storage reserved for PBI-3
      cleansed_reason: data.cleansedReason || null,
      masked_count: (data.maskedCount ?? privacyResult?.maskedCount) || null,
      ai_provider: privacyResult?.aiProvider || null,
      ai_model: privacyResult?.aiModel || null,
      ai_duration_ms: aiDuration ?? null,
      obsidian_duration_ms: obsidianDuration ?? null,
      sent_tokens: privacyResult?.sentTokens ?? null,
      received_tokens: privacyResult?.receivedTokens ?? null,
      original_tokens: privacyResult?.originalTokens ?? null,
      cleansed_tokens: privacyResult?.cleansedTokens ?? null,
      page_bytes: data.pageBytes ?? null,
      candidate_bytes: data.candidateBytes ?? null,
      original_bytes: data.originalBytes ?? null,
      cleansed_bytes: data.cleansedBytes ?? null,
      ai_summary_original_bytes: data.aiSummaryOriginalBytes ?? null,
      ai_summary_cleansed_bytes: data.aiSummaryCleansedBytes ?? null,
      extracted_sentences_bytes: extractedSentencesBytes ?? null,
      extracted_sentences_original_bytes: extractedSentencesOriginalBytes ?? null,
      fallback_triggered: data.fallbackTriggered ? 1 : 0,
    };

    // Use 0 as placeholder recordId (SQLite auto-generates real id)
    await saveSqliteStep({
      recordId: 0,
      record,
      sqliteClient: this.sqliteClient,
      obsidianSynced: obsidianDuration !== undefined ? true : undefined
    });

    addLog(LogType.INFO, 'Saved to SQLite with diagnostic metadata', { url, title });
    return context;
  };
}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 5: Run pipeline tests**

```bash
npx vitest run src/background/pipeline/__tests__/RecordingPipeline.test.ts --reporter=verbose 2>&1 | tail -20
```
Expected: All tests pass.

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run --reporter=verbose --exclude='src/utils/__tests__/versionConsistency.test.ts' 2>&1 | tail -10
```
Expected: 299 test files passed.

- [ ] **Step 7: Commit**

```bash
git add src/background/pipeline/RecordingPipeline.ts src/background/pipeline/__tests__/saveSqliteStep.test.ts
git commit -m "feat(pbi1): update pipeline to write diagnostic metadata to SQLite"
```

---

### Task 6: Integration — verify data round-trip

**Files:**
- Tests in `src/offscreen/__tests__/`

- [ ] **Step 1: Write integration test for insert → select round-trip with new fields**

Create `src/offscreen/__tests__/pbi1-metadata-roundtrip.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock chrome.storage.local (used by fallback)
vi.stubGlobal('chrome', {
  storage: { local: { get: vi.fn(), set: vi.fn(), remove: vi.fn() } },
  runtime: { getURL: vi.fn() },
});

describe('PBI-1: SQLite metadata round-trip', () => {
  it('BrowsingLogRecord type accepts all new fields', () => {
    const record: BrowsingLogRecord = {
      url: 'https://test.com',
      title: 'Test',
      summary: null,
      tags: null,
      created_at: Date.now(),
      domain: 'test.com',
      visit_duration: null,
      scroll_ratio: null,
      is_starred: 0,
      is_deleted: 0,
      // All new fields
      content: null,
      masked_count: 5,
      cleansed_reason: 'keyword',
      ai_provider: 'openai',
      ai_model: 'gpt-4',
      ai_duration_ms: 3000,
      obsidian_duration_ms: null,
      sent_tokens: 150,
      received_tokens: 75,
      original_tokens: 200,
      cleansed_tokens: 150,
      page_bytes: 5000,
      candidate_bytes: 2500,
      original_bytes: 4000,
      cleansed_bytes: 2000,
      ai_summary_original_bytes: 1000,
      ai_summary_cleansed_bytes: 800,
      extracted_sentences_bytes: 3000,
      extracted_sentences_original_bytes: 5000,
      fallback_triggered: 0,
    };

    // Verify all fields are accessible
    expect(record.masked_count).toBe(5);
    expect(record.cleansed_reason).toBe('keyword');
    expect(record.ai_provider).toBe('openai');
    expect(record.sent_tokens).toBe(150);
    expect(record.fallback_triggered).toBe(0);
  });

  it('new fields are optional (undefined allowed)', () => {
    const record: BrowsingLogRecord = {
      url: 'https://test.com',
      created_at: Date.now(),
    };

    // Must compile without type error
    expect(record.content).toBeUndefined();
    expect(record.ai_provider).toBeUndefined();
    expect(record.fallback_triggered).toBeUndefined();
  });

  it('BrowsingLogEntry inherits new fields', () => {
    const entry: BrowsingLogEntry = {
      id: 1,
      url: 'https://test.com',
      created_at: Date.now(),
      ai_provider: 'openai',
      sent_tokens: 100,
    };

    expect(entry.ai_provider).toBe('openai');
    expect(entry.sent_tokens).toBe(100);
  });
});
```

- [ ] **Step 2: Run new test**

```bash
npx vitest run src/offscreen/__tests__/pbi1-metadata-roundtrip.test.ts --reporter=verbose 2>&1
```
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/offscreen/__tests__/pbi1-metadata-roundtrip.test.ts
git commit -m "test(pbi1): add round-trip tests for diagnostic metadata fields"
```

---

### Task 7: Final verification

- [ ] **Step 1: Full type-check**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 2: Full test suite (excluding pre-existing version test)**

```bash
npx vitest run --reporter=verbose --exclude='src/utils/__tests__/versionConsistency.test.ts' 2>&1 | tail -10
```
Expected: 299 test files, 6070+ tests passed (should be at least as many as before + ~15 new tests).

- [ ] **Step 3: Verify CHANGELOG is up to date**

If any significant changes were made beyond what's already in the 6.5.5 entry, update `CHANGELOG.md` with relevant PBI-1 entries.

- [ ] **Step 4: Final commit**

```bash
git add -A && git commit -m "feat(pbi1): complete SQLite diagnostic metadata persistence"
```
