/**
 * daily-purge-alarm.test.ts
 * TDD: handleDailyPurgeAlarm calls purgeOldRecords with user settings,
 * and skips purge when both settings are null (unlimited).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ────────────────────────────────────────────────────────────────────

import type { CallResult } from '../sqliteClient.js';

type PurgeResult = CallResult<{ purged: number }>;

const mockPurgeOldRecords = vi.fn<() => Promise<PurgeResult>>()
    .mockResolvedValue({ success: true, data: { purged: 0 } });

const { mockGetSettings } = vi.hoisted(() => ({
    mockGetSettings: vi.fn(),
}));

vi.mock('../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      StorageKeys: {
          SQLITE_RETENTION_DAYS: 'sqlite_retention_days',
          SQLITE_MAX_RECORDS: 'sqlite_max_records',
      },
      DEFAULT_SETTINGS: {},
      getSettings: mockGetSettings,

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/defaults.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      StorageKeys: {
          SQLITE_RETENTION_DAYS: 'sqlite_retention_days',
          SQLITE_MAX_RECORDS: 'sqlite_max_records',
      },
      DEFAULT_SETTINGS: {},
      getSettings: mockGetSettings,

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/encryptionSession.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      StorageKeys: {
          SQLITE_RETENTION_DAYS: 'sqlite_retention_days',
          SQLITE_MAX_RECORDS: 'sqlite_max_records',
      },
      DEFAULT_SETTINGS: {},
      getSettings: mockGetSettings,

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      StorageKeys: {
          SQLITE_RETENTION_DAYS: 'sqlite_retention_days',
          SQLITE_MAX_RECORDS: 'sqlite_max_records',
      },
      DEFAULT_SETTINGS: {},
      getSettings: mockGetSettings,

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/savedUrlRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      StorageKeys: {
          SQLITE_RETENTION_DAYS: 'sqlite_retention_days',
          SQLITE_MAX_RECORDS: 'sqlite_max_records',
      },
      DEFAULT_SETTINGS: {},
      getSettings: mockGetSettings,

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/domainFilterCache.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      StorageKeys: {
          SQLITE_RETENTION_DAYS: 'sqlite_retention_days',
          SQLITE_MAX_RECORDS: 'sqlite_max_records',
      },
      DEFAULT_SETTINGS: {},
      getSettings: mockGetSettings,

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;
vi.mock('../../utils/storage/quota.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

      StorageKeys: {
          SQLITE_RETENTION_DAYS: 'sqlite_retention_days',
          SQLITE_MAX_RECORDS: 'sqlite_max_records',
      },
      DEFAULT_SETTINGS: {},
      getSettings: mockGetSettings,

  } as Record<string, unknown>;
  return {
    ...actual,
    ...Object.fromEntries(
      Object.entries(overrides).map(([k, v]) => [
        k,
        v !== null && typeof v === 'object' && !Array.isArray(v) &&
        actual[k] !== null && typeof actual[k] === 'object' && !Array.isArray(actual[k])
          ? { ...(actual[k] as Record<string, unknown>), ...(v as Record<string, unknown>) }
          : v,
      ]),
    ),
  };
});;

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
    } as unknown as Record<string, unknown>,
    SettingsRepository: class {
      getAll = mockGetSettings;
      get = mockGetSettings;
      getMany = mockGetSettings;
      set = vi.fn();
      setAll = vi.fn();
      clearCache = vi.fn();
    },
  };
});

vi.mock('../../utils/logger.js', () => ({
    logInfo: vi.fn(),
    logError: vi.fn(),
    logWarn: vi.fn(),
    logDebug: vi.fn(),
    ErrorCode: { STORAGE_READ_FAILURE: 'STRG_RD_001', INTERNAL_ERROR: 'INT_001' },
}));

vi.mock('../../utils/errorUtils.js', () => ({
    errorMessage: vi.fn((e: unknown) => String(e)),
}));

// ── import target ─────────────────────────────────────────────────────────────

import { handleDailyPurgeAlarm } from '../dailyPurgeHandler.js';
import { logInfo } from '../../utils/logger.js';

// ── tests ─────────────────────────────────────────────────────────────────────

describe('handleDailyPurgeAlarm', () => {
    const purgeOldRecords = mockPurgeOldRecords;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('skips purge when both settings are null (unlimited)', async () => {
        mockGetSettings.mockResolvedValue({
            sqlite_retention_days: null,
            sqlite_max_records: null,
        });

        await handleDailyPurgeAlarm(purgeOldRecords);

        expect(purgeOldRecords).not.toHaveBeenCalled();
    });

    it('calls purgeOldRecords with retentionDays when only days is set', async () => {
        mockGetSettings.mockResolvedValue({
            sqlite_retention_days: 30,
            sqlite_max_records: null,
        });

        await handleDailyPurgeAlarm(purgeOldRecords);

        expect(purgeOldRecords).toHaveBeenCalledWith(30, undefined);
    });

    it('calls purgeOldRecords with maxRecords when only max is set', async () => {
        mockGetSettings.mockResolvedValue({
            sqlite_retention_days: null,
            sqlite_max_records: 1000,
        });

        await handleDailyPurgeAlarm(purgeOldRecords);

        expect(purgeOldRecords).toHaveBeenCalledWith(undefined, 1000);
    });

    it('calls purgeOldRecords with both params when both are set', async () => {
        mockGetSettings.mockResolvedValue({
            sqlite_retention_days: 90,
            sqlite_max_records: 10000,
        });

        await handleDailyPurgeAlarm(purgeOldRecords);

        expect(purgeOldRecords).toHaveBeenCalledWith(90, 10000);
    });

    it('logs the purged count when purge succeeds', async () => {
        mockGetSettings.mockResolvedValue({
            sqlite_retention_days: 30,
            sqlite_max_records: null,
        });
        mockPurgeOldRecords.mockResolvedValue({ success: true, data: { purged: 5 } });

        await handleDailyPurgeAlarm(purgeOldRecords);

        expect(logInfo).toHaveBeenCalledWith('daily-purge completed', { purged: 5 }, 'dailyPurgeHandler');
    });

    it('logs -1 when purge fails instead of hiding the failure as 0 purged', async () => {
        mockGetSettings.mockResolvedValue({
            sqlite_retention_days: 30,
            sqlite_max_records: null,
        });
        mockPurgeOldRecords.mockResolvedValue({
            success: false,
            error: { kind: 'sqlite_error', message: 'disk I/O error', retriable: false },
        });

        await handleDailyPurgeAlarm(purgeOldRecords);

        expect(logInfo).toHaveBeenCalledWith('daily-purge completed', { purged: -1 }, 'dailyPurgeHandler');
    });
});
