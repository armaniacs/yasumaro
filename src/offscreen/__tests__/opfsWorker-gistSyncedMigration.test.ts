// @vitest-environment jsdom
/**
 * opfsWorker-gistSyncedMigration.test.ts
 *
 * Regression test for a bug where CREATE INDEX ... ON browsing_logs(gist_synced)
 * was bundled inside SCHEMA_SQL and ran before the ALTER TABLE migration that
 * adds the gist_synced column. On an existing DB predating that column,
 * CREATE TABLE IF NOT EXISTS is a no-op, so the CREATE INDEX statement failed
 * with "no such column: gist_synced" — and because `engine` was already set
 * before that failure, every subsequent request treated init as "done" and
 * never retried the migration, permanently breaking QUERY/STATUS.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../sqliteEngine.js', () => ({
  createEngine: vi.fn(),
  SqliteEngine: class {},
}));

vi.mock('../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../opfsMigrationV2Reader.js', () => ({
  readOldDbRecords: vi.fn().mockResolvedValue([]),
  deleteOldDbFile: vi.fn().mockResolvedValue(undefined),
}));

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn((_keys: string | string[], callback: (items: Record<string, unknown>) => void) => {
        callback({ opfs_migration_v2_done: false });
      }),
      set: vi.fn((_items: Record<string, unknown>, callback?: () => void) => {
        if (callback) callback();
      }),
    },
  },
} as never);

/**
 * Simulates an existing DB that predates the gist_synced column: any SQL
 * referencing gist_synced (the CREATE INDEX, or a SELECT/INSERT listing it)
 * throws "no such column", exactly like real SQLite would.
 */
function createEngineMissingGistSyncedColumn() {
  let gistSyncedColumnAdded = false;

  // Only statements that *reference* the column as an existing identifier
  // (index creation, SELECT/INSERT lists) fail before the column exists.
  // CREATE TABLE's own column definition and the ALTER TABLE that adds it
  // must not trip this check.
  const referencesGistSyncedColumn = (sql: string): boolean =>
    /CREATE INDEX.*\(gist_synced\)/.test(sql) ||
    (/^\s*SELECT/i.test(sql) && /gist_synced/.test(sql));

  const exec = vi.fn(async (sql: string) => {
    if (/ALTER TABLE browsing_logs ADD COLUMN gist_synced/.test(sql)) {
      gistSyncedColumnAdded = true;
      return;
    }
    if (!gistSyncedColumnAdded && referencesGistSyncedColumn(sql)) {
      throw new Error('no such column: gist_synced');
    }
  });

  const query = vi.fn(async (sql: string) => {
    if (!gistSyncedColumnAdded && referencesGistSyncedColumn(sql)) {
      throw new Error('no such column: gist_synced');
    }
    if (/PRAGMA compile_options/.test(sql)) {
      return [{ compile_options: 'ENABLE_FTS5' }];
    }
    if (/COUNT\(\*\)/.test(sql)) {
      return [{ c: 0 }];
    }
    return [];
  });

  return {
    exec,
    query,
    queryValue: vi.fn(async () => 0),
    close: vi.fn(async () => {}),
  };
}

describe('OPFS Worker init — gist_synced migration ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('does not permanently fail QUERY on a DB predating the gist_synced column', async () => {
    const { handleRequest } = await import('../opfsWorker.js');
    const { createEngine } = await import('../sqliteEngine.js');
    vi.mocked(createEngine).mockResolvedValue(createEngineMissingGistSyncedColumn());

    const initResponse = await handleRequest({ id: 1, type: 'INIT', payload: undefined });
    expect(initResponse.success).toBe(true);

    const queryResponse = await handleRequest({
      id: 2,
      type: 'QUERY',
      payload: { limit: 50, offset: 0 },
    });

    expect(queryResponse.success).toBe(true);
    expect(queryResponse.error).toBeUndefined();
  });

  it('resets the engine on init failure so a later request can retry successfully', async () => {
    const { handleRequest } = await import('../opfsWorker.js');
    const { createEngine } = await import('../sqliteEngine.js');

    const engine = createEngineMissingGistSyncedColumn();
    // Force the very first SCHEMA_SQL exec to fail outright (e.g. transient I/O error),
    // regardless of gist_synced — the first handleRequest call must not wedge init forever.
    const originalExec = engine.exec;
    let firstCall = true;
    engine.exec = vi.fn(async (sql: string) => {
      if (firstCall) {
        firstCall = false;
        throw new Error('disk I/O error');
      }
      return originalExec(sql);
    });
    vi.mocked(createEngine).mockResolvedValue(engine);

    const firstQuery = await handleRequest({ id: 1, type: 'QUERY', payload: { limit: 50, offset: 0 } });
    expect(firstQuery.success).toBe(false);

    const secondQuery = await handleRequest({ id: 2, type: 'QUERY', payload: { limit: 50, offset: 0 } });
    expect(secondQuery.success).toBe(true);
  });
});
