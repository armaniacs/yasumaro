/**
 * daily-purge-alarm.test.ts
 * TDD: handleDailyPurgeAlarm calls purgeOldRecords with user settings,
 * and skips purge when both settings are null (unlimited).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ────────────────────────────────────────────────────────────────────

const mockPurgeOldRecords = vi.fn<() => Promise<{ purged: number } | null>>()
    .mockResolvedValue({ purged: 0 });

const { mockGetSettings } = vi.hoisted(() => ({
    mockGetSettings: vi.fn(),
}));

vi.mock('../../utils/storage.js', () => ({
    StorageKeys: {
        SQLITE_RETENTION_DAYS: 'sqlite_retention_days',
        SQLITE_MAX_RECORDS: 'sqlite_max_records',
    },
    DEFAULT_SETTINGS: {},
    getSettings: mockGetSettings,
}));

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
});
