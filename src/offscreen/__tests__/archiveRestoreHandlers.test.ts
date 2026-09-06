// @vitest-environment jsdom
/**
 * archiveRestoreHandlers.test.ts
 * OPFS-worker handlers for restoring an archive-format .db (PBI 2026-09-06-03).
 * Main engine (INSERT target) and second engine (archive source) are mocked;
 * the staging registry uses a fake OPFS root provider.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SqliteEngine, SqliteRow, SqliteValue } from '../sqliteEngine.js';
import { COLUMN_NAMES } from '../schema.js';

vi.mock('../sqliteEngine.js', () => ({
  createEngine: vi.fn(),
}));

import {
  handleArchivePrepareIncoming,
  handleArchiveRestorePreview,
  handleArchiveRestore,
} from '../opfsWorker/archiveRestoreHandlers.js';
import { createEngine } from '../sqliteEngine.js';
import {
  setArchiveStagingDirProviderForTesting,
  resetArchiveStagingForTesting,
  prepareOutgoing,
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

const PAYLOAD = {
  cutoffDate: '2026-03-31',
  cutoffMs: new Date(2026, 2, 31, 23, 59, 59, 999).getTime(),
  includeDeleted: false,
  yasumaroVersion: '6.7.113',
};

function makeArchiveRow(id: number, overrides: Row = {}): Row {
  const row: Row = { id, url: `https://example.com/${id}`, created_at: 1700000000000 + id, domain: 'example.com' };
  for (const name of COLUMN_NAMES) {
    if (!(name in row)) row[name] = INTEGER_COLUMNS.has(name) ? 0 : null;
  }
  return { ...row, ...overrides };
}

const ARCHIVE_TABLES = [
  { type: 'table', name: 'browsing_logs', rootpage: 2 },
  { type: 'table', name: 'yasumaro_archive_meta', rootpage: 3 },
  { type: 'table', name: 'sqlite_sequence', rootpage: 4 },
  { type: 'index', name: 'idx_logs_created', rootpage: 5 },
];

function makeArchiveColumns() {
  return [
    { name: 'id', type: 'INTEGER', hidden: 0 },
    ...COLUMN_NAMES.map((name) => ({
      name,
      type: name === 'scroll_ratio' ? 'REAL' : INTEGER_COLUMNS.has(name) ? 'INTEGER' : 'TEXT',
      hidden: 0,
    })),
  ];
}

interface ArchiveEngineSpec {
  pages: Row[][];
  actualCount?: number;
  metaRecordCount?: number;
  metaRow?: Row | null;
}

function makeArchiveEngine(spec: ArchiveEngineSpec) {
  const actualCount = spec.actualCount ?? spec.pages.reduce((a, p) => a + p.length, 0);
  const metaRecordCount = spec.metaRecordCount ?? actualCount;
  const metaRow = spec.metaRow !== undefined ? spec.metaRow : {
    archived_at: 1775000000000,
    cutoff_created_at: PAYLOAD.cutoffMs,
    cutoff_date: PAYLOAD.cutoffDate,
    record_count: metaRecordCount,
    include_deleted: 0,
    archive_format_version: 1,
    yasumaro_version: '6.7.113',
    max_id_at_archive: 100,
  };
  let page = 0;
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
        if (sql.includes(' id > ?')) {
          const rows = spec.pages[page] ?? [];
          page++;
          return rows;
        }
        if (sql.includes('table_xinfo')) return makeArchiveColumns();
        return [];
      }),
      queryValue: vi.fn(async (sql: string): Promise<SqliteValue> => {
        if (sql.includes('COUNT(*)')) return actualCount;
        if (sql.includes('MIN(created_at)')) return 1700000000001;
        if (sql.includes('MAX(created_at)')) return 1700000000005;
        return null;
      }),
      close: vi.fn(async () => undefined),
    } as unknown as SqliteEngine & { close: ReturnType<typeof vi.fn> },
  };
}

/** Main engine mock: changes() drives restore counting; exec records inserts. */
function makeMainEngine(opts: { changesByValue?: number[] } = {}) {
  const inserts: Array<{ sql: string; params?: SqliteValue[] }> = [];
  let changesIdx = 0;
  const changesByValue = opts.changesByValue ?? [];
  return {
    inserts,
    engine: {
      exec: vi.fn(async (sql: string, params?: SqliteValue[]) => {
        if (sql.includes('INSERT')) inserts.push({ sql, params });
      }),
      query: vi.fn(async (): Promise<SqliteRow[]> => []),
      queryValue: vi.fn(async (sql: string): Promise<SqliteValue> => {
        if (sql.includes('changes()')) {
          const v = changesByValue[changesIdx] ?? 1;
          changesIdx++;
          return v;
        }
        return null;
      }),
      close: vi.fn(async () => undefined),
    } as unknown as SqliteEngine & {
      exec: ReturnType<typeof vi.fn>;
      queryValue: ReturnType<typeof vi.fn>;
    },
  };
}

function makeCtx(mainEngine: ReturnType<typeof makeMainEngine>) {
  return { engine: mainEngine.engine as unknown as SqliteEngine };
}

const fakeDirRemoved: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  resetArchiveStagingForTesting();
  fakeDirRemoved.length = 0;
  const fakeDir = {
    async removeEntry(name: string): Promise<void> {
      fakeDirRemoved.push(name);
    },
    async getFileHandle(): Promise<unknown> {
      return {};
    },
    async *entries(): AsyncGenerator<[string, unknown]> {},
  };
  setArchiveStagingDirProviderForTesting(async () => fakeDir as never);
});

describe('handleArchivePrepareIncoming', () => {
  it('issues a registered incoming staging name', async () => {
    const ctx = makeCtx(makeMainEngine());
    const result = await handleArchivePrepareIncoming(ctx);
    expect(result.stagingName).toMatch(/^archive_incoming_[A-Za-z0-9-]{36}\.db$/);
  });
});

describe('handleArchiveRestorePreview', () => {
  it('returns validated meta and row range', async () => {
    const archive = makeArchiveEngine({ pages: [[makeArchiveRow(1)]], actualCount: 1 });
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);

    const ctx = makeCtx(makeMainEngine());
    const stagingName = await prepareOutgoing();
    const preview = await handleArchiveRestorePreview(ctx, { stagingName });

    expect(preview.recordCount).toBe(1);
    expect(preview.cutoffDate).toBe(PAYLOAD.cutoffDate);
    expect(preview.oldest).toBe(1700000000001);
    expect(preview.newest).toBe(1700000000005);
    // preview never leaves the engine open
    expect(archive.engine.close).toHaveBeenCalled();
  });

  it('rejects meta.record_count mismatches (fail-closed)', async () => {
    const archive = makeArchiveEngine({
      pages: [[makeArchiveRow(1)]],
      actualCount: 1,
      metaRecordCount: 999,
    });
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);

    const ctx = makeCtx(makeMainEngine());
    const stagingName = await prepareOutgoing();
    await expect(
      handleArchiveRestorePreview(ctx, { stagingName }),
    ).rejects.toThrow(/record_count/);
  });
});

describe('handleArchiveRestore', () => {
  it('restores rows with re-derived domains and reports per-row counts', async () => {
    const rows = [makeArchiveRow(1), makeArchiveRow(2), makeArchiveRow(3)];
    const archive = makeArchiveEngine({ pages: [rows] });
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    const main = makeMainEngine({ changesByValue: [1, 1, 1] });

    const ctx = makeCtx(main);
    const stagingName = await prepareOutgoing();
    const result = await handleArchiveRestore(ctx, { stagingName });

    expect(result).toEqual({ restored: 3, restoredDeleted: 0, skipped: 0, skippedInvalid: 0 });
    const insertCalls = main.inserts.filter((c) => c.sql.includes('INSERT OR IGNORE'));
    expect(insertCalls).toHaveLength(3);
    // insert params exclude the archive id (renumbered) — url is param 0
    expect(insertCalls[0]?.params?.[0]).toBe('https://example.com/1');
    expect(insertCalls[0]?.params).toHaveLength(COLUMN_NAMES.length);
    // staging released after success
    expect(fakeDirRemoved).toContain(stagingName);
  });

  it('counts INSERT OR IGNORE skips and deleted-flagged restorations', async () => {
    const rows = [
      makeArchiveRow(1),
      makeArchiveRow(2, { is_deleted: 1 }),
      makeArchiveRow(3),
    ];
    const archive = makeArchiveEngine({ pages: [rows] });
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    const main = makeMainEngine({ changesByValue: [1, 1, 0] });

    const ctx = makeCtx(main);
    const result = await handleArchiveRestore(ctx, { stagingName: await prepareOutgoing() });

    expect(result).toEqual({ restored: 2, restoredDeleted: 1, skipped: 1, skippedInvalid: 0 });
  });

  it('counts row-level errors as skippedInvalid without aborting the restore', async () => {
    const rows = [makeArchiveRow(1), makeArchiveRow(2)];
    const archive = makeArchiveEngine({ pages: [rows] });
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    const main = makeMainEngine({ changesByValue: [1] });
    main.engine.exec.mockImplementation(async (sql: string, params?: SqliteValue[]) => {
      if (sql.includes('INSERT') && main.inserts.length >= 1) {
        throw new Error('bind/type error');
      }
      if (sql.includes('INSERT')) main.inserts.push({ sql, params });
    });

    const ctx = makeCtx(main);
    const result = await handleArchiveRestore(ctx, { stagingName: await prepareOutgoing() });

    expect(result.restored).toBe(1);
    expect(result.skippedInvalid).toBe(1);
  });

  it('rejects meta.record_count mismatches before inserting a single row', async () => {
    const archive = makeArchiveEngine({
      pages: [[makeArchiveRow(1)]],
      actualCount: 1,
      metaRecordCount: 42,
    });
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    const main = makeMainEngine();

    const ctx = makeCtx(main);
    const stagingName = await prepareOutgoing();
    await expect(handleArchiveRestore(ctx, { stagingName })).rejects.toThrow(/record_count/);
    expect(main.inserts).toHaveLength(0);
  });

  it('blocks a second concurrent restore (single-flight)', async () => {
    const archive = makeArchiveEngine({ pages: [[makeArchiveRow(1)]] });
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    let releaseChanges: (value: number) => void = () => undefined;
    const changesGate = new Promise<number>((resolve) => { releaseChanges = resolve; });
    const main = makeMainEngine();
    main.engine.queryValue.mockImplementation(async (sql: string): Promise<SqliteValue> => {
      if (sql.includes('changes()')) return await changesGate;
      return null;
    });

    const ctx = makeCtx(main);
    const stagingName = await prepareOutgoing();
    const first = handleArchiveRestore(ctx, { stagingName });
    // Wait until the first restore is inside its per-row loop, then start a
    // second one with an arbitrary name — the in-flight check fires first.
    await vi.waitFor(() =>
      expect(main.engine.exec.mock.calls.some(([s]) => String(s).includes('INSERT'))).toBe(true),
    );
    await expect(
      handleArchiveRestore(ctx, { stagingName: 'archive_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db' }),
    ).rejects.toThrow(/already in progress/);

    releaseChanges(1);
    await expect(first).resolves.toEqual({ restored: 1, restoredDeleted: 0, skipped: 0, skippedInvalid: 0 });
  });
});
