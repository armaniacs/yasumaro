/**
 * recordsRepo-unique-constraint.test.ts
 *
 * PBI 2026-08-02-05: Verify recordsRepo enforces the (url, created_at)
 * unique constraint through the storage backend — duplicates are silently
 * ignored (INSERT OR IGNORE) rather than crashing, while records that share
 * a URL but differ in timestamp are kept.
 *
 * The backend is mocked so the contract of recordsRepo.insert / insertBatch /
 * getCount is tested deterministically.
 */

import { vi } from 'vitest';
import { insert, insertBatch, getCount, query } from '../recordsRepo.js';
import type { BrowsingLogRecord } from '../../utils/sqlite-types.js';

// --- In-memory fake backend implementing INSERT OR IGNORE on (url, created_at).
type BackendResult = { success: true; id?: number; count?: number; inserted?: number } | { success: false; error: string };

// `vi.hoisted` ensures this is created before the hoisted vi.mock factory runs.
const backend = vi.hoisted(() => {
  const rows: BrowsingLogRecord[] = [];
  let nextId = 1;

  const isDuplicate = (record: BrowsingLogRecord): boolean =>
    rows.some((r) => r.url === record.url && r.created_at === record.created_at);

  return {
    rows,
    reset() {
      rows.length = 0;
      nextId = 1;
    },
    insert(record: BrowsingLogRecord): Promise<BackendResult> {
      if (isDuplicate(record)) return Promise.resolve({ success: true, id: -1 });
      rows.push({ ...record, id: nextId });
      nextId++;
      return Promise.resolve({ success: true, id: nextId - 1 });
    },
    insertBatch(records: BrowsingLogRecord[]): Promise<BackendResult & { inserted?: number }> {
      let inserted = 0;
      for (const record of records) {
        if (isDuplicate(record)) continue;
        rows.push({ ...record, id: nextId });
        nextId++;
        inserted++;
      }
      return Promise.resolve({ success: true, inserted });
    },
    getCount(): Promise<BackendResult> {
      return Promise.resolve({ success: true, count: rows.length });
    },
    query(): Promise<{ success: true; rows: BrowsingLogRecord[] }> {
      return Promise.resolve({ success: true, rows });
    },
  };
});

vi.mock('../sqliteEngineHost.js', () => ({
  engine: {
    getBackend: vi.fn().mockResolvedValue(backend),
  },
  DB_FILENAME: 'test.db',
  MAX_QUERY_LIMIT: 1000,
}));

describe('recordsRepo — unique constraint on (url, created_at) (PBI 2026-08-02-05)', () => {
  const RECORD = (url: string, created_at: number): BrowsingLogRecord => ({ url, created_at });

  beforeEach(() => {
    backend.reset();
  });

  it('insert returns success (id=-1) for a duplicate (url, created_at)', async () => {
    await insert(RECORD('https://example.com', 1000));
    const dup = await insert(RECORD('https://example.com', 1000));

    expect(dup).toEqual({ success: true, id: -1 });
    const { rows } = await query() as { success: true; rows: BrowsingLogRecord[] };
    expect(rows).toHaveLength(1);
  });

  it('insert keeps records that share a url but differ in created_at', async () => {
    await insert(RECORD('https://example.com', 1000));
    const second = await insert(RECORD('https://example.com', 2000));

    expect(second).toEqual({ success: true, id: 2 });
    const count = await getCount();
    expect(count).toEqual({ success: true, count: 2 });
  });

  it('insertBatch counts only non-duplicate rows and skips duplicates in the batch', async () => {
    await insert(RECORD('https://a.com', 1));
    // Includes a duplicate of the existing row and a self-duplicate within the batch.
    const result = await insertBatch([
      RECORD('https://a.com', 1), // duplicate of existing
      RECORD('https://b.com', 2), // new
      RECORD('https://b.com', 2), // duplicate within batch
      RECORD('https://c.com', 3), // new
    ]);

    expect(result).toEqual({ success: true, count: 2 });
    const count = await getCount();
    expect(count).toEqual({ success: true, count: 3 }); // a.com + b.com + c.com
  });

  it('getCount reflects only rows that actually landed', async () => {
    await insertBatch([
      RECORD('https://x.com', 1),
      RECORD('https://y.com', 2),
    ]);
    await insert(RECORD('https://x.com', 1)); // duplicate, ignored

    const count = await getCount();
    expect(count).toEqual({ success: true, count: 2 });
  });
});
