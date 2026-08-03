/**
 * dbMaintenance.test.ts
 *
 * Coverage gap PBI (re-audit 2026-08-02): dbMaintenance wrappers were at
 * ~12% coverage. Verify each delegation wrapper forwards to the active
 * backend and propagates success/failure correctly.
 */

import { vi } from 'vitest';
import { purgeOldRecords, purgeContent, backupDb, restoreDb, sqliteHealthCheck } from '../dbMaintenance.js';

const backend = vi.hoisted(() => ({
  purgeOldRecords: vi.fn(),
  purgeContent: vi.fn(),
  backupDb: vi.fn(),
  restoreDb: vi.fn(),
  healthCheck: vi.fn(),
  getFtsIndexSize: vi.fn(),
}));

vi.mock('../sqliteEngineContext.js', () => ({
  engine: {
    getBackend: vi.fn().mockResolvedValue(backend),
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logWarn: vi.fn(),
  logError: vi.fn(),
  ErrorCode: { STORAGE_WRITE_FAILURE: 'STORAGE_WRITE_FAILURE' },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('dbMaintenance — wrapper delegation (re-audit 2026-08-02)', () => {
  it('purgeOldRecords forwards args and returns success', async () => {
    backend.purgeOldRecords.mockResolvedValue({ success: true, purged: 3 });
    const result = await purgeOldRecords(30, 500);
    expect(backend.purgeOldRecords).toHaveBeenCalledWith(30, 500);
    expect(result).toEqual({ success: true, purged: 3 });
  });

  it('purgeOldRecords propagates backend failure', async () => {
    backend.purgeOldRecords.mockResolvedValue({ success: false, error: 'boom' });
    const result = await purgeOldRecords();
    expect(result).toEqual({ success: false, error: 'boom' });
  });

  it('purgeContent forwards nullable args correctly', async () => {
    backend.purgeContent.mockResolvedValue({ success: true, purged: 2 });
    const result = await purgeContent(null, 1000, false);
    expect(backend.purgeContent).toHaveBeenCalledWith(undefined, 1000, false);
    expect(result).toEqual({ success: true, purged: 2 });
  });

  it('backupDb returns binary data from the backend', async () => {
    const data = new Uint8Array([1, 2, 3]);
    backend.backupDb.mockResolvedValue({ success: true, data });
    const result = await backupDb();
    expect(backend.backupDb).toHaveBeenCalled();
    expect(result).toEqual({ success: true, data });
  });

  it('backupDb returns error when the backend cannot back up', async () => {
    backend.backupDb.mockResolvedValue({ success: false, error: 'OPFS only' });
    const result = await backupDb();
    expect(result).toEqual({ success: false, error: 'OPFS only' });
  });

  it('restoreDb forwards the payload to the backend', async () => {
    backend.restoreDb.mockResolvedValue({ success: true });
    const data = new Uint8Array([9]);
    const result = await restoreDb(data);
    expect(backend.restoreDb).toHaveBeenCalledWith(data);
    expect(result).toEqual({ success: true });
  });

  it('sqliteHealthCheck returns true when the backend health check succeeds', async () => {
    backend.healthCheck.mockResolvedValue({ success: true });
    const result = await sqliteHealthCheck();
    expect(result).toBe(true);
  });

  it('sqliteHealthCheck returns false when the backend health check fails', async () => {
    backend.healthCheck.mockResolvedValue({ success: false });
    const result = await sqliteHealthCheck();
    expect(result).toBe(false);
  });
});
