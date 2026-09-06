// @vitest-environment jsdom
/**
 * archiveHandler.test.ts
 * SW-side archive subtype group (4th partition) — payload validation and
 * delegation to the client-backed archive deps.
 */
import { describe, it, expect, vi } from 'vitest';
import { createArchiveHandler } from '../archiveHandler.js';
import type { ArchiveDeps, DepsResult } from '../deps.js';
import type { ArchivePreviewData, ArchiveCreateData, ArchivePurgeData } from '../../../messaging/sqliteMessages.js';

function makeDeps(overrides: Partial<ArchiveDeps> = {}): ArchiveDeps {
  return {
    archivePreview: vi.fn(async (cutoffMs: number, includeDeleted: boolean): Promise<DepsResult<ArchivePreviewData>> => ({
      success: true,
      data: { total: 10, starred: 2, deleted: 1, oldest: 100, newest: 200, includeDeleted },
    })),
    archiveCreate: vi.fn(async (): Promise<DepsResult<ArchiveCreateData>> => ({
      success: true,
      data: { stagingName: 'archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db', recordCount: 5 },
    })),
    archiveCleanup: vi.fn(async (): Promise<DepsResult<{ removed: string[] }>> => ({
      success: true,
      data: { removed: ['archive_outgoing_x.db'] },
    })),
    archiveExportChunk: vi.fn(async (): Promise<DepsResult<import('../../../messaging/sqliteMessages.js').ArchiveExportData>> => ({
      success: true,
      data: { chunk: [1, 2], nextOffset: 2, total: 2, done: true },
    })),
    archiveDeleteByStaging: vi.fn(async (): Promise<DepsResult<ArchivePurgeData>> => ({
      success: true,
      data: { deleted: 5, remaining: 3, freelistBefore: 10, freelistAfter: 2, vacuumOk: true },
    })),
    ...overrides,
  };
}

const CUTOFF_DATE = '2026-03-31';
const CUTOFF_MS = new Date(2026, 2, 31, 23, 59, 59, 999).getTime();

describe('archiveHandler — archive_preview', () => {
  it('delegates with the includeDeleted flag and forwards the preview', async () => {
    const deps = makeDeps();
    const handler = createArchiveHandler(deps);
    const result = await handler({ subtype: 'archive_preview', cutoffMs: CUTOFF_MS, includeDeleted: true } as never);
    expect(result).toEqual({
      success: true,
      preview: { total: 10, starred: 2, deleted: 1, oldest: 100, newest: 200, includeDeleted: true },
    });
    expect(deps.archivePreview).toHaveBeenCalledWith(CUTOFF_DATE, CUTOFF_MS, true);
  });

  it('treats a non-boolean includeDeleted as false (strict flag)', async () => {
    const deps = makeDeps();
    const handler = createArchiveHandler(deps);
    const result = await handler({ subtype: 'archive_preview', cutoffMs: CUTOFF_MS, includeDeleted: 1 } as never);
    expect((result as { preview: { includeDeleted: boolean } }).preview.includeDeleted).toBe(false);
    expect(deps.archivePreview).toHaveBeenCalledWith(CUTOFF_DATE, CUTOFF_MS, false);
  });

  it('rejects a missing/invalid cutoffMs without touching deps', async () => {
    const deps = makeDeps();
    const handler = createArchiveHandler(deps);
    const result = await handler({ subtype: 'archive_preview', cutoffMs: 'x', includeDeleted: false } as never);
    expect(result).toEqual({ success: false, error: 'archive_preview: cutoffMs must be a positive number' });
    expect(deps.archivePreview).not.toHaveBeenCalled();
  });

  it('forwards failure reasons with the retriable flag', async () => {
    const deps = makeDeps({
      archivePreview: vi.fn(async (): Promise<DepsResult<ArchivePreviewData>> => ({
        success: false,
        error: { message: 'OPFS Worker unavailable', kind: 'sqlite_error', retriable: false },
      })),
    });
    const handler = createArchiveHandler(deps);
    const result = await handler({ subtype: 'archive_preview', cutoffMs: CUTOFF_MS, includeDeleted: false });
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
    expect(result).toEqual({ success: false, error: 'archive_create: cutoffDate is required' });
  });

  it('rejects an over-long yasumaroVersion', async () => {
    const deps = makeDeps();
    const handler = createArchiveHandler(deps);
    const result = await handler({
      subtype: 'archive_create',
      cutoffDate: CUTOFF_DATE,
      cutoffMs: CUTOFF_MS,
      includeDeleted: false,
      yasumaroVersion: 'v'.repeat(65),
    });
    expect(result).toEqual({ success: false, error: 'archive_create: yasumaroVersion must be 1-64 chars' });
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

  it('rejects a missing stagingName', async () => {
    const deps = makeDeps();
    const handler = createArchiveHandler(deps);
    const result = await handler({ subtype: 'archive_delete_by_staging' } as never);
    expect(result).toEqual({ success: false, error: 'archive_delete_by_staging: stagingName is required' });
    expect(deps.archiveDeleteByStaging).not.toHaveBeenCalled();
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
