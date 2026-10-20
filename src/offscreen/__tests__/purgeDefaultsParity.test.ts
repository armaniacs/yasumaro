/**
 * purgeDefaultsParity.test.ts
 * Pins the purge-seam retention defaults (PBI 04 mirror contract): the wire
 * defaults (queryPlanner.planPurge) and the executor defaults
 * (dbMaintenance.purgeOldRecords with no args) must come from one definition.
 * The former local mirror in dbMaintenance restated queryPlanner's values, so
 * a one-sided edit could leave a destructive purge purging on a different
 * default than the planner promised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as queryPlanner from '../queryPlanner.js';

const backend = vi.hoisted(() => ({
  purgeOldRecords: vi.fn(),
  purgeContent: vi.fn(),
}));

vi.mock('../sqliteEngineHost.js', () => ({
  engine: {
    getBackend: vi.fn().mockResolvedValue(backend),
  },
}));

import { purgeOldRecords } from '../dbMaintenance.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('purge defaults parity (PBI 04 SSOT)', () => {
  it('keeps the pinned values 90 days / 1000 records', () => {
    expect(queryPlanner.DEFAULT_RETENTION_DAYS).toBe(90);
    expect(queryPlanner.DEFAULT_MAX_RECORDS).toBe(1000);
  });

  it('the executor defaults equal the planner constants (one definition)', async () => {
    backend.purgeOldRecords.mockResolvedValue({ success: true, purged: 0 });
    await purgeOldRecords();
    expect(backend.purgeOldRecords).toHaveBeenCalledWith(
      queryPlanner.DEFAULT_RETENTION_DAYS,
      queryPlanner.DEFAULT_MAX_RECORDS,
    );
  });

  it('planPurge falls back to the same defaults', () => {
    expect(queryPlanner.planPurge(undefined, undefined)).toEqual({
      ok: true,
      retentionDays: 90,
      maxRecords: 1000,
    });
  });
});
