/**
 * dailyPurgeAuditLog.test.ts
 * PBI 2026-09-29-31: the audit_log retention sweep on the daily alarm.
 *
 * audit_log records every URL handed to a cloud AI provider, so it must be
 * swept even when the record/content retention settings are off, and a failed
 * sweep must be recorded as a failure rather than as "0 purged".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_SETTINGS } from '../../utils/storage/defaults.js';
import { StorageKeys } from '../../utils/storage/types.js';
import type { CallResult } from '../sqlite/offscreenGateway.js';

const { mockGetSettings } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
}));

vi.mock('../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: mockGetSettings,
      get: mockGetSettings,
      getMany: mockGetSettings,
      set: vi.fn(),
      setAll: vi.fn(),
      clearCache: vi.fn(),
    },
  };
});

vi.mock('../../utils/logger/types.js', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
  ErrorCode: { STORAGE_READ_FAILURE: 'STRG_RD_001', STORAGE_WRITE_FAILURE: 'STRG_WR_001' },
}));
vi.mock('../../utils/logger/core.js', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
  ErrorCode: { STORAGE_READ_FAILURE: 'STRG_RD_001', STORAGE_WRITE_FAILURE: 'STRG_WR_001' },
}));
vi.mock('../../utils/logger/api.js', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
  ErrorCode: { STORAGE_READ_FAILURE: 'STRG_RD_001', STORAGE_WRITE_FAILURE: 'STRG_WR_001' },
}));

import { handleDailyPurgeAlarm, AUDIT_LOG_RETENTION_DAYS } from '../dailyPurgeHandler.js';
import { logInfo } from '../../utils/logger/api.js';

type AuditPurgeFn = (retentionDays?: number) => Promise<CallResult<{ purged: number }>>;

const okPurge = (purged: number) => vi.fn().mockResolvedValue({ success: true, data: { purged } } as CallResult<{ purged: number }>);
const noopRecordPurge = vi.fn().mockResolvedValue({ success: true, data: { purged: 0 } } as CallResult<{ purged: number }>);
const noopClear = vi.fn().mockResolvedValue(undefined);

function auditLogCalls(purgeAuditLog: AuditPurgeFn): unknown[][] {
  return purgeAuditLog.mock.calls as unknown[][];
}

describe('handleDailyPurgeAlarm: audit_log retention sweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue({});
  });

  it('runs the sweep even when every retention setting is off (unlimited)', async () => {
    mockGetSettings.mockResolvedValue({
      sqlite_retention_days: null,
      sqlite_max_records: null,
      content_retention_days: null,
      content_max_records: null,
    });
    const purgeAuditLog = okPurge(2);

    await handleDailyPurgeAlarm(noopRecordPurge, undefined, noopClear, purgeAuditLog);

    expect(purgeAuditLog).toHaveBeenCalledTimes(1);
    expect(auditLogCalls(purgeAuditLog)[0]).toEqual([AUDIT_LOG_RETENTION_DAYS]);
  });

  it('sweeps with a positive window, never undefined ("keep everything")', async () => {
    const purgeAuditLog = okPurge(0);

    await handleDailyPurgeAlarm(noopRecordPurge, undefined, noopClear, purgeAuditLog);

    const [days] = auditLogCalls(purgeAuditLog)[0] as [number];
    expect(typeof days).toBe('number');
    expect(days).toBeGreaterThan(0);
  });

  it('the window matches the content-retention default so the two policies read alike', () => {
    expect(AUDIT_LOG_RETENTION_DAYS).toBe(DEFAULT_SETTINGS[StorageKeys.CONTENT_RETENTION_DAYS]);
  });

  it('logs the swept count on success', async () => {
    const purgeAuditLog = okPurge(3);

    await handleDailyPurgeAlarm(noopRecordPurge, undefined, noopClear, purgeAuditLog);

    expect(logInfo).toHaveBeenCalledWith('daily-audit-purge completed', { purged: 3 }, 'dailyPurgeHandler');
  });

  it('logs -1 when the sweep fails instead of hiding the failure as 0 purged', async () => {
    const purgeAuditLog = vi.fn().mockResolvedValue({
      success: false,
      error: { kind: 'sqlite_error', message: 'disk I/O error', retriable: false },
    } as unknown as CallResult<{ purged: number }>);

    await handleDailyPurgeAlarm(noopRecordPurge, undefined, noopClear, purgeAuditLog);

    expect(logInfo).toHaveBeenCalledWith('daily-audit-purge completed', { purged: -1 }, 'dailyPurgeHandler');
  });

  it('a failed sweep does not stop the remaining sweeps or the alarm', async () => {
    const purgeAuditLog = vi.fn().mockRejectedValue(new Error('boom'));
    const purgeContent = okPurge(1);

    await expect(
      handleDailyPurgeAlarm(noopRecordPurge, purgeContent, noopClear, purgeAuditLog),
    ).resolves.toBeUndefined();
  });

  it('stays optional: a caller that wires no audit sweep still completes', async () => {
    await expect(
      handleDailyPurgeAlarm(noopRecordPurge, undefined, noopClear, undefined),
    ).resolves.toBeUndefined();
  });
});
