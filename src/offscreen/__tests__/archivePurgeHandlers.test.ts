// @vitest-environment jsdom
/**
 * archivePurgeHandlers.test.ts
 * OPFS-worker handler for phase B (delete main-DB rows covered by a verified
 * staging archive) — PBI 2026-09-06-04.
 *
 * Covered invariants:
 * - 3-condition DELETE predicate (cutoff / include_deleted / max_id_at_archive)
 * - VACUUM runs OUTSIDE the transaction; freelist before/after reported
 * - fail-closed on: unregistered name, incoming kind, registry/meta mismatch
 * - quota preflight rejects before touching the main DB
 * - single-flight
 * - staging (registry + OPFS file) released after success
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SqliteEngine, SqliteRow, SqliteValue } from '../sqliteEngine.js';
import { COLUMN_NAMES } from '../schema.js';

vi.mock('../sqliteEngine.js', () => ({
  createEngine: vi.fn(),
}));

import { handleArchiveDeleteByStaging } from '../opfsWorker/archivePurgeHandlers.js';
import { createEngine } from '../sqliteEngine.js';
import {
  setArchiveStagingDirProviderForTesting,
  resetArchiveStagingForTesting,
  prepareOutgoing,
  updateStagingRecord,
} from '../opfsWorker/archiveStaging.js';

const PAYLOAD = {
  cutoffDate: '2026-03-31',
  cutoffMs: new Date(2026, 2, 31, 23, 59, 59, 999).getTime(),
  includeDeleted: false,
  yasumaroVersion: '6.7.113',
};

type LogFn = (level: 'warn' | 'error' | 'info', message: string, details?: Record<string, unknown>) => void;

/**
 * Main engine mock: exec records statements; queryValue serves changes()
 * (DELETE rowcount), PRAGMA freelist_count (sequence), COUNT(*) (remaining).
 */
function makeMainEngine(opts: { deleted?: number; freelist?: number[]; remaining?: number; vacuumError?: Error } = {}) {
  const execCalls: Array<{ sql: string; params?: SqliteValue[] | undefined }> = [];
  let freelistIdx = 0;
  const freelist = opts.freelist ?? [10, 2];
  return {
    execCalls,
    engine: {
      exec: vi.fn(async (sql: string, params?: SqliteValue[]) => {
        execCalls.push({ sql, params });
        if (sql === 'VACUUM' && opts.vacuumError) throw opts.vacuumError;
      }),
      query: vi.fn(async (): Promise<SqliteRow[]> => []),
      queryValue: vi.fn(async (sql: string): Promise<SqliteValue> => {
        if (sql.includes('changes()')) return opts.deleted ?? 0;
        if (sql.includes('freelist_count')) {
          const v = freelist[Math.min(freelistIdx, freelist.length - 1)];
          freelistIdx++;
          return v ?? 0;
        }
        if (sql.includes('COUNT(*)')) return opts.remaining ?? 0;
        return null;
      }),
      close: vi.fn(async () => undefined),
    } as unknown as SqliteEngine & {
      exec: ReturnType<typeof vi.fn>;
      queryValue: ReturnType<typeof vi.fn>;
    },
  };
}

const ARCHIVE_TABLES = [
  { type: 'table', name: 'browsing_logs', rootpage: 2 },
  { type: 'table', name: 'yasumaro_archive_meta', rootpage: 3 },
  { type: 'table', name: 'sqlite_sequence', rootpage: 4 },
  { type: 'index', name: 'idx_logs_created', rootpage: 5 },
];

function makeArchiveEngine(opts: { metaRecordCount?: number; actualCount?: number; metaError?: Error } = {}) {
  const actualCount = opts.actualCount ?? opts.metaRecordCount ?? 5;
  const metaRow = opts.metaError
    ? null
    : {
        archived_at: 1775000000000,
        cutoff_created_at: PAYLOAD.cutoffMs,
        cutoff_date: PAYLOAD.cutoffDate,
        record_count: opts.metaRecordCount ?? 5,
        include_deleted: 0,
        archive_format_version: 1,
        yasumaro_version: '6.7.113',
        max_id_at_archive: 100,
      };
  const INTEGER_COLUMNS = new Set([
    'created_at', 'visit_duration', 'is_starred', 'is_deleted', 'obsidian_synced',
    'gist_synced', 'masked_count', 'ai_duration_ms', 'obsidian_duration_ms',
    'sent_tokens', 'received_tokens', 'original_tokens', 'cleansed_tokens',
    'page_bytes', 'candidate_bytes', 'original_bytes', 'cleansed_bytes',
    'ai_summary_original_bytes', 'ai_summary_cleansed_bytes',
    'extracted_sentences_bytes', 'extracted_sentences_original_bytes',
    'fallback_triggered',
  ]);
  const columns = [
    { name: 'id', type: 'INTEGER', hidden: 0 },
    ...COLUMN_NAMES.map((name) => ({
      name,
      type: name === 'scroll_ratio' ? 'REAL' : INTEGER_COLUMNS.has(name) ? 'INTEGER' : 'TEXT',
      hidden: 0,
    })),
  ];
  return {
    engine: {
      exec: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string): Promise<SqliteRow[]> => {
        if (sql.includes('sqlite_master') && sql.includes("name = 'yasumaro_archive_meta'")) {
          return metaRow ? [{ name: 'yasumaro_archive_meta' }] : [];
        }
        if (sql.includes('sqlite_master')) {
          return ARCHIVE_TABLES.map((o) => ({ type: o.type, name: o.name, rootpage: o.rootpage }));
        }
        if (sql.includes('COUNT(*)')) return [{ c: actualCount }];
        if (sql.includes('yasumaro_archive_meta')) return metaRow ? [metaRow] : [];
        if (sql.includes('table_xinfo')) return columns;
        return [];
      }),
      queryValue: vi.fn(async (): Promise<SqliteValue> => null),
      close: vi.fn(async () => undefined),
    } as unknown as SqliteEngine & { close: ReturnType<typeof vi.fn> },
  };
}

const REMOVED: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  resetArchiveStagingForTesting();
  REMOVED.length = 0;
  const fakeDir = {
    async removeEntry(name: string): Promise<void> {
      REMOVED.push(name);
    },
    async getFileHandle(): Promise<unknown> {
      return {};
    },
    async *entries(): AsyncGenerator<[string, unknown]> {},
  };
  setArchiveStagingDirProviderForTesting(async () => fakeDir as never);
  // Generous quota by default (VACUUM rewrites the DB).
  Object.defineProperty(globalThis.navigator, 'storage', {
    configurable: true,
    get: () => ({
      estimate: async () => ({ usage: 10 * 1024 * 1024, quota: 1024 * 1024 * 1024 }),
      getDirectory: async () => fakeDir,
    }),
  });
});

async function prepareVerifiedStaging(): Promise<string> {
  const name = await prepareOutgoing();
  updateStagingRecord(name, {
    cutoffMs: PAYLOAD.cutoffMs,
    includeDeleted: false,
    maxIdAtArchive: 100,
    recordCount: 5,
  });
  return name;
}

function makeCtx(engine: SqliteEngine): { engine: SqliteEngine } {
  return { engine };
}

const noopLog: LogFn = vi.fn();

describe('handleArchiveDeleteByStaging (PBI 2026-09-06-04)', () => {
  it('deletes with the 3-condition predicate and runs VACUUM outside the transaction', async () => {
    const stagingName = await prepareVerifiedStaging();
    const archive = makeArchiveEngine();
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    const main = makeMainEngine({ deleted: 5, freelist: [10, 2], remaining: 3 });

    const ctx = makeCtx(main.engine as unknown as SqliteEngine);
    const result = await handleArchiveDeleteByStaging(ctx, { stagingName }, noopLog);

    expect(result).toEqual({
      deleted: 5,
      remaining: 3,
      freelistBefore: 10,
      freelistAfter: 2,
      vacuumOk: true,
    });
    const deleteCall = main.execCalls.find((c) => c.sql.includes('DELETE FROM browsing_logs'));
    expect(deleteCall).toBeDefined();
    expect(deleteCall?.params).toEqual([PAYLOAD.cutoffMs, 100]);
    expect(deleteCall?.sql).toContain('is_deleted = 0');
    expect(deleteCall?.sql).toContain('id <= ?');
    // ordering: DELETE inside transaction, VACUUM after COMMIT
    const order = main.execCalls.map((c) => c.sql);
    const deleteIdx = order.findIndex((s2) => s2.includes('DELETE FROM browsing_logs'));
    expect(order.findIndex((s2) => s2.includes('BEGIN IMMEDIATE'))).toBeLessThan(deleteIdx);
    expect(order.findIndex((s2) => s2.includes('COMMIT'))).toBeLessThan(order.indexOf('VACUUM'));
    // staging released (registry + file)
    expect(REMOVED).toContain(stagingName);
  });

  it('protects rows that arrived after phase A (max_id predicate)', async () => {
    const stagingName = await prepareVerifiedStaging();
    const archive = makeArchiveEngine();
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    const main = makeMainEngine({ deleted: 5, freelist: [10, 2], remaining: 3 });

    const ctx = makeCtx(main.engine as unknown as SqliteEngine);
    await handleArchiveDeleteByStaging(ctx, { stagingName }, noopLog);

    // The DELETE is bounded by the archive's high-water id — a later restore
    // or import that inserts id > 100 survives phase B.
    const deleteCall = main.execCalls.find((c) => c.sql.includes('DELETE FROM browsing_logs'));
    expect(deleteCall?.params?.[1]).toBe(100);
  });

  it('fails closed when the staging is not registered (re-preview required)', async () => {
    const main = makeMainEngine({ deleted: 5 });
    const ctx = makeCtx(main.engine as unknown as SqliteEngine);
    await expect(
      handleArchiveDeleteByStaging(
        ctx,
        { stagingName: 'archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db' },
        noopLog,
      ),
    ).rejects.toThrow(/Unknown staging file|re-preview/i);
    expect(main.execCalls.some((c) => c.sql.includes('DELETE'))).toBe(false);
  });

  it('fails closed when the file meta disagrees with the registry', async () => {
    const stagingName = await prepareVerifiedStaging();
    // File says a different cutoff than the registry (swapped file attack).
    const archive = makeArchiveEngine({ metaRecordCount: 5 });
    // Swap the archive file's meta AFTER phase A (simulated file replacement):
    // cutoff/max_id now disagree with the registry values.
    const baseQuery = archive.engine.query.bind(archive.engine) as (sql: string) => Promise<SqliteRow[]>;
    archive.engine.query = vi.fn(async (sql: string): Promise<SqliteRow[]> => {
      if (sql.includes('FROM yasumaro_archive_meta')) {
        return [
          {
            archived_at: 1775000000000,
            cutoff_created_at: new Date(2026, 5, 30, 23, 59, 59, 999).getTime(),
            cutoff_date: '2026-06-30',
            record_count: 5,
            include_deleted: 0,
            archive_format_version: 1,
            yasumaro_version: '6.7.113',
            max_id_at_archive: 500,
          },
        ];
      }
      return baseQuery(sql);
    });
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);

    const main = makeMainEngine({ deleted: 5 });
    const ctx = makeCtx(main.engine as unknown as SqliteEngine);
    await expect(
      handleArchiveDeleteByStaging(ctx, { stagingName }, noopLog),
    ).rejects.toThrow(/re-preview|registry|does not match/i);
    expect(main.execCalls.some((c) => c.sql.includes('DELETE'))).toBe(false);
  });

  it('fails closed on incoming staging (restore flow must not be purged)', async () => {
      const { prepareIncoming } = await import('../opfsWorker/archiveStaging.js');
    const stagingName = await prepareIncoming();
    updateStagingRecord(stagingName, { cutoffMs: PAYLOAD.cutoffMs, includeDeleted: false, maxIdAtArchive: 100 });
    const main = makeMainEngine({ deleted: 5 });
    const ctx = makeCtx(main.engine as unknown as SqliteEngine);
    await expect(handleArchiveDeleteByStaging(ctx, { stagingName }, noopLog)).rejects.toThrow(/incoming|outgoing/i);
    expect(main.execCalls.some((c) => c.sql.includes('DELETE'))).toBe(false);
  });

  it('rejects before the DELETE when quota is insufficient', async () => {
    const stagingName = await prepareVerifiedStaging();
    const archive = makeArchiveEngine();
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    const main = makeMainEngine({ deleted: 5 });
    Object.defineProperty(globalThis.navigator, 'storage', {
      configurable: true,
      get: () => ({
        estimate: async () => ({ usage: 900 * 1024 * 1024, quota: 1024 * 1024 * 1024 }),
      }),
    });

    const ctx = makeCtx(main.engine as unknown as SqliteEngine);
    await expect(handleArchiveDeleteByStaging(ctx, { stagingName }, noopLog)).rejects.toThrow(/quota/i);
    expect(main.execCalls.some((c) => c.sql.includes('DELETE'))).toBe(false);
  });

  it('keeps the main DB intact when VACUUM fails (vacuumOk=false)', async () => {
    const stagingName = await prepareVerifiedStaging();
    const archive = makeArchiveEngine();
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    const main = makeMainEngine({
      deleted: 5,
      freelist: [10, 10],
      remaining: 3,
      vacuumError: new Error('VACUUM not supported by VFS'),
    });

    const ctx = makeCtx(main.engine as unknown as SqliteEngine);
    const result = await handleArchiveDeleteByStaging(ctx, { stagingName }, noopLog);
    expect(result.vacuumOk).toBe(false);
    expect(result.deleted).toBe(5);
  });

  it('blocks a second concurrent purge (single-flight)', async () => {
    const stagingName = await prepareVerifiedStaging();
    const archive = makeArchiveEngine();
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    const main = makeMainEngine({ deleted: 5, freelist: [10, 2], remaining: 3 });
    // Gate changes() (queried after the DELETE) — freelist_count must resolve
    // so the handler can reach the DELETE.
    let releaseChanges: (value: number) => void = () => undefined;
    const changesGate = new Promise<number>((resolve) => { releaseChanges = resolve; });
    const freelistSeq = [10, 2];
    let freelistIdx = 0;
    main.engine.queryValue.mockImplementation(async (sql: string): Promise<SqliteValue> => {
      if (sql.includes('changes()')) return await changesGate;
      if (sql.includes('freelist_count')) return freelistSeq[Math.min(freelistIdx++, freelistSeq.length - 1)] ?? 0;
      if (sql.includes('COUNT(*)')) return 3;
      return null;
    });

    const ctx = makeCtx(main.engine as unknown as SqliteEngine);
    const first = handleArchiveDeleteByStaging(ctx, { stagingName }, noopLog);
    await vi.waitFor(() =>
      expect(main.execCalls.some((c) => c.sql.includes('DELETE'))).toBe(true),
    );
    await expect(handleArchiveDeleteByStaging(ctx, { stagingName }, noopLog)).rejects.toThrow(/already in progress/);

    releaseChanges(5);
    await expect(first).resolves.toEqual({
      deleted: 5, remaining: 3, freelistBefore: 10, freelistAfter: 2, vacuumOk: true,
    });
  });
});
