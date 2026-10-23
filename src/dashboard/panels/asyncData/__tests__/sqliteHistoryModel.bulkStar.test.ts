/**
 * sqliteHistoryModel.bulkStar.test.ts
 * PBI 2026-10-23-07 — bulk star apply + undo.
 * Pins: a bulk star flips unstarred rows only (an already-starred row is
 * never toggled down), the undo re-runs the same core over the batch's
 * changed ids, a service error stops the loop with a partial count, and the
 * privacy-judged predicate reads the PII masking signal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../dashboardSqliteService.js', () => ({
  queryLogs: vi.fn(),
  searchLogs: vi.fn(),
  toggleStar: vi.fn(),
  deleteLog: vi.fn(),
  getSqliteStatus: vi.fn().mockResolvedValue({ initialized: true, fallback: false }),
  appendToLogs: vi.fn(),
  // Mirrors the real narrowing helper: the model imports it alongside the
  // query functions to tell the failure side of ServiceResult apart.
  isServiceError: (r: unknown) => typeof r === 'object' && r !== null && 'error' in r,
}));

vi.mock('../../../../utils/storageUrls.js', () => ({
  getSavedUrlEntries: vi.fn().mockResolvedValue([]),
  removeSavedUrl: vi.fn().mockResolvedValue(undefined),
}));

import { createSqliteHistoryModel, isPrivacyJudgedEntry } from '../sqliteHistoryModel.js';
import * as db from '../../../dashboardSqliteService.js';
import type { BrowsingLogEntry } from '../sqliteHistoryQuery.js';

const mockedDb = db as unknown as {
  queryLogs: ReturnType<typeof vi.fn>;
  toggleStar: ReturnType<typeof vi.fn>;
  getSqliteStatus: ReturnType<typeof vi.fn>;
};

function makeRow(id: number, overrides: Partial<BrowsingLogEntry> = {}): BrowsingLogEntry {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Example ${id}`,
    created_at: 1700000000000 + id,
    ...overrides,
  };
}

function okStar(starred: boolean): { data: { id: number; is_starred: number } } {
  return { data: { id: 0, is_starred: starred ? 1 : 0 } };
}

async function createModelWithRows(rows: BrowsingLogEntry[]) {
  mockedDb.queryLogs.mockResolvedValue({ data: { rows, total: rows.length } });
  const model = createSqliteHistoryModel({});
  await model.fetchData({ page: 0 });
  return model;
}

describe('bulkSetStarred — apply + undo (PBI 2026-10-23-07)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDb.getSqliteStatus.mockResolvedValue({ initialized: true, fallback: false });
    (chrome.storage.local.get as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (chrome.storage.local.set as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it('flips unstarred rows and skips rows already in the target state (never toggled down)', async () => {
    mockedDb.toggleStar.mockImplementation(async (id: number) => ({ data: { id, is_starred: 1 } }));
    const model = await createModelWithRows([
      makeRow(1),
      makeRow(2, { is_starred: 1 }),
      makeRow(3),
    ]);
    model.selectEntry(1, true);
    model.selectEntry(2, true);
    model.selectEntry(3, true);

    const result = await model.bulkSetStarred([1, 2, 3], true);
    expect(result.starredCount).toBe(2);
    expect(result.skippedAlreadyInState).toBe(1);
    expect(result.changedIds).toEqual([1, 3]);
    expect(mockedDb.toggleStar).toHaveBeenCalledTimes(2);
    // The already-starred row 2 is untouched (never toggled down).
    expect(model.getState().entries.find((e) => e.id === 2)?.is_starred).toBe(1);
    expect(model.getState().entries.find((e) => e.id === 1)?.is_starred).toBe(1);
  });

  it('undo re-runs the core over the batch changed ids and unstars them', async () => {
    mockedDb.toggleStar.mockImplementation(async (id: number) => ({ data: { id, is_starred: 1 } }));
    const model = await createModelWithRows([makeRow(1), makeRow(2)]);
    model.selectEntry(1, true);
    model.selectEntry(2, true);

    const applied = await model.bulkSetStarred([1, 2], true);
    expect(applied.changedIds).toEqual([1, 2]);

    // Undo: the same core over the changed ids with starred=false.
    mockedDb.toggleStar.mockImplementation(async (id: number) => ({ data: { id, is_starred: 0 } }));
    const undone = await model.bulkSetStarred(applied.changedIds, false);
    expect(undone.starredCount).toBe(2);
    expect(undone.changedIds).toEqual([1, 2]);
    expect(model.getState().entries.find((e) => e.id === 1)?.is_starred).toBe(0);
    expect(model.getState().entries.find((e) => e.id === 2)?.is_starred).toBe(0);
  });

  it('stops at the first service error and reports the partial count', async () => {
    mockedDb.toggleStar
      .mockResolvedValueOnce(okStar(true))
      .mockResolvedValueOnce({ error: 'Database connection lost. Please reload the extension.' });
    const model = await createModelWithRows([makeRow(1), makeRow(2), makeRow(3)]);
    model.selectEntry(1, true);
    model.selectEntry(2, true);
    model.selectEntry(3, true);

    const result = await model.bulkSetStarred([1, 2, 3], true);
    expect(result.starredCount).toBe(1);
    expect(result.error).toBe('Database connection lost. Please reload the extension.');
    expect(result.changedIds).toEqual([1]);
  });

  it('reports zero starred for an empty id list without touching storage', async () => {
    const model = await createModelWithRows([]);
    const result = await model.bulkSetStarred([], true);
    expect(result.starredCount).toBe(0);
    expect(mockedDb.toggleStar).not.toHaveBeenCalled();
  });
});

describe('isPrivacyJudgedEntry (PBI 2026-10-23-07)', () => {
  it('is true when the record went through PII masking', () => {
    expect(isPrivacyJudgedEntry(makeRow(1, { masked_count: 3 }))).toBe(true);
  });

  it('is false for a plain record and treats null as no masking', () => {
    expect(isPrivacyJudgedEntry(makeRow(1))).toBe(false);
    expect(isPrivacyJudgedEntry(makeRow(1, { masked_count: null }))).toBe(false);
    expect(isPrivacyJudgedEntry(makeRow(1, { masked_count: 0 }))).toBe(false);
  });
});
