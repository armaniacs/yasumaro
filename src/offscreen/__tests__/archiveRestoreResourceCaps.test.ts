// @vitest-environment jsdom
/**
 * archiveRestoreResourceCaps.test.ts
 * Restore-loop enforcement of the worker-side resource ceilings
 * (PBI 2026-09-22-08, VULN-004).
 *
 * Technique converted from the VULN-004 exploit test: validation is stubbed
 * (as a bypassed gate) while the archive engine pages crafted rows in
 * RESTORE_BATCH-sized batches straight into the real restore loop.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SqliteEngine, SqliteRow, SqliteValue } from '../sqliteEngine.js';
import { COLUMN_NAMES } from '../schema.js';

vi.mock('../sqliteEngine.js', () => ({
  createEngine: vi.fn(),
}));

vi.mock('../opfsWorker/archiveValidation.js', () => ({
  validateArchiveEngine: vi.fn(),
}));

import { handleArchiveRestore } from '../opfsWorker/archiveRestoreHandlers.js';
import { createEngine } from '../sqliteEngine.js';
import { validateArchiveEngine } from '../opfsWorker/archiveValidation.js';
import {
  MAX_ARCHIVE_RESTORE_ROWS,
} from '../opfsWorker/archiveGuards.js';
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

function makeRow(id: number, overrides: Row = {}): Row {
  const row: Row = { id, url: `https://example.com/${id}`, created_at: 1700000000000 + id, domain: 'example.com' };
  for (const name of COLUMN_NAMES) {
    if (!(name in row)) row[name] = INTEGER_COLUMNS.has(name) ? 0 : null;
  }
  return { ...row, ...overrides };
}

/** Paging archive engine: generates rows on demand per cursor (exploit style). */
function makePagingEngine(totalRows: number, fatBytes: number) {
  return {
    exec: vi.fn(async () => undefined),
    query: vi.fn(async (_sql: string, params?: SqliteValue[]): Promise<SqliteRow[]> => {
      const cursor = Number(params?.[0] ?? 0);
      const out: SqliteRow[] = [];
      for (let id = cursor + 1; id <= Math.min(cursor + 5000, totalRows); id++) {
        out.push(makeRow(id, { content: 'x'.repeat(fatBytes) }) as SqliteRow);
      }
      return out;
    }),
    queryValue: vi.fn(async () => 1),
    close: vi.fn(async () => undefined),
  };
}

function makeMainEngine() {
  const inserts: Array<{ sql: string; params?: SqliteValue[] | undefined }> = [];
  const engine = {
    exec: vi.fn(async (sql: string, params?: SqliteValue[]) => {
      if (String(sql).includes('INSERT')) inserts.push({ sql, params });
    }),
    query: vi.fn(async (): Promise<SqliteRow[]> => []),
    queryValue: vi.fn(async (): Promise<SqliteValue> => 1),
    close: vi.fn(async () => undefined),
  } as unknown as SqliteEngine;
  return { inserts, engine };
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

describe('handleArchiveRestore — row ceiling pre-check (ARC_CAP_001)', () => {
  it('rejects an over-ceiling observed total before a single insert, discarding staging', async () => {
    vi.mocked(validateArchiveEngine).mockResolvedValue({
      recordCount: MAX_ARCHIVE_RESTORE_ROWS + 1,
      meta: null,
      warnings: [],
    });
    vi.mocked(createEngine).mockResolvedValue(makePagingEngine(0, 0) as never);
    const main = makeMainEngine();

    const stagingName = await prepareOutgoing();
    await expect(
      handleArchiveRestore({ engine: main.engine }, { stagingName }),
    ).rejects.toThrow(/ARC_CAP_001/);
    expect(main.inserts).toHaveLength(0);
    expect(fakeDirRemoved).toContain(stagingName);
  });
});

describe('handleArchiveRestore — exploit regression (VULN-004)', () => {
  it('a 12,000-row crafted archive lying about its totals aborts mid-loop with ARC_CAP_002, bounded inserts, no staging debris', async () => {
    // Gate bypassed / lying meta: validation reports a tiny total while the
    // engine actually yields 12,000 fat rows (~22KB each, ~270MB total).
    vi.mocked(validateArchiveEngine).mockResolvedValue({
      recordCount: 10,
      meta: null,
      warnings: [],
    });
    vi.mocked(createEngine).mockResolvedValue(makePagingEngine(12_000, 22_000) as never);
    const main = makeMainEngine();

    const stagingName = await prepareOutgoing();
    await expect(
      handleArchiveRestore({ engine: main.engine }, { stagingName }),
    ).rejects.toThrow(/ARC_CAP_002/);
    // The loop stopped at the second batch: far fewer than all 12,000 rows
    // reached the main DB, and the hostile staging was discarded.
    expect(main.inserts.length).toBeGreaterThan(0);
    expect(main.inserts.length).toBeLessThan(12_000);
    expect(fakeDirRemoved).toContain(stagingName);
  });
});

describe('handleArchiveRestore — legitimate restore under the ceilings', () => {
  it('imports a small archive unchanged and releases staging', async () => {
    vi.mocked(validateArchiveEngine).mockResolvedValue({
      recordCount: 3,
      meta: null,
      warnings: [],
    });
    vi.mocked(createEngine).mockResolvedValue(makePagingEngine(3, 0) as never);
    const main = makeMainEngine();

    const stagingName = await prepareOutgoing();
    const result = await handleArchiveRestore({ engine: main.engine }, { stagingName });

    expect(result).toEqual({ restored: 3, restoredDeleted: 0, skipped: 0, skippedInvalid: 0 });
    expect(main.inserts).toHaveLength(3);
    expect(fakeDirRemoved).toContain(stagingName);
  });
});
