# 監査ログ / データ送信の可視化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** クラウドAIプロバイダーへの要約送信イベント（プロバイダー名・URL・日時のみ、本文やPIIは含まない）をSQLite新規テーブル `audit_log` に記録し、ダッシュボードで時系列閲覧できるようにする。

**Architecture:** `src/offscreen/schema.ts` に `audit_log` テーブルを追加し、`src/offscreen/sqlite.ts` に insert/query関数を実装。`src/background/aiClient.ts` の `generateSummary()` 内、各プロバイダー呼び出し直前に新規 `src/utils/auditLog.ts` の `recordAuditLog()` を呼ぶ。`recordAuditLog()` は `SqliteClient` 経由でoffscreen documentにメッセージを送り、書き込み失敗時は例外を投げず `logError` のみ行う（ベストエフォート）。新規ダッシュボードパネル `src/dashboard/auditLogPanel.ts` で一覧表示する。

**Tech Stack:** TypeScript, Vitest, Chrome Extension Manifest V3, SQLite (wa-sqlite / OPFS)

---

### Task 1: `audit_log` テーブルのスキーマを追加する

**Files:**
- Modify: `src/offscreen/schema.ts`

- [ ] **Step 1: スキーマ定義を追加する**

`src/offscreen/schema.ts` の末尾（`FTS5_SQL` の後）に以下を追加する:

```typescript
/**
 * Audit log for cloud AI provider send events.
 * Records provider name, target URL, and timestamp only — never content or PII.
 */
export const AUDIT_LOG_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
`;
```

- [ ] **Step 2: `sqlite.ts` の `init()` でスキーマを適用する**

`src/offscreen/sqlite.ts:31` のimportを確認し、以下のように `AUDIT_LOG_SCHEMA_SQL` を追加する:

```typescript
import { SCHEMA_SQL, FTS5_SQL, AUDIT_LOG_SCHEMA_SQL } from './schema.js';
```

`src/offscreen/sqlite.ts:244` の直後（`await sqlite3.exec(dbHandle, SCHEMA_SQL);` の次の行）に追加する:

```typescript
    await sqlite3.exec(dbHandle, SCHEMA_SQL);
    await sqlite3.exec(dbHandle, AUDIT_LOG_SCHEMA_SQL);
```

- [ ] **Step 3: `opfsWorker.ts` でもスキーマを適用する**

`src/offscreen/opfsWorker.ts:96` のimportを以下に置き換える:

```typescript
import { SCHEMA_SQL, FTS5_STATEMENTS, AUDIT_LOG_SCHEMA_SQL } from './schema.js';
```

`src/offscreen/opfsWorker.ts:138`（`await engine.exec(SCHEMA_SQL);` の行）の直後に追加する:

```typescript
  await engine.exec(SCHEMA_SQL);
  await engine.exec(AUDIT_LOG_SCHEMA_SQL);
```

- [ ] **Step 4: 型チェックを実行する**

Run: `npm run type-check`
Expected: エラーなし（新規エクスポートの構文確認のみ。まだテストは追加していない）

- [ ] **Step 5: コミット**

```bash
git add src/offscreen/schema.ts src/offscreen/sqlite.ts src/offscreen/opfsWorker.ts
git commit -m "feat(schema): audit_logテーブルのスキーマを追加"
```

---

### Task 2: `src/offscreen/sqlite.ts` に `insertAuditLog` / `queryAuditLog` を実装する

**Files:**
- Modify: `src/offscreen/sqlite.ts`
- Test: `src/offscreen/__tests__/sqlite-auditLog.test.ts`（新規）

- [ ] **Step 1: 失敗させるテストを書く**

`src/offscreen/__tests__/sqlite-auditLog.test.ts` を新規作成する（既存の `src/offscreen/__tests__/sqlite.test.ts` の `init()` 呼び出しパターンを参考にする）:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { init, insertAuditLog, queryAuditLog, _resetForTesting } from '../sqlite.js';

describe('audit_log', () => {
  beforeEach(async () => {
    _resetForTesting();
    await init();
  });

  it('inserts an audit log entry and returns its id', async () => {
    const result = await insertAuditLog({ provider: 'gemini', url: 'https://example.com/page', created_at: 1700000000000 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.id).toBeGreaterThan(0);
    }
  });

  it('queries audit log entries ordered by created_at DESC', async () => {
    await insertAuditLog({ provider: 'gemini', url: 'https://example.com/a', created_at: 1000 });
    await insertAuditLog({ provider: 'openai', url: 'https://example.com/b', created_at: 2000 });

    const result = await queryAuditLog({ limit: 10, offset: 0 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].url).toBe('https://example.com/b');
      expect(result.rows[1].url).toBe('https://example.com/a');
    }
  });

  it('respects limit and offset', async () => {
    await insertAuditLog({ provider: 'gemini', url: 'https://example.com/a', created_at: 1000 });
    await insertAuditLog({ provider: 'openai', url: 'https://example.com/b', created_at: 2000 });
    await insertAuditLog({ provider: 'gemini', url: 'https://example.com/c', created_at: 3000 });

    const result = await queryAuditLog({ limit: 1, offset: 1 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].url).toBe('https://example.com/b');
    }
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/offscreen/__tests__/sqlite-auditLog.test.ts`
Expected: FAIL（`insertAuditLog` / `queryAuditLog` が存在しないため、importエラーになる）

- [ ] **Step 3: `AuditLogRecord` / `AuditLogEntry` 型を追加する**

`src/utils/sqlite-types.ts` の末尾に追加する:

```typescript
export interface AuditLogRecord {
  provider: string;
  url: string;
  created_at: number;
}

export interface AuditLogEntry extends AuditLogRecord {
  id: number;
}
```

- [ ] **Step 4: `insertAuditLog` / `queryAuditLog` を実装する**

`src/offscreen/sqlite.ts` の `import` 群に以下を追加する（既存の `BrowsingLogRecord` 等のimport行を確認し、同じ場所に追加）:

```typescript
import type { AuditLogRecord, AuditLogEntry } from '../utils/sqlite-types.js';
```

`src/offscreen/sqlite.ts` の `insert()` 関数（476-530行目）の直後に以下を追加する:

```typescript
/**
 * Insert an audit log entry (cloud AI provider send event).
 * Metadata only — never content or PII.
 */
export async function insertAuditLog(record: AuditLogRecord): Promise<{ success: true; id: number } | { success: false; error: string }> {
  try {
    if (!dbHandle && !usingFallbackStorage) {
      await init();
    }

    if (!dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    await execWithCache(
      `INSERT INTO audit_log (provider, url, created_at) VALUES (?, ?, ?)`,
      [record.provider, record.url, record.created_at]
    );

    let newId = 0;
    await execWithCache('SELECT last_insert_rowid()', [], (row: SqliteValue[]) => {
      newId = Number(row[0]);
    });

    return { success: true, id: newId };
  } catch (error) {
    logError('SQLite: insertAuditLog failed', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}

/**
 * Query audit log entries, most recent first by default.
 */
export async function queryAuditLog(options: { limit?: number; offset?: number } = {}): Promise<
  { success: true; rows: AuditLogEntry[]; total: number } | { success: false; error: string }
> {
  try {
    if (!dbHandle && !usingFallbackStorage) {
      await init();
    }

    if (!dbHandle) {
      return { success: false, error: 'Database not initialized' };
    }

    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;

    const rows: AuditLogEntry[] = [];
    await execWithCache(
      `SELECT id, provider, url, created_at FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset],
      (row: SqliteValue[]) => {
        rows.push({
          id: Number(row[0]),
          provider: String(row[1]),
          url: String(row[2]),
          created_at: Number(row[3]),
        });
      }
    );

    let total = 0;
    await execWithCache('SELECT COUNT(*) FROM audit_log', [], (row: SqliteValue[]) => {
      total = Number(row[0]);
    });

    return { success: true, rows, total };
  } catch (error) {
    logError('SQLite: queryAuditLog failed', { error: errorMessage(error) }, ErrorCode.STORAGE_WRITE_FAILURE, 'sqlite');
    return { success: false, error: errorMessage(error) };
  }
}
```

**注記:** `execWithCache` のシグネチャ・`SqliteValue` 型・`logError`/`ErrorCode`/`errorMessage` の import は既存の `insert()` 関数と同じものを使う（`sqlite.ts` 冒頭で既にimport済み）。OPFS Workerパス（`opfsWorker` 分岐）は本タスクでは対応せず、Task 5で別途対応する。

- [ ] **Step 5: テストが通ることを確認する**

Run: `npx vitest run src/offscreen/__tests__/sqlite-auditLog.test.ts`
Expected: PASS（全3ケース）

- [ ] **Step 6: コミット**

```bash
git add src/offscreen/sqlite.ts src/utils/sqlite-types.ts src/offscreen/__tests__/sqlite-auditLog.test.ts
git commit -m "feat(sqlite): audit_logのinsert/query関数を実装"
```

---

### Task 3: `SqliteClient` / `offscreen.ts` に `SQLITE_AUDIT_LOG_INSERT` / `SQLITE_AUDIT_LOG_QUERY` メッセージを追加する

**Files:**
- Modify: `src/background/sqliteClient.ts`
- Modify: `src/offscreen/offscreen.ts`
- Test: `src/background/__tests__/sqliteClient-auditLog.test.ts`（新規）

- [ ] **Step 1: 失敗させるテストを書く**

`src/background/__tests__/sqliteClient-auditLog.test.ts` を新規作成する（既存の `src/background/__tests__/sqliteClient.test.ts` の `chrome.runtime.sendMessage` モックパターンを踏襲する）:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SqliteClient } from '../sqliteClient.js';

describe('SqliteClient audit log methods', () => {
  let client: SqliteClient;

  beforeEach(() => {
    client = new SqliteClient();
    global.chrome = {
      offscreen: {
        hasDocument: vi.fn().mockResolvedValue(true),
        createDocument: vi.fn(),
        Reason: { WORKERS: 'WORKERS', LOCAL_STORAGE: 'LOCAL_STORAGE' },
      },
      runtime: {
        id: 'test-extension-id',
        sendMessage: vi.fn((msg, callback) => {
          if (msg.type === 'SQLITE_AUDIT_LOG_INSERT') {
            callback({ success: true, id: 42 });
          } else if (msg.type === 'SQLITE_AUDIT_LOG_QUERY') {
            callback({ success: true, rows: [{ id: 1, provider: 'gemini', url: 'https://example.com', created_at: 1000 }], total: 1 });
          }
        }),
        lastError: undefined,
      },
    } as unknown as typeof chrome;
  });

  it('insertAuditLog sends SQLITE_AUDIT_LOG_INSERT and returns id', async () => {
    const result = await client.insertAuditLog({ provider: 'gemini', url: 'https://example.com', created_at: 1000 });
    expect(result).toEqual({ id: 42 });
  });

  it('queryAuditLog sends SQLITE_AUDIT_LOG_QUERY and returns rows', async () => {
    const result = await client.queryAuditLog({ limit: 10, offset: 0 });
    expect(result?.rows).toHaveLength(1);
    expect(result?.total).toBe(1);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/background/__tests__/sqliteClient-auditLog.test.ts`
Expected: FAIL（`insertAuditLog` / `queryAuditLog` メソッドが `SqliteClient` に存在しない）

- [ ] **Step 3: `SqliteClient` にメソッドを追加する**

`src/background/sqliteClient.ts` の `purgeOldRecords`（249-255行目）の直後に追加する:

```typescript
  async insertAuditLog(record: { provider: string; url: string; created_at: number }): Promise<{ id: number } | null> {
    return this.call<{ id: number }>(
      'SQLITE_AUDIT_LOG_INSERT',
      record,
      (res) => ({ id: Number(res.id) }),
    );
  }

  async queryAuditLog(options: { limit?: number; offset?: number } = {}): Promise<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number } | null> {
    return this.call<{ rows: Array<{ id: number; provider: string; url: string; created_at: number }>; total: number }>(
      'SQLITE_AUDIT_LOG_QUERY',
      options,
      (res) => ({
        rows: (res.rows || []) as Array<{ id: number; provider: string; url: string; created_at: number }>,
        total: Number(res.total || 0),
      }),
    );
  }
```

- [ ] **Step 4: `offscreen.ts` にメッセージハンドラを追加する**

`src/offscreen/offscreen.ts:8` のimportに `insertAuditLog as sqliteInsertAuditLog, queryAuditLog as sqliteQueryAuditLog` を追加する:

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
  clearAll as sqliteClearAll,
  purgeOldRecords as sqlitePurgeOldRecords,
  insertAuditLog as sqliteInsertAuditLog,
  queryAuditLog as sqliteQueryAuditLog,
  _resetForTesting as sqliteResetForTesting,
} from './sqlite.js';
```

`src/offscreen/offscreen.ts:250`（`SQLITE_QUERY` 分岐の `sendResponse(result);` の直後、`SQLITE_SEARCH` 分岐の前）に追加する:

```typescript
            } else if (msg.type === 'SQLITE_AUDIT_LOG_INSERT') {
                const payload = msg.payload as Record<string, unknown>;
                const result = await sqliteInsertAuditLog({
                    provider: String(payload.provider || ''),
                    url: String(payload.url || ''),
                    created_at: Number(payload.created_at || Date.now()),
                });
                sendResponse(result);

            } else if (msg.type === 'SQLITE_AUDIT_LOG_QUERY') {
                const payload = msg.payload as Record<string, unknown> | undefined;
                const result = await sqliteQueryAuditLog({
                    limit: payload?.limit != null ? Number(payload.limit) : undefined,
                    offset: payload?.offset != null ? Number(payload.offset) : undefined,
                });
                sendResponse(result);

```

- [ ] **Step 5: テストが通ることを確認する**

Run: `npx vitest run src/background/__tests__/sqliteClient-auditLog.test.ts`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/background/sqliteClient.ts src/offscreen/offscreen.ts src/background/__tests__/sqliteClient-auditLog.test.ts
git commit -m "feat(sqlite): audit_log用のoffscreenメッセージハンドラを追加"
```

---

### Task 4: `src/utils/auditLog.ts` の `recordAuditLog` / `getAuditLogs` を実装する

**Files:**
- Create: `src/utils/auditLog.ts`
- Test: `src/utils/__tests__/auditLog.test.ts`（新規）

- [ ] **Step 1: 失敗させるテストを書く**

`src/utils/__tests__/auditLog.test.ts` を新規作成する:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { recordAuditLog, getAuditLogs } from '../auditLog.js';
import { SqliteClient } from '../../background/sqliteClient.js';

vi.mock('../../background/sqliteClient.js', () => ({
  SqliteClient: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  logError: vi.fn(),
}));

describe('auditLog', () => {
  let mockInsertAuditLog: ReturnType<typeof vi.fn>;
  let mockQueryAuditLog: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockInsertAuditLog = vi.fn().mockResolvedValue({ id: 1 });
    mockQueryAuditLog = vi.fn().mockResolvedValue({ rows: [], total: 0 });
    (SqliteClient as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      insertAuditLog: mockInsertAuditLog,
      queryAuditLog: mockQueryAuditLog,
    }));
  });

  it('recordAuditLog calls SqliteClient.insertAuditLog with provider, url, and a timestamp', async () => {
    await recordAuditLog({ provider: 'gemini', url: 'https://example.com/page' });

    expect(mockInsertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'gemini', url: 'https://example.com/page' })
    );
    const callArg = mockInsertAuditLog.mock.calls[0][0];
    expect(typeof callArg.created_at).toBe('number');
  });

  it('recordAuditLog does not throw when insertAuditLog rejects', async () => {
    mockInsertAuditLog.mockRejectedValue(new Error('offscreen unreachable'));

    await expect(recordAuditLog({ provider: 'gemini', url: 'https://example.com/page' })).resolves.toBeUndefined();
  });

  it('getAuditLogs delegates to SqliteClient.queryAuditLog', async () => {
    mockQueryAuditLog.mockResolvedValue({
      rows: [{ id: 1, provider: 'gemini', url: 'https://example.com', created_at: 1000 }],
      total: 1,
    });

    const result = await getAuditLogs({ limit: 10, offset: 0 });

    expect(mockQueryAuditLog).toHaveBeenCalledWith({ limit: 10, offset: 0 });
    expect(result.rows).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/utils/__tests__/auditLog.test.ts`
Expected: FAIL（`src/utils/auditLog.ts` が存在しない）

- [ ] **Step 3: `src/utils/auditLog.ts` を実装する**

```typescript
/**
 * auditLog.ts
 * Records cloud AI provider send events for user-facing transparency.
 * Metadata only (provider, url, timestamp) — never content or PII.
 */

import { SqliteClient } from '../background/sqliteClient.js';
import { logError } from './logger.js';
import { errorMessage } from './errorUtils.js';

export interface AuditLogEntry {
  id: number;
  provider: string;
  url: string;
  created_at: number;
}

const sqliteClient = new SqliteClient();

/**
 * Record that content was sent to a cloud AI provider.
 * Best-effort: failures are logged but never thrown, so summary generation is never blocked.
 */
export async function recordAuditLog({ provider, url }: { provider: string; url: string }): Promise<void> {
  try {
    await sqliteClient.insertAuditLog({ provider, url, created_at: Date.now() });
  } catch (error: unknown) {
    logError('Failed to record audit log', { provider, error: errorMessage(error) });
  }
}

/**
 * Retrieve audit log entries, most recent first.
 */
export async function getAuditLogs({ limit = 100, offset = 0 }: { limit?: number; offset?: number } = {}): Promise<{ rows: AuditLogEntry[]; total: number }> {
  const result = await sqliteClient.queryAuditLog({ limit, offset });
  return result ?? { rows: [], total: 0 };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/utils/__tests__/auditLog.test.ts`
Expected: PASS（全3ケース）

- [ ] **Step 5: コミット**

```bash
git add src/utils/auditLog.ts src/utils/__tests__/auditLog.test.ts
git commit -m "feat(audit-log): recordAuditLog/getAuditLogsを実装"
```

---

### Task 4.5: `SqliteClient.call` の失敗レスポンスと `insertAuditLog` の関係を確認する

**Files:** なし（検証のみ、コード変更なし）

- [ ] **Step 1: `SqliteClient.call` の失敗時挙動を確認する**

`src/background/sqliteClient.ts:122-140` の `private async call<T>(...)` を確認する。`insertAuditLog` / `queryAuditLog` が例外時に `null` を返す（例外を投げない）ことを踏まえ、Task 4の `recordAuditLog` の `try/catch` は `SqliteClient` 側で吸収済みの `null` 応答もカバーする必要がある。

- [ ] **Step 2: `recordAuditLog` を修正して `null` 応答も検知する**

`src/utils/auditLog.ts` の `recordAuditLog` を以下に置き換える:

```typescript
export async function recordAuditLog({ provider, url }: { provider: string; url: string }): Promise<void> {
  try {
    const result = await sqliteClient.insertAuditLog({ provider, url, created_at: Date.now() });
    if (result === null) {
      logError('Failed to record audit log', { provider, error: 'insertAuditLog returned null' });
    }
  } catch (error: unknown) {
    logError('Failed to record audit log', { provider, error: errorMessage(error) });
  }
}
```

- [ ] **Step 3: 既存テストが引き続き通ることを確認する**

Run: `npx vitest run src/utils/__tests__/auditLog.test.ts`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
git add src/utils/auditLog.ts
git commit -m "fix(audit-log): SqliteClientのnull応答も失敗としてログする"
```

---

### Task 5: `aiClient.generateSummary()` に監査記録フックと `url` 引数を追加する

**Files:**
- Modify: `src/background/aiClient.ts`
- Modify: `src/background/privacyPipeline.ts`
- Test: `src/background/__tests__/aiClient.test.ts`

- [ ] **Step 1: 失敗させるテストを書く**

`src/background/__tests__/aiClient.test.ts` 内、既存の `describe('generateSummary', ...)` ブロックに以下を追記する（ファイル冒頭のモック宣言に `vi.mock('../../utils/auditLog.js', () => ({ recordAuditLog: vi.fn() }));` を追加した上で使う）:

```typescript
import { recordAuditLog } from '../../utils/auditLog.js';

// ファイル冒頭のvi.mock群に追加:
// vi.mock('../../utils/auditLog.js', () => ({ recordAuditLog: vi.fn() }));

  it('calls recordAuditLog with the provider name and url before generating a cloud summary', async () => {
    const client = new AIClient();
    // 既存のテストセットアップに合わせて gemini プロバイダーが success を返すようモックする
    await client.generateSummary('some content', false, 'https://example.com/audit-test');

    expect(recordAuditLog).toHaveBeenCalledWith({ provider: 'gemini', url: 'https://example.com/audit-test' });
  });

  it('records audit log for each provider tried during fallback', async () => {
    // フォールバックが発生する既存テストのモック設定（1位失敗→2位成功）を流用し、
    // recordAuditLog が2回、それぞれのプロバイダー名で呼ばれることを確認する
    const client = new AIClient();
    await client.generateSummary('some content', false, 'https://example.com/fallback-test');

    expect(recordAuditLog).toHaveBeenCalledTimes(2);
  });
```

**注記:** 上記2つ目のテストは、そのテストファイル内に既に存在するフォールバック検証テスト（1位プロバイダー失敗→2位成功のシナリオ）と同じモック設定を前提にしている。実装者は既存のフォールバックテストのモック構成を確認し、そのセットアップの直後に追記すること。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/background/__tests__/aiClient.test.ts -t "recordAuditLog"`
Expected: FAIL（`generateSummary` が3引数を受け取らず、`recordAuditLog` が呼ばれないため）

- [ ] **Step 3: `generateSummary()` に `url` 引数と監査記録フックを追加する**

`src/background/aiClient.ts:1` のimportに追加する:

```typescript
import { recordAuditLog } from '../utils/auditLog.js';
```

`src/background/aiClient.ts:58-91` の `generateSummary` メソッドを以下に置き換える:

```typescript
    async generateSummary(content: string, tagSummaryMode: boolean = false, url: string = ''): Promise<AISummaryResult> {
        const settings = await getSettings();
        const minLength = (settings[StorageKeys.SUMMARY_MIN_LENGTH] as number) || 0;
        const slots = this.resolveProviderSlots(settings);

        let lastResult: AISummaryResult = {
            success: false,
            summary: "Error: AI provider configuration is missing. Please check your settings."
        };

        for (const slot of slots) {
            const factory = this.providers.get(slot.provider);
            if (!factory) {
                addLog(LogType.ERROR, `Unknown AI Provider: ${slot.provider}`);
                continue;
            }

            const effectiveSettings = this.applySlotModel(settings, slot);

            void recordAuditLog({ provider: slot.provider, url });

            try {
                const providerInstance = factory(effectiveSettings);
                const result = await providerInstance.generateSummary(content, tagSummaryMode);
                if (result.success && result.summary.length >= minLength) {
                    return result;
                }
                lastResult = result;
            } catch (error: unknown) {
                addLog(LogType.ERROR, `Generate summary failed: ${errorMessage(error)}`);
                lastResult = { success: false, summary: "Error: Failed to generate summary. Please try again." };
            }
        }

        return lastResult;
    }
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/background/__tests__/aiClient.test.ts`
Expected: PASS（全テストケース。既存の `generateSummary` 呼び出しテストで `url` 引数を渡していないものも、デフォルト値 `''` により壊れないこと）

- [ ] **Step 5: `privacyPipeline.ts` から `url` を伝播させる**

`src/background/privacyPipeline.ts` の `generateSummary()` 呼び出し箇所（L133付近）を確認し、`url` を渡すよう修正する。まず現状の呼び出し元を特定するテストを書く:

`src/background/__tests__/privacyPipeline.test.ts` の該当する `describe` ブロックに追記する:

```typescript
  it('passes the url to aiClient.generateSummary when using cloud AI', async () => {
    // 既存のfull_pipelineモードのテストセットアップを使い、
    // mockAiClient.generateSummary の呼び出し引数にurlが含まれることを確認する
    const pipeline = new PrivacyPipeline(mockAiClient, mockSettings, mockSanitizers);
    await pipeline.process('some content', { url: 'https://example.com/pipeline-test' });

    expect(mockAiClient.generateSummary).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Boolean),
      'https://example.com/pipeline-test'
    );
  });
```

**注記:** `PrivacyPipeline` のコンストラクタ引数・`process()` のシグネチャは実装者が既存コード（`src/background/privacyPipeline.ts` 冒頭のクラス定義）を確認し、実際のシグネチャに合わせてテストを調整すること。`url` が `process()` の引数にまだ存在しない場合は、呼び出し元（`RecordingPipeline` の `processPrivacyPipelineStep.ts`）まで遡って `url` を渡せるようにする必要がある。

- [ ] **Step 6: テストが失敗することを確認する**

Run: `npx vitest run src/background/__tests__/privacyPipeline.test.ts -t "passes the url"`
Expected: FAIL

- [ ] **Step 7: `privacyPipeline.ts` を修正して `url` を伝播させる**

`src/background/privacyPipeline.ts` の `process()` メソッドのシグネチャに `url` を追加し、L133の `this.aiClient.generateSummary(processingText, options.tagSummaryMode)` を以下に置き換える:

```typescript
      const aiResult = await this.aiClient.generateSummary(processingText, options.tagSummaryMode, url);
```

`process()` メソッドの引数リストに `url: string` を追加し、呼び出し元（`src/background/pipeline/steps/processPrivacyPipelineStep.ts`）でも `context.data.url` を渡すよう修正する。

- [ ] **Step 8: 全体テストが通ることを確認する**

Run: `npx vitest run src/background/__tests__/aiClient.test.ts src/background/__tests__/privacyPipeline.test.ts src/background/pipeline/steps/__tests__/processPrivacyPipelineStep.test.ts`
Expected: PASS（全テストケース。既存テストの回帰なし）

- [ ] **Step 9: コミット**

```bash
git add src/background/aiClient.ts src/background/privacyPipeline.ts src/background/pipeline/steps/processPrivacyPipelineStep.ts src/background/__tests__/aiClient.test.ts src/background/__tests__/privacyPipeline.test.ts
git commit -m "feat(audit-log): aiClient.generateSummaryに監査記録フックとurl引数を追加"
```

---

### Task 6: `local_only` モードでは監査ログが記録されないことを回帰確認する

**Files:**
- Test: `src/background/__tests__/privacyPipeline.test.ts`

- [ ] **Step 1: 失敗させるテスト（回帰防止）を書く**

`src/background/__tests__/privacyPipeline.test.ts` に追記する:

```typescript
  it('does not call aiClient.generateSummary in local_only mode (no audit log recorded)', async () => {
    const pipeline = new PrivacyPipeline(mockAiClient, { ...mockSettings, [StorageKeys.PRIVACY_MODE]: 'local_only' }, mockSanitizers);
    // ローカルAIが正常に要約を返すようモック（既存のlocal_onlyテストのセットアップを踏襲）
    await pipeline.process('some content', { url: 'https://example.com/local-only-test' });

    expect(mockAiClient.generateSummary).not.toHaveBeenCalled();
  });

  it('calls aiClient.generateSummary (and thus records audit log) in masked_cloud mode', async () => {
    const pipeline = new PrivacyPipeline(mockAiClient, { ...mockSettings, [StorageKeys.PRIVACY_MODE]: 'masked_cloud' }, mockSanitizers);
    await pipeline.process('some content', { url: 'https://example.com/masked-cloud-test' });

    expect(mockAiClient.generateSummary).toHaveBeenCalled();
  });
```

- [ ] **Step 2: テストを実行し結果を確認する**

Run: `npx vitest run src/background/__tests__/privacyPipeline.test.ts -t "local_only mode|masked_cloud mode"`
Expected: PASS（Task 5までの実装により、既存の `useCloudAi` 分岐ロジックがそのまま両モードの差を保証しているため、追加実装は不要。このタスクは回帰確認のみ）

- [ ] **Step 3: コミット**

```bash
git add src/background/__tests__/privacyPipeline.test.ts
git commit -m "test(audit-log): local_only/masked_cloudでの監査ログ記録有無を回帰確認"
```

---

### Task 7: ダッシュボードに監査ログパネルを追加する

**Files:**
- Create: `src/dashboard/auditLogPanel.ts`
- Modify: `entrypoints/options/index.html`
- Test: `src/dashboard/__tests__/auditLogPanel.test.ts`（新規）

- [ ] **Step 1: 失敗させるテストを書く**

`src/dashboard/__tests__/auditLogPanel.test.ts` を新規作成する（既存の `src/dashboard/__tests__/sqliteHistoryPanel.test.ts` のDOM構造・モックパターンを参考にする）:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initAuditLogPanel } from '../auditLogPanel.js';
import * as auditLog from '../../utils/auditLog.js';

vi.mock('../../utils/auditLog.js');
vi.mock('../../popup/i18n.js', () => ({ getMessage: (key: string) => `i18n_${key}` }));

describe('auditLogPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="auditLogList"></div>
      <div id="auditLogEmptyState" hidden></div>
    `;
  });

  it('renders audit log rows when entries exist', async () => {
    vi.spyOn(auditLog, 'getAuditLogs').mockResolvedValue({
      rows: [{ id: 1, provider: 'gemini', url: 'https://example.com', created_at: 1700000000000 }],
      total: 1,
    });

    await initAuditLogPanel();

    const list = document.getElementById('auditLogList');
    expect(list?.children.length).toBe(1);
    expect(list?.textContent).toContain('gemini');
    expect(list?.textContent).toContain('https://example.com');
  });

  it('shows empty state when no entries exist', async () => {
    vi.spyOn(auditLog, 'getAuditLogs').mockResolvedValue({ rows: [], total: 0 });

    await initAuditLogPanel();

    const emptyState = document.getElementById('auditLogEmptyState') as HTMLElement;
    expect(emptyState.hidden).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run src/dashboard/__tests__/auditLogPanel.test.ts`
Expected: FAIL（`src/dashboard/auditLogPanel.ts` が存在しない）

- [ ] **Step 3: `src/dashboard/auditLogPanel.ts` を実装する**

```typescript
/**
 * auditLogPanel.ts
 * Displays cloud AI provider send events (audit log) in the dashboard.
 */

import { getAuditLogs } from '../utils/auditLog.js';
import { getMessage } from '../popup/i18n.js';

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

export async function initAuditLogPanel(): Promise<void> {
  const list = document.getElementById('auditLogList');
  const emptyState = document.getElementById('auditLogEmptyState') as HTMLElement | null;
  if (!list) return;

  const { rows } = await getAuditLogs({ limit: 100, offset: 0 });

  list.innerHTML = '';

  if (rows.length === 0) {
    if (emptyState) emptyState.hidden = false;
    return;
  }

  if (emptyState) emptyState.hidden = true;

  rows.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'audit-log-row';
    row.innerHTML = `
      <span class="audit-log-provider">${entry.provider}</span>
      <span class="audit-log-url">${entry.url}</span>
      <span class="audit-log-timestamp">${formatTimestamp(entry.created_at)}</span>
    `;
    list.appendChild(row);
  });
}

void getMessage; // reserved for future i18n labels (provider/url/timestamp column headers)
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run src/dashboard/__tests__/auditLogPanel.test.ts`
Expected: PASS（全2ケース）

- [ ] **Step 5: `entrypoints/options/index.html` にナビ項目を追加する**

`entrypoints/options/index.html` を開き、既存のサイドナビ項目（`data-panel="panel-diagnostics"` 等）のパターンに倣って以下を追加する。既存の診断パネルのナビ項目の直後に挿入する:

```html
<button class="nav-item" data-panel="panel-audit-log">監査ログ</button>
```

対応するパネルdiv（既存の `<div id="panel-diagnostics" class="panel" hidden>...</div>` のパターンに倣う）を追加する:

```html
<div id="panel-audit-log" class="panel" hidden>
  <h2>監査ログ</h2>
  <p>どのページ内容がどのAIプロバイダーへ送信されたかを一覧できます。</p>
  <div id="auditLogEmptyState" hidden>記録された送信イベントはまだありません。</div>
  <div id="auditLogList"></div>
</div>
```

**注記:** 実装者は `entrypoints/options/index.html` の実際のナビ構造（`navigation.ts` によるパネル切り替えロジック含む）を確認し、既存パターンと矛盾しない形で挿入すること。`dashboard.ts` の初期化処理に `initAuditLogPanel()` の呼び出しも追加する必要がある（既存の `initDiagnosticsPanel()` 等の呼び出し箇所と同じ場所）。

- [ ] **Step 6: コミット**

```bash
git add src/dashboard/auditLogPanel.ts src/dashboard/__tests__/auditLogPanel.test.ts entrypoints/options/index.html src/dashboard/dashboard.ts
git commit -m "feat(dashboard): 監査ログパネルを追加"
```

---

### Task 8: 全体の型チェックとテストスイートを実行する

**Files:** なし（検証のみ）

- [ ] **Step 1: 型チェックを実行する**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 2: 全テストスイートを実行する**

Run: `npm test`
Expected: 全テストPASS（既存テストの回帰なし）

- [ ] **Step 3: `npm run validate` で最終確認する**

Run: `npm run validate`
Expected: 型チェック・テストともにPASS

---

## Definition of Done チェックリスト（PBI再掲）

- [x] クラウド送信イベント（送信先・対象・日時）を記録する（Task 2, 5）
- [x] ローカル完結時は送信記録を残さない（Task 6）
- [x] ダッシュボードで時系列一覧を表示する（Task 7）
- [x] 監査ログに送信本文そのものは残さない（メタのみ）（Task 1のスキーマ設計、Task 4のインターフェース設計で保証）
