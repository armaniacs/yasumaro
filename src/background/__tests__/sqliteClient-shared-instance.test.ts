/**
 * sqliteClient-shared-instance.test.ts
 * M8: getSharedSqliteClient() must return a single, module-level SqliteClient
 * instance so callers (service-worker.ts, auditLog.ts, reviewSummaryGenerator.ts)
 * share one offscreen-document lifecycle instead of racing independent copies.
 */

import { vi, describe, it, expect } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  ErrorCode: { STORAGE_READ_FAILURE: 'STRG_RD_001' },
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}));

vi.mock('../../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../sqliteAlert.js', () => ({
  recordSqliteSuccess: vi.fn(),
  recordSqliteFailure: vi.fn(),
}));

import { SqliteClient, getSharedSqliteClient } from '../sqliteClient.js';

describe('getSharedSqliteClient (M8)', () => {
  it('returns the same instance on repeated calls', () => {
    const a = getSharedSqliteClient();
    const b = getSharedSqliteClient();

    expect(a).toBe(b);
  });

  it('returns an instance of SqliteClient', () => {
    const client = getSharedSqliteClient();

    expect(client).toBeInstanceOf(SqliteClient);
  });
});
