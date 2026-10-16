// @vitest-environment jsdom
/**
 * archiveHandler.test.ts
 * SW-side archive subtype group (4th partition) — payload validation and
 * delegation to the client-backed archive deps.
 */
import { describe, it, expect, vi } from 'vitest';
import { createArchiveHandler } from '../archiveHandler.js';
import { dashboardSqliteValidator } from '../../../../messaging/validators.js';
import type { ArchiveDeps, DepsResult } from '../deps.js';
import type { ArchivePreviewData, ArchiveCreateData, ArchivePurgeData } from '../../../../messaging/sqliteMessages.js';

function makeDeps(overrides: Partial<ArchiveDeps> = {}): ArchiveDeps {
  return {
    archivePreview: vi.fn(
      async (_cutoffDate: string, _cutoffMs: number, includeDeleted: boolean): Promise<DepsResult<ArchivePreviewData>> => ({
        success: true,
        data: { total: 10, starred: 2, deleted: 1, oldest: 100, newest: 200, includeDeleted },
      }),
    ),
    archiveCreate: vi.fn(async (): Promise<DepsResult<ArchiveCreateData>> => ({
      success: true,
      data: { stagingName: 'archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db', recordCount: 5 },
    })),
    archiveCleanup: vi.fn(async (): Promise<DepsResult<{ removed: string[] }>> => ({
      success: true,
      data: { removed: ['archive_outgoing_x.db'] },
    })),
    archiveExportChunk: vi.fn(async (): Promise<DepsResult<import('../../../../messaging/sqliteMessages.js').ArchiveExportData>> => ({
      success: true,
      data: { chunk: [1, 2], nextOffset: 2, total: 2, done: true },
    })),
    archiveDeleteByStaging: vi.fn(async (): Promise<DepsResult<ArchivePurgeData>> => ({
      success: true,
      data: { deleted: 5, remaining: 3, freelistBefore: 10, freelistAfter: 2, vacuumOk: true },
    })),
    ...overrides,
  } as ArchiveDeps;
}

const CUTOFF_DATE = '2026-03-31';
const CUTOFF_MS = new Date(2026, 2, 31, 23, 59, 59, 999).getTime();

describe('archiveHandler — archive_preview', () => {
  it('delegates with the includeDeleted flag and forwards the preview', async () => {
    const deps = makeDeps();
    const handler = createArchiveHandler(deps);
    const result = await handler({ subtype: 'archive_preview', cutoffDate: CUTOFF_DATE, cutoffMs: CUTOFF_MS, includeDeleted: true } as never);
    expect(result).toEqual({
      success: true,
      preview: { total: 10, starred: 2, deleted: 1, oldest: 100, newest: 200, includeDeleted: true },
    });
    expect(deps.archivePreview).toHaveBeenCalledWith(CUTOFF_DATE, CUTOFF_MS, true);
  });

  it('rejects a non-boolean includeDeleted (strict flag, matching the envelope gate)', async () => {
    const deps = makeDeps();
    const handler = createArchiveHandler(deps);
    const result = await handler({ subtype: 'archive_preview', cutoffDate: CUTOFF_DATE, cutoffMs: CUTOFF_MS, includeDeleted: 1 } as never);
    // PBI 2026-10-11-10: the wire row now runs the same spec row as the
    // envelope, so the handler-level coercion (=== true) is no longer reachable
    // with a non-boolean flag — the payload is rejected before the deps call.
    expect(result).toEqual({ success: false, error: 'archive_preview: includeDeleted must be boolean' });
    expect(deps.archivePreview).not.toHaveBeenCalled();
  });

  it('rejects a missing cutoffDate without touching deps', async () => {
    const deps = makeDeps();
    const handler = createArchiveHandler(deps);
    const result = await handler({ subtype: 'archive_preview', cutoffMs: 'x', includeDeleted: false } as never);
    expect(result).toEqual({ success: false, error: 'archive_preview: cutoffDate must be string' });
    expect(deps.archivePreview).not.toHaveBeenCalled();
  });

  it('forwards failure reasons with the retriable flag', async () => {
    const deps = makeDeps({
      archivePreview: vi.fn(async (): Promise<DepsResult<ArchivePreviewData>> => ({
        success: false,
        error: { message: 'OPFS Worker unavailable', kind: 'sqlite_error' as const, retriable: false },
      })),
    });
    const handler = createArchiveHandler(deps);
    const result = await handler({
      subtype: 'archive_preview',
      cutoffDate: CUTOFF_DATE,
      cutoffMs: CUTOFF_MS,
      includeDeleted: false,
    } as never);
    expect(result).toEqual({ success: false, error: 'OPFS Worker unavailable', retriable: false });
  });
});

describe('archiveHandler — archive_create', () => {
  it('delegates the full parameter set and forwards staging info', async () => {
    const deps = makeDeps();
    const handler = createArchiveHandler(deps);
    const result = await handler({
      subtype: 'archive_create',
      cutoffDate: CUTOFF_DATE,
      cutoffMs: CUTOFF_MS,
      includeDeleted: true,
      yasumaroVersion: '6.7.113',
    });
    expect(result).toEqual({
      success: true,
      stagingName: 'archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db',
      recordCount: 5,
    });
    expect(deps.archiveCreate).toHaveBeenCalledWith({
      cutoffDate: CUTOFF_DATE,
      cutoffMs: CUTOFF_MS,
      includeDeleted: true,
      yasumaroVersion: '6.7.113',
    });
  });

  it('rejects a missing cutoffDate', async () => {
    const deps = makeDeps();
    const handler = createArchiveHandler(deps);
    const result = await handler({ subtype: 'archive_create', cutoffMs: CUTOFF_MS, includeDeleted: false, yasumaroVersion: 'x' } as never);
    expect(result).toEqual({ success: false, error: 'archive_create: cutoffDate must be string' });
  });

  it('rejects an over-long yasumaroVersion at the validator (handler holds no duplicate)', () => {
    // PBI 2026-09-07-21: the handler-side yasumaroVersion check was removed —
    // DashboardSqliteValidator owns the shape (identical message) and always
    // runs first via MessageRouter.dispatch.
    const deps = makeDeps();
    expect(() =>
      dashboardSqliteValidator.validate({
        type: 'DASHBOARD_SQLITE',
        protocolVersion: 2,
        payload: {
          subtype: 'archive_create',
          cutoffDate: CUTOFF_DATE,
          cutoffMs: CUTOFF_MS,
          includeDeleted: false,
          yasumaroVersion: 'v'.repeat(65),
        },
      }),
    ).toThrow(/yasumaroVersion must be 1-64 chars/);
    expect(deps.archiveCreate).not.toHaveBeenCalled();
  });
});

describe('archiveHandler — archive_delete_by_staging', () => {
  it('delegates and forwards the purge outcome', async () => {
    const deps = makeDeps();
    const handler = createArchiveHandler(deps);
    const result = await handler({ subtype: 'archive_delete_by_staging', stagingName: 'archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db' });
    expect(result).toEqual({
      success: true,
      deleted: 5, remaining: 3, freelistBefore: 10, freelistAfter: 2, vacuumOk: true,
    });
    expect(deps.archiveDeleteByStaging).toHaveBeenCalledWith('archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db');
  });

  it('rejects a missing stagingName at the validator (handler holds no shape check)', () => {
    // PBI 2026-09-07-21: handler stagingName checks were removed — the
    // validator rejects first on the production path (router dispatch order).
    const deps = makeDeps();
    expect(() =>
      dashboardSqliteValidator.validate({
        type: 'DASHBOARD_SQLITE',
        protocolVersion: 2,
        payload: { subtype: 'archive_delete_by_staging' },
      }),
    ).toThrow(/stagingName/);
    expect(deps.archiveDeleteByStaging).not.toHaveBeenCalled();
  });
});

describe('archiveHandler — archive_export', () => {
  it('delegates the chunk request and forwards the chunk response', async () => {
    const deps = makeDeps();
    const handler = createArchiveHandler(deps);
    const result = await handler({
      subtype: 'archive_export',
      stagingName: 'archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db',
      offset: 0,
      length: 8 * 1024 * 1024,
    });
    expect(result).toEqual({ success: true, chunk: [1, 2], nextOffset: 2, total: 2, done: true });
    expect(deps.archiveExportChunk).toHaveBeenCalledWith(
      'archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db', 0, 8 * 1024 * 1024,
    );
  });

  it('rejects a missing stagingName at the validator (handler holds no shape check)', () => {
    const deps = makeDeps();
    expect(() =>
      dashboardSqliteValidator.validate({
        type: 'DASHBOARD_SQLITE',
        protocolVersion: 2,
        payload: { subtype: 'archive_export', offset: 0, length: 10 },
      }),
    ).toThrow(/stagingName/);
    expect(deps.archiveExportChunk).not.toHaveBeenCalled();
  });

  it('rejects a non-positive length without touching deps', async () => {
    const deps = makeDeps();
    const handler = createArchiveHandler(deps);
    const result = await handler({ subtype: 'archive_export', stagingName: 'archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db', offset: 0, length: 0 } as never);
    expect(result).toEqual({ success: false, error: 'archive_export: length must be 1..8388608' });
    expect(deps.archiveExportChunk).not.toHaveBeenCalled();
  });
});

describe('archiveHandler — archive_cleanup', () => {
  it('delegates and forwards the removed list', async () => {
    const deps = makeDeps();
    const handler = createArchiveHandler(deps);
    const result = await handler({ subtype: 'archive_cleanup' });
    expect(result).toEqual({ success: true, removed: ['archive_outgoing_x.db'] });
    expect(deps.archiveCleanup).toHaveBeenCalled();
  });
});

describe('archiveHandler — handler entry validates without the envelope gate (PBI 2026-10-16-02)', () => {
  it('rejects an unknown stagingName direct call before deps (archive_open)', async () => {
    const deps = makeDeps({
      archiveOpen: vi.fn(async () => ({ success: true, data: undefined }) as never),
    });
    const handler = createArchiveHandler(deps);
    const result = await handler({ subtype: 'archive_open', stagingName: 'yasumaro.db' } as never);
    expect(result).toEqual({ success: false, error: 'archive_open: stagingName must be a valid staging name' });
    expect(deps.archiveOpen).not.toHaveBeenCalled();
  });

  it('rejects a missing stagingName direct call before deps (archive_save)', async () => {
    const deps = makeDeps({
      archiveSave: vi.fn(async () => ({ success: true, data: { dirty: false } }) as never),
    });
    const handler = createArchiveHandler(deps);
    const result = await handler({ subtype: 'archive_save' } as never);
    expect(result).toEqual({ success: false, error: 'archive_save: stagingName must be a valid staging name' });
    expect(deps.archiveSave).not.toHaveBeenCalled();
  });

  it('archive_update rejects with the spec-table text (no hand-written copy)', async () => {
    const deps = makeDeps({
      archiveUpdate: vi.fn(async () => ({ success: true, data: { dirty: true } }) as never),
    });
    const handler = createArchiveHandler(deps);
    const result = await handler({
      subtype: 'archive_update',
      stagingName: 'archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db',
      id: 0,
      changes: { summary: 'x' },
    } as never);
    expect(result).toEqual({ success: false, error: 'archive_update: id must be a positive integer' });
    expect(deps.archiveUpdate).not.toHaveBeenCalled();
  });
});
