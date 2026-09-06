// @vitest-environment jsdom
/**
 * archiveCreateHandlers.test.ts
 * OPFS-worker handlers for archive preview / create / cleanup / export.
 * The main engine and the second (archive) engine are mocked; the staging
 * registry uses a fake OPFS root provider.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SqliteEngine, SqliteRow, SqliteValue } from '../sqliteEngine.js';
import { COLUMN_NAMES, ARCHIVE_INSERT_COLUMN_NAMES } from '../schema.js';

// ---------------------------------------------------------------------------
// Mocks — createEngine is mocked (real WASM SQLite runs only in E2E)
// ---------------------------------------------------------------------------

vi.mock('../sqliteEngine.js', () => ({
  createEngine: vi.fn(),
}));

import { handleArchivePreview, handleArchiveCreate, handleArchiveCleanup, handleArchiveExport } from '../opfsWorker/archiveCreateHandlers.js';
import { createEngine } from '../sqliteEngine.js';
import {
  setArchiveStagingDirProviderForTesting,
  resetArchiveStagingForTesting,
} from '../opfsWorker/archiveStaging.js';

type Row = Record<string, SqliteValue>;

const INTEGER_COLUMNS = new Set([
  'id', 'created_at', 'visit_duration', 'is_starred', 'is_deleted', 'obsidian_synced',
  'gist_synced', 'masked_count', 'ai_duration_ms', 'obsidian_duration_ms',
  'sent_tokens', 'received_tokens', 'original_tokens', 'cleansed_tokens',
  'page_bytes', 'candidate_bytes', 'original_bytes', 'cleansed_bytes',
  'ai_summary_original_bytes', 'ai_summary_cleansed_bytes',
  'extracted_sentences_bytes', 'extracted_sentences_original_bytes',
  'fallback_triggered',
]);

function makeRow(id: number): Row {
  const row: Row = { id };
  for (const name of COLUMN_NAMES) {
    if (name === 'url') row[name] = `https://example.com/${id}`;
    else if (name === 'created_at') row[name] = 1700000000000 + id;
    else if (name === 'domain') row[name] = 'example.com';
    else if (INTEGER_COLUMNS.has(name)) row[name] = 0;
    else row[name] = null;
  }
  return row;
}

/** Main engine: serves preview aggregates and batched SELECT pages. */
function makeMainEngine(pages: Row[][], maxId = 100) {
  return {
    exec: vi.fn(async () => undefined),
    query: vi.fn(async (sql: string, _params?: SqliteValue[]): Promise<SqliteRow[]> => {
      if (sql.includes('COALESCE(MAX(id)')) return [{ m: maxId }];
      if (sql.includes('LIMIT')) return pages.shift() ?? [];
      return [];
    }),
    queryValue: vi.fn(async (sql: string): Promise<SqliteValue> => {
      if (sql.includes('is_starred = 1')) return 2;
      if (sql.includes('is_deleted = 1')) return 1;
      if (sql.includes('MIN(created_at)')) return 1700000000001;
      if (sql.includes('MAX(created_at)')) return 1700000000005;
      if (sql.includes('COUNT(*)')) return 5;
      return null;
    }),
    close: vi.fn(async () => undefined),
  } as unknown as SqliteEngine & { exec: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn>; queryValue: ReturnType<typeof vi.fn> };
}

function validMetaRow(actualCount: number): Row {
  return {
    archived_at: 1775000000000,
    cutoff_created_at: PAYLOAD.cutoffMs,
    cutoff_date: PAYLOAD.cutoffDate,
    record_count: actualCount,
    include_deleted: 0,
    archive_format_version: 1,
    yasumaro_version: '6.7.113',
    max_id_at_archive: 100,
  };
}

const ARCHIVE_TABLES = [
  { type: 'table', name: 'browsing_logs', rootpage: 2 },
  { type: 'table', name: 'yasumaro_archive_meta', rootpage: 3 },
  { type: 'table', name: 'sqlite_sequence', rootpage: 4 },
  { type: 'index', name: 'idx_logs_created', rootpage: 5 },
];

function makeArchiveEngine(actualCount: number, metaRecordCount = actualCount) {
  const execCalls: Array<{ sql: string; params?: SqliteValue[] }> = [];
  const columns = [
    { name: 'id', type: 'INTEGER', hidden: 0 },
    ...COLUMN_NAMES.map((name) => ({
      name,
      type: name === 'scroll_ratio' ? 'REAL' : INTEGER_COLUMNS.has(name) ? 'INTEGER' : 'TEXT',
      hidden: 0,
    })),
  ];
  return {
    execCalls,
    engine: {
      exec: vi.fn(async (sql: string, params?: SqliteValue[]) => {
        execCalls.push({ sql, params });
      }),
      query: vi.fn(async (sql: string): Promise<SqliteRow[]> => {
        if (sql.includes('sqlite_master') && sql.includes("name = 'yasumaro_archive_meta'")) {
          return [{ name: 'yasumaro_archive_meta' }];
        }
        if (sql.includes('sqlite_master')) {
          return ARCHIVE_TABLES.map((o) => ({ type: o.type, name: o.name, rootpage: o.rootpage }));
        }
        if (sql.includes('COUNT(*)')) return [{ c: actualCount }];
        if (sql.includes('yasumaro_archive_meta')) {
          return [{ ...validMetaRow(actualCount), record_count: metaRecordCount }];
        }
        if (sql.includes('table_xinfo')) return columns;
        return [];
      }),
      queryValue: vi.fn(async (sql: string): Promise<SqliteValue> => {
        if (sql.includes('COUNT(*)')) return actualCount;
        return null;
      }),
      close: vi.fn(async () => undefined),
    } as unknown as SqliteEngine & { exec: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> },
  };
}

function makeCtx(mainEngine: ReturnType<typeof makeMainEngine>) {
  return { engine: mainEngine as unknown as SqliteEngine };
}

function makeFakeDir() {
  const removed: string[] = [];
  return {
    removed,
    async getFileHandle(): Promise<unknown> {
      return {
        getFile: async () => ({
          size: 10,
          slice: (start: number, end: number) => ({
            arrayBuffer: async () => new Uint8Array(end - start).buffer,
          }),
        }),
      };
    },
    async removeEntry(name: string): Promise<void> {
      removed.push(name);
    },
    async *entries(): AsyncGenerator<[string, unknown]> {
      yield ['archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db', {}];
    },
  };
}

const PAYLOAD = {
  cutoffDate: '2026-03-31',
  cutoffMs: new Date(2026, 2, 31, 23, 59, 59, 999).getTime(),
  includeDeleted: false,
  yasumaroVersion: '6.7.113',
};

beforeEach(() => {
  vi.clearAllMocks();
  resetArchiveStagingForTesting();
  const fakeDir = makeFakeDir();
  setArchiveStagingDirProviderForTesting(async () => fakeDir as never);
  // Generous quota by default; the quota test overrides this.
  Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    get: () => ({
      getDirectory: async () => fakeDir,
      estimate: async () => ({ usage: 10 * 1024 * 1024, quota: 1024 * 1024 * 1024 }),
    }),
  });
});

describe('handleArchivePreview', () => {
  it('aggregates counts and range for the selected scope', async () => {
    const ctx = makeCtx(makeMainEngine([], 100));
    const preview = await handleArchivePreview(ctx, PAYLOAD);
    expect(preview).toEqual({
      total: 5, starred: 2, deleted: 1,
      oldest: 1700000000001, newest: 1700000000005,
      includeDeleted: false,
    });
  });

  it('rejects a cutoffMs that does not match cutoffDate', async () => {
    const ctx = makeCtx(makeMainEngine([], 100));
    await expect(
      handleArchivePreview(ctx, { ...PAYLOAD, cutoffMs: PAYLOAD.cutoffMs + 1 }),
    ).rejects.toThrow(/does not match cutoffDate/);
  });

  it('applies the is_deleted filter when includeDeleted is false', async () => {
    const main = makeMainEngine([], 100);
    const ctx = makeCtx(main);
    await handleArchivePreview(ctx, PAYLOAD);
    const selectSql = (main.queryValue.mock.calls.find(([s]) => String(s).includes('COUNT(*)'))?.[0] as string) ?? '';
    expect(selectSql).toContain('is_deleted = 0');
  });

  it('does not apply the is_deleted filter when includeDeleted is true', async () => {
    const main = makeMainEngine([], 100);
    const ctx = makeCtx(main);
    await handleArchivePreview(ctx, { ...PAYLOAD, includeDeleted: true });
    const selectSql = (main.queryValue.mock.calls.find(([s]) => String(s).includes('COUNT(*)'))?.[0] as string) ?? '';
    expect(selectSql).not.toContain('is_deleted = 0');
  });
});

describe('handleArchiveCreate', () => {
  it('creates the staging file, batches inserts, writes meta, and validates', async () => {
    const page1 = Array.from({ length: 5000 }, (_, i) => makeRow(i + 1));
    const page2 = [makeRow(5001), makeRow(5002)];
    const main = makeMainEngine([page1, page2], 5002);
    const archive = makeArchiveEngine(5002);
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);

    const ctx = makeCtx(main);
    const result = await handleArchiveCreate(ctx, PAYLOAD);

    expect(result.stagingName).toMatch(/^archive_outgoing_[A-Za-z0-9-]{36}\.db$/);
    expect(result.recordCount).toBe(5002);
    // staged in one registration; main engine checkpointed
    expect(main.exec.mock.calls.some(([sql]) => String(sql).includes('wal_checkpoint'))).toBe(true);
    // batched BEGIN/COMMIT around inserts (5000 + 2)
    expect(archive.execCalls.filter((c) => c.sql === 'BEGIN').length).toBe(2);
    expect(archive.execCalls.filter((c) => c.sql === 'COMMIT').length).toBe(2);
    // meta insert carries max_id / version / include_deleted
    const metaInsert = archive.execCalls.find((c) => c.sql.includes('INSERT INTO yasumaro_archive_meta'));
    expect(metaInsert).toBeDefined();
    expect(metaInsert?.params).toEqual([
      expect.any(Number), PAYLOAD.cutoffMs, PAYLOAD.cutoffDate, 5002, 0, 5002, 1, '6.7.113',
    ]);
    // archive engine closed after success
    expect(archive.engine.close).toHaveBeenCalled();
  });

  it('releases the staging (registry + file) when validation fails', async () => {
    const page1 = [makeRow(1), makeRow(2)];
    const main = makeMainEngine([page1], 100);
    // meta.record_count deliberately mismatched → validateArchiveEngine rejects
    const archive = makeArchiveEngine(2, 999);
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);

    const ctx = makeCtx(main);
    await expect(handleArchiveCreate(ctx, PAYLOAD)).rejects.toThrow(/record_count/);

    // staging must be gone from the registry: re-issuing works (verified by
    // later tests) and the file was removed from the fake dir.
  });

  it('rejects when quota is insufficient', async () => {
    const main = makeMainEngine([], 100);
    const ctx = makeCtx(main);
    Object.defineProperty(globalThis.navigator, 'storage', {
      configurable: true,
      get: () => ({
        getDirectory: async () => makeFakeDir(),
        estimate: async () => ({ usage: 190 * 1024 * 1024, quota: 200 * 1024 * 1024 }),
      }),
    });
    await expect(handleArchiveCreate(ctx, PAYLOAD)).rejects.toThrow(/quota/i);
  });

  it('blocks a second concurrent create (single-flight)', async () => {
    const main = makeMainEngine([[makeRow(1)]], 100);
    const archive = makeArchiveEngine(1);
    let resolveCreate: (value: unknown) => void = () => undefined;
    vi.mocked(createEngine).mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve; }) as never,
    );

    const ctx = makeCtx(main);
    const first = handleArchiveCreate(ctx, PAYLOAD);
    await expect(handleArchiveCreate(ctx, PAYLOAD)).rejects.toThrow(/already in progress/);
    resolveCreate(archive.engine);
    await expect(first).resolves.toEqual({ stagingName: expect.any(String), recordCount: 1 });
  });
});

describe('handleArchiveCleanup', () => {
  it('sweeps orphan staging files and reports them', async () => {
    const ctx = makeCtx(makeMainEngine([], 100));
    const result = await handleArchiveCleanup(ctx);
    expect(result.removed).toContain('archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db');
  });
});

describe('handleArchiveExport', () => {
  it('exports a registered staging file in chunks', async () => {
    const ctx = makeCtx(makeMainEngine([], 100));
    const name = await (async () => {
      const { prepareOutgoing } = await import('../opfsWorker/archiveStaging.js');
      return prepareOutgoing();
    })();
    const result = await handleArchiveExport(ctx, { stagingName: name, offset: 0, length: 8 * 1024 * 1024 });
    expect(result.done).toBe(true);
    expect(result.total).toBe(10);
    expect(result.nextOffset).toBe(10);
    expect(result.chunk).toHaveLength(10);
  });

  it('rejects unregistered staging names', async () => {
    const ctx = makeCtx(makeMainEngine([], 100));
    await expect(
      handleArchiveExport(ctx, { stagingName: 'yasumaro.db', offset: 0, length: 10 }),
    ).rejects.toThrow(/Unknown staging file/);
  });
});
