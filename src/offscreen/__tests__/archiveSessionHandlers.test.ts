// @vitest-environment jsdom
/**
 * archiveSessionHandlers.test.ts
 * OPFS-worker handlers for the temp-open session (PBI 2026-09-06-05):
 * open (validate + keep engine), query (LIKE + escape), update (whitelist +
 * url scheme), save (checkpoint + dirty clear), close (dirty two-defense +
 * staging release), status (reconnect probe).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SqliteEngine, SqliteRow, SqliteValue } from '../sqliteEngine.js';
import { COLUMN_NAMES } from '../schema.js';

vi.mock('../sqliteEngine.js', () => ({
  createEngine: vi.fn(),
}));

import {
  resetArchiveSessionForTesting,
  handleArchiveOpen,
  handleArchiveQuery,
  handleArchiveUpdate,
  handleArchiveSave,
  handleArchiveClose,
  handleArchiveStatus,
} from '../opfsWorker/archiveSessionHandlers.js';
import { createEngine } from '../sqliteEngine.js';
import {
  setArchiveStagingDirProviderForTesting,
  resetArchiveStagingForTesting,
  prepareIncoming,
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

const ARCHIVE_TABLES = [
  { type: 'table', name: 'browsing_logs', rootpage: 2 },
  { type: 'table', name: 'yasumaro_archive_meta', rootpage: 3 },
  { type: 'table', name: 'sqlite_sequence', rootpage: 4 },
  { type: 'index', name: 'idx_logs_created', rootpage: 5 },
];

function validMetaRow(): Row {
  return {
    archived_at: 1775000000000,
    cutoff_created_at: new Date(2026, 2, 31, 23, 59, 59, 999).getTime(),
    cutoff_date: '2026-03-31',
    record_count: 2,
    include_deleted: 0,
    archive_format_version: 1,
    yasumaro_version: '6.7.113',
    max_id_at_archive: 100,
  };
}

interface SessionEngineSpec {
  queryRows?: Row[];
  actualCount?: number;
  metaRecordCount?: number;
  objects?: Array<{ type: string; name: string; rootpage?: number }>;
  columns?: Array<{ name: string; type: string; hidden?: number }>;
}

function outlineMeta(): Row {
  return {
    archived_at: 1775000000000,
    cutoff_created_at: new Date(2026, 2, 31, 23, 59, 59, 999).getTime(),
    cutoff_date: '2026-03-31',
    record_count: 2,
    include_deleted: 0,
    archive_format_version: 1,
    yasumaro_version: '6.7.113',
    max_id_at_archive: 100,
  };
}

function makeSessionEngine(spec: SessionEngineSpec = {}) {
  const execCalls: Array<{ sql: string; params?: SqliteValue[] }> = [];
  const objects = spec.objects ?? ARCHIVE_TABLES;
  const columns = spec.columns ?? makeArchiveColumns();
  const actualCount = spec.actualCount ?? (spec.queryRows?.length ?? 2);
  const metaRecordCount = spec.metaRecordCount ?? actualCount;
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
          return objects.map((o) => ({ type: o.type, name: o.name, rootpage: o.rootpage ?? 1 }));
        }
        if (sql.includes('COUNT(*)')) return [{ c: actualCount }];
        if (sql.includes('yasumaro_archive_meta')) {
          return [{ ...outlineMeta(), record_count: actualCount }];
        }
        if (sql.includes(' id, url') || sql.includes('ORDER BY created_at DESC')) {
          return spec.queryRows ?? [];
        }
        if (sql.includes('table_xinfo')) return columns;
        return [];
      }),
      queryValue: vi.fn(async (sql: string): Promise<SqliteValue> => {
        if (sql.includes('COUNT(*)')) return actualCount;
        return null;
      }),
      close: vi.fn(async () => undefined),
    } as unknown as SqliteEngine & {
      exec: ReturnType<typeof vi.fn>;
      query: ReturnType<typeof vi.fn>;
      queryValue: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    },
  };
}

function makeCtx() {
  return { engine: null as never };
}

const REMOVED: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  resetArchiveStagingForTesting();
  resetArchiveSessionForTesting();
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
});

describe('handleArchiveOpen', () => {
  it('opens a registered incoming staging and validates it', async () => {
    const archive = makeSessionEngine({ queryRows: [makeRow(1)] });
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);

    const stagingName = await prepareIncoming();
    const result = await handleArchiveOpen(makeCtx(), { stagingName });

    expect(result.open).toBe(true);
    // engine kept open (caller lifecycle) — close is NOT called on success
    expect(archive.engine.close).not.toHaveBeenCalled();
  });

  it('rejects a second open while a session is active (single session)', async () => {
    const archive = makeSessionEngine();
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    const stagingName = await prepareIncoming();
    await handleArchiveOpen(makeCtx(), { stagingName });

    const secondName = await prepareIncoming();
    await expect(handleArchiveOpen(makeCtx(), { stagingName: secondName })).rejects.toThrow(
      /already open/,
    );
    // First session survives
    const status = await handleArchiveStatus(makeCtx());
    expect(status.stagingName).toBe(stagingName);
  });

  it('rejects unregistered names (yasumaro.db protection)', async () => {
    await expect(handleArchiveOpen(makeCtx(), { stagingName: 'yasumaro.db' })).rejects.toThrow(
      /Unknown staging file/,
    );
  });

  it('rejects outgoing staging (phase A output has its own flow)', async () => {
    const name = 'archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db';
    // Not registered: assert fires before the kind check
    await expect(handleArchiveOpen(makeCtx(), { stagingName: name })).rejects.toThrow(
      /Unknown staging file/,
    );
  });

  it('closes the engine and fails when the file has a hostile structure', async () => {
    const archive = makeSessionEngine({
      objects: [{ type: 'view', name: 'browsing_logs' }],
      columns: [],
    });
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    const stagingName = await prepareIncoming();

    await expect(handleArchiveOpen(makeCtx(), { stagingName })).rejects.toThrow(/view|validation/i);
    expect(archive.engine.close).toHaveBeenCalled();
  });
});

describe('handleArchiveQuery', () => {
  it('returns rows and total for the open session', async () => {
    const archive = makeSessionEngine({
      queryRows: [{ id: 1, url: 'https://x.test/1', title: 't1', summary: null, tags: null, created_at: 1700000000001, is_starred: 0, is_deleted: 0 }],
      actualCount: 1,
    });
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    const stagingName = await prepareIncoming();
    await handleArchiveOpen(makeCtx(), { stagingName });

    const result = await handleArchiveQuery(makeCtx(), { stagingName, query: '', limit: 100, offset: 0 });
    expect(result.rows).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('escapes LIKE wildcards in the search term', async () => {
    const archive = makeSessionEngine();
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    const stagingName = await prepareIncoming();
    await handleArchiveOpen(makeCtx(), { stagingName });

    await handleArchiveQuery(makeCtx(), { stagingName, query: "100%_\\", limit: 100, offset: 0 });
    const selectCall = archive.engine.query.mock.calls.find(
      ([sql]) => String(sql).includes('LIKE'),
    );
    const params = selectCall?.[1] as string[];
    expect(params[0]).toBe('%100\\%\\_\\\\%');
  });

  it('rejects when no session is open', async () => {
    const stagingName = 'archive_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db';
    await expect(
      handleArchiveQuery(makeCtx(), { stagingName, query: '', limit: 100, offset: 0 }),
    ).rejects.toThrow(/not open/);
  });
});

describe('handleArchiveUpdate', () => {
  it('updates a whitelisted field and marks the session dirty', async () => {
    const archive = makeSessionEngine();
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    const stagingName = await prepareIncoming();
    await handleArchiveOpen(makeCtx(), { stagingName });

    const result = await handleArchiveUpdate(makeCtx(), { stagingName, id: 1, changes: { title: 'new title' } });
    expect(result.dirty).toBe(true);
    const updateCall = archive.execCalls.find((c) => c.sql.includes('UPDATE browsing_logs'));
    expect(updateCall).toBeDefined();
    expect(updateCall?.params).toEqual(['new title', 1]);
  });

  it('rejects a non-http url on update (Red Team requirement)', async () => {
    const archive = makeSessionEngine();
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    const stagingName = await prepareIncoming();
    await handleArchiveOpen(makeCtx(), { stagingName });

    await expect(
      handleArchiveUpdate(makeCtx(), { stagingName, id: 1, changes: { url: 'javascript:alert(1)' } }),
    ).rejects.toThrow(/url must be http/);
  });

  it('rejects unknown fields', async () => {
    const archive = makeSessionEngine();
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    const stagingName = await prepareIncoming();
    await handleArchiveOpen(makeCtx(), { stagingName });

    await expect(
      handleArchiveUpdate(makeCtx(), { stagingName, id: 1, changes: { attacker_field: 'x' } }),
    ).rejects.toThrow(/not updatable/);
  });

  it('rejects a non-http url even though url is whitelisted for edits of existing rows', async () => {
    const archive = makeSessionEngine();
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    const stagingName = await prepareIncoming();
    await handleArchiveOpen(makeCtx(), { stagingName });

    await expect(
      handleArchiveUpdate(makeCtx(), { stagingName, id: 1, changes: { title: 'x' } }),
    ).resolves.toEqual({ dirty: true });
  });

  it('rejects when no session is open', async () => {
    const stagingName = 'archive_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db';
    await expect(
      handleArchiveUpdate(makeCtx(), { stagingName, id: 1, changes: { title: 'x' } }),
    ).rejects.toThrow(/not open/);
  });
});

describe('handleArchiveSave / handleArchiveClose / handleArchiveStatus', () => {
  it('save checkpoints and clears dirty', async () => {
    const archive = makeSessionEngine();
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    const stagingName = await prepareIncoming();
    await handleArchiveOpen(makeCtx(), { stagingName });
    await handleArchiveUpdate(makeCtx(), { stagingName, id: 1, changes: { title: 't' } });

    const result = await handleArchiveSave(makeCtx(), { stagingName });
    expect(result.dirty).toBe(false);
    expect(archive.execCalls.some((c) => c.sql.includes('wal_checkpoint'))).toBe(true);

    // close now succeeds (dirty cleared)
    await expect(handleArchiveClose(makeCtx(), { stagingName })).resolves.toEqual({ dirty: false });
    expect(REMOVED).toContain(stagingName);
  });

  it('close rejects while dirty (two-defense)', async () => {
    const archive = makeSessionEngine();
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    const stagingName = await prepareIncoming();
    await handleArchiveOpen(makeCtx(), { stagingName });
    await handleArchiveUpdate(makeCtx(), { stagingName, id: 1, changes: { title: 't' } });

    await expect(handleArchiveClose(makeCtx(), { stagingName })).rejects.toThrow(/unsaved|dirty|ARC_DIRTY/i);
    // engine still open — the user can save
    const status = await handleArchiveStatus(makeCtx());
    expect(status.open).toBe(true);
  });

  it('status reflects the session state for reconnect', async () => {
    const archive = makeSessionEngine();
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    const stagingName = await prepareIncoming();

    const before = await handleArchiveStatus(makeCtx());
    expect(before.open).toBe(false);

    await handleArchiveOpen(makeCtx(), { stagingName });
    const after = await handleArchiveStatus(makeCtx());
    expect(after).toEqual({ open: true, stagingName, dirty: false });
  });

  it('close is idempotent for a closed session', async () => {
    const archive = makeSessionEngine();
    vi.mocked(createEngine).mockResolvedValue(archive.engine as never);
    const stagingName = await prepareIncoming();
    await handleArchiveOpen(makeCtx(), { stagingName });
    await handleArchiveClose(makeCtx(), { stagingName });

    await expect(handleArchiveClose(makeCtx(), { stagingName })).resolves.toEqual({ dirty: false });
  });
});

function makeRow(id: number): Row {
  return {
    id,
    url: `https://x.test/${id}`,
    title: `t${id}`,
    summary: null,
    tags: null,
    created_at: 1700000000000 + id,
    is_starred: 0,
    is_deleted: 0,
  };
}
