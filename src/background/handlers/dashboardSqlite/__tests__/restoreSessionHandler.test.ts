import { describe, it, expect, vi } from 'vitest';
import { createRestoreSessionHandler, RESTORE_SESSION_SUBTYPES } from '../restoreSessionHandler.js';
import type { RestoreSessionDeps } from '../deps.js';
import type { DashboardSqliteRequest } from '../../../../messaging/dashboardSqliteProtocol.js';
import { ALL_DASHBOARD_SQLITE_SUBTYPES } from '../../../../messaging/sqliteOperationSecurity.js';
import { READ_ONLY_SUBTYPES } from '../readOnlyHandler.js';
import { CORE_CRUD_SUBTYPES } from '../coreCrudHandler.js';
import { MAINTENANCE_BATCH_SUBTYPES } from '../maintenanceBatchHandler.js';
import { ARCHIVE_SUBTYPES } from '../archiveHandler.js';
import { bytesToBase64, base64ToBytes } from '../../../../utils/crypto/index.js';

const STAGING = 'restore_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db';

function makeDeps(): RestoreSessionDeps {
  return {
    restoreBegin: vi.fn(async (_totalBytes: number, _totalChunks: number) => ({ success: true as const, data: STAGING })),
    restoreAppendChunk: vi.fn(async (_stagingName: string, _offset: number, _dataBase64: string) => ({ success: true as const, data: 2 })),
    restoreCommit: vi.fn(async (_stagingName: string, _totalBytes: number) => ({ success: true as const, data: undefined })),
    restoreAbort: vi.fn(async (_stagingName: string) => ({ success: true as const, data: undefined })),
  };
}

describe('restoreSessionHandler', () => {
  it('delegates restore_begin with the declared sizes and projects the staging name', async () => {
    const deps = makeDeps();
    const handler = createRestoreSessionHandler(deps);
    const result = await handler({ subtype: 'restore_begin', totalBytes: 7_500_001, totalChunks: 3 } as DashboardSqliteRequest);
    expect(deps.restoreBegin).toHaveBeenCalledWith(7_500_001, 3);
    expect(result).toEqual({ success: true, stagingName: STAGING });
  });

  it('passes the base64 chunk through verbatim (no decode in the SW) with the byte offset', async () => {
    const deps = makeDeps();
    const handler = createRestoreSessionHandler(deps);
    const result = await handler({ subtype: 'restore_chunk', stagingName: STAGING, offset: 3_145_728, data: 'ChQ=' } as DashboardSqliteRequest);
    expect(deps.restoreAppendChunk).toHaveBeenCalledWith(STAGING, 3_145_728, 'ChQ=');
    expect(result).toEqual({ success: true, written: 2 });
  });

  it('delegates restore_commit with the declared total', async () => {
    const deps = makeDeps();
    const handler = createRestoreSessionHandler(deps);
    const result = await handler({ subtype: 'restore_commit', stagingName: STAGING, totalBytes: 7_500_001 } as DashboardSqliteRequest);
    expect(deps.restoreCommit).toHaveBeenCalledWith(STAGING, 7_500_001);
    expect(result).toEqual({ success: true });
  });

  it('delegates restore_abort', async () => {
    const deps = makeDeps();
    const handler = createRestoreSessionHandler(deps);
    const result = await handler({ subtype: 'restore_abort', stagingName: STAGING } as DashboardSqliteRequest);
    expect(deps.restoreAbort).toHaveBeenCalledWith(STAGING);
    expect(result).toEqual({ success: true });
  });

  it('forwards the failure reason with the retriable flag', async () => {
    const deps = makeDeps();
    deps.restoreCommit = vi.fn(async (_stagingName: string, _totalBytes: number) => ({
      success: false as const,
      error: { kind: 'unknown' as const, message: 'staged size mismatch', retriable: false },
    }));
    const handler = createRestoreSessionHandler(deps);
    const result = await handler({ subtype: 'restore_commit', stagingName: STAGING, totalBytes: 8 } as DashboardSqliteRequest);
    expect(result).toEqual({ success: false, error: 'staged size mismatch', retriable: false });
  });

  it('rejects a malformed payload before deps (handler-entry spec gate)', async () => {
    const deps = makeDeps();
    const handler = createRestoreSessionHandler(deps);
    const result = await handler({ subtype: 'restore_chunk', stagingName: 'yasumaro.db', offset: 0, data: 'ChQ=' } as unknown as DashboardSqliteRequest);
    expect(result).toEqual({ success: false, error: expect.stringContaining('stagingName') });
    expect(deps.restoreAppendChunk).not.toHaveBeenCalled();
  });

  it('is stateless across calls: each request carries its own staging name', async () => {
    const deps = makeDeps();
    const handler = createRestoreSessionHandler(deps);
    // Two interleaved sessions — the handler must not bind the first
    // session's name into later requests (MV3 ephemeral rule).
    await handler({ subtype: 'restore_begin', totalBytes: 8, totalChunks: 1 } as DashboardSqliteRequest);
    await handler({ subtype: 'restore_chunk', stagingName: 'restore_incoming_0b29dc4a-1234-4e56-9abc-def012345678.db', offset: 0, data: 'AQ==' } as DashboardSqliteRequest);
    await handler({ subtype: 'restore_commit', stagingName: STAGING, totalBytes: 8 } as DashboardSqliteRequest);
    const calls = vi.mocked(deps.restoreAppendChunk).mock.calls;
    expect(calls[0]![0]).toBe('restore_incoming_0b29dc4a-1234-4e56-9abc-def012345678.db');
    expect(vi.mocked(deps.restoreCommit).mock.calls[0]![0]).toBe(STAGING);
  });
});

describe('restoreSessionHandler — subtype partition', () => {
  it('owns exactly the four restore session subtypes', () => {
    expect([...RESTORE_SESSION_SUBTYPES].sort()).toEqual([
      'restore_abort', 'restore_begin', 'restore_chunk', 'restore_commit',
    ]);
  });

  it('the five handler groups partition the canonical subtype list with no overlap', () => {
    const groups = [READ_ONLY_SUBTYPES, CORE_CRUD_SUBTYPES, MAINTENANCE_BATCH_SUBTYPES, RESTORE_SESSION_SUBTYPES, ARCHIVE_SUBTYPES];
    const all = groups.flatMap((g) => [...g]);
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(all)).toEqual(new Set(ALL_DASHBOARD_SQLITE_SUBTYPES));
  });
});

describe('restoreSessionHandler — base64 sanity of the passthrough contract', () => {
  it('the chunk the SW forwards decodes to the exact bytes the dashboard encoded', () => {
    // Pins the contract the SW relies on: data is standard base64 of the
    // DB bytes, decoded once offscreen (utils/crypto codec).
    const bytes = new Uint8Array([0, 1, 251, 255, 128, 7]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });
});
