// @vitest-environment node
/**
 * insertBatch-counting-parametric.test.ts
 * PBI 03 step 1: pin the insertBatch counting semantics on REAL SQLite
 * before refactoring row mappers.
 *
 * IdbVfsBackend.insertBatch counts inserted/skipped per row via
 * `SELECT changes()` after every INSERT OR IGNORE, while the OPFS worker
 * path (crudHandlers.handleInsertBatch) looped INSERT OR IGNORE and read
 * `SELECT changes()` ONCE at the end — the last statement's count only.
 * Both adapters run here against better-sqlite3 with the production
 * SCHEMA_SQL so the divergence is measured, not mocked.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { SCHEMA_SQL } from '../schema.js';
import { IdbVfsBackend } from '../IdbVfsBackend.js';
import { handleInsertBatch } from '../opfsWorker/crudHandlers.js';
import type { SqliteValue, SqliteRow } from '../sqliteEngine.js';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(SCHEMA_SQL);
  return db;
}

function records(): BrowsingLogRecord[] {
  return [
    { url: 'https://a.test/', title: 'A', created_at: 1000 },
    { url: 'https://b.test/', title: 'B', created_at: 2000 },
    { url: 'https://a.test/', title: 'A duplicate', created_at: 1000 },
  ];
}

/** Minimal SqliteEngineHost surface IdbVfsBackend touches, over real SQLite. */
function makeIdbHost(db: Database.Database): {
  backend: IdbVfsBackend;
  host: { idbEngine: object; fts5Available: boolean; execWithCache: (sql: string, params?: SqliteValue[], cb?: (row: SqliteValue[]) => void) => Promise<void> };
} {
  const host = {
    idbEngine: {},
    fts5Available: false,
    execWithCache: async (sql: string, params: SqliteValue[] = [], cb?: (row: SqliteValue[]) => void): Promise<void> => {
      if (/^\s*SELECT/i.test(sql)) {
        const rows = db.prepare(sql).raw(true).all(...(params as (string | number | null)[])) as SqliteValue[][];
        for (const row of rows) cb?.(row);
      } else {
        db.prepare(sql).run(...(params as (string | number | null)[]));
      }
    },
  };
  return { backend: new IdbVfsBackend(host as never), host };
}

/** Minimal HandlerContext surface handleInsertBatch touches, over real SQLite. */
function makeWorkerCtx(db: Database.Database): { engine: { exec: (sql: string, params?: SqliteValue[]) => Promise<void>; query: (sql: string, params?: SqliteValue[]) => Promise<SqliteRow[]>; queryValue: (sql: string, params?: SqliteValue[]) => Promise<SqliteValue>; close: () => Promise<void> } } {
  return {
    engine: {
      exec: async (sql: string, params: SqliteValue[] = []): Promise<void> => {
        db.prepare(sql).run(...(params as (string | number | null)[]));
      },
      query: async (sql: string, params: SqliteValue[] = []): Promise<SqliteRow[]> => {
        return (db.prepare(sql).all(...(params as (string | number | null)[])) as SqliteRow[]);
      },
      queryValue: async (sql: string, params: SqliteValue[] = []): Promise<SqliteValue> => {
        const row = db.prepare(sql).get(...(params as (string | number | null)[])) as SqliteRow | undefined;
        if (!row) return null;
        const key = Object.keys(row)[0];
        return key !== undefined ? (row[key] ?? null) : null;
      },
      close: async (): Promise<void> => undefined,
    },
  };
}

const noopLog = (): void => undefined;
const noopEnsure = async (): Promise<void> => undefined;

describe('insertBatch counting semantics on real SQLite', () => {
  it('IdbVfsBackend counts per row: 2 inserted, 1 skipped', async () => {
    const { backend } = makeIdbHost(makeDb());
    const result = await backend.insertBatch(records());
    expect(result).toEqual({ success: true, inserted: 2, skipped: 1 });
  });

  it('IdbVfsBackend re-insert of the same batch inserts nothing', async () => {
    const { backend } = makeIdbHost(makeDb());
    await backend.insertBatch(records());
    const result = await backend.insertBatch(records());
    expect(result).toEqual({ success: true, inserted: 0, skipped: 3 });
  });

  it('OPFS worker counts per row, not last-statement-only', async () => {
    const ctx = makeWorkerCtx(makeDb());
    const result = await handleInsertBatch(ctx, records(), noopLog, noopEnsure);
    expect(result.count).toBe(2);
    expect(result).toMatchObject({ inserted: 2, skipped: 1 });
  });

  it('OPFS worker re-insert of the same batch inserts nothing', async () => {
    const ctx = makeWorkerCtx(makeDb());
    await handleInsertBatch(ctx, records(), noopLog, noopEnsure);
    const result = await handleInsertBatch(ctx, records(), noopLog, noopEnsure);
    expect(result).toMatchObject({ count: 0, inserted: 0, skipped: 3 });
  });

  it('OPFS worker result satisfies the backend wire contract (count === inserted, inserted + skipped === batch size)', async () => {
    const ctx = makeWorkerCtx(makeDb());
    const batch = records();
    const result = await handleInsertBatch(ctx, batch, noopLog, noopEnsure);
    expect(result.count).toBe(result.inserted);
    expect(result.inserted + result.skipped).toBe(batch.length);
  });

  it('OPFS worker empty batch reports zeros', async () => {
    const ctx = makeWorkerCtx(makeDb());
    const result = await handleInsertBatch(ctx, [], noopLog, noopEnsure);
    expect(result).toMatchObject({ count: 0, inserted: 0, skipped: 0 });
  });
});
