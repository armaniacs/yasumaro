import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDeferredMigrationRunner } from '../deferredMigrations.js';

const mockMigrateToSingleSettingsObject = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const mockMigrateLoopbackProviderOriginConfirmations = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const mockMigrateLegacyPendingPagesKey = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockMigrateFromLocalStorage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockRun = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockNeedsOpfsRecoveryMigration = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const mockMigrateOpfsRecovery = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true, migrated: 1 }));
const mockLogInfo = vi.hoisted(() => vi.fn());
const mockLogError = vi.hoisted(() => vi.fn());

vi.mock('../../utils/storage/settingsMigration.js', () => ({
  migrateToSingleSettingsObject: mockMigrateToSingleSettingsObject,
  migrateLoopbackProviderOriginConfirmations: mockMigrateLoopbackProviderOriginConfirmations,
}));

vi.mock('../../utils/pendingStorage.js', () => ({
  migrateLegacyPendingPagesKey: mockMigrateLegacyPendingPagesKey,
}));

vi.mock('../../utils/logger/types.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: mockLogInfo,
    logError: mockLogError,
    ErrorCode: { STORAGE_MIGRATION_FAILURE: 'STORAGE_MIGRATION_FAILURE', INTERNAL_ERROR: 'INTERNAL_ERROR' },
  }),
);
vi.mock('../../utils/logger/core.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: mockLogInfo,
    logError: mockLogError,
    ErrorCode: { STORAGE_MIGRATION_FAILURE: 'STORAGE_MIGRATION_FAILURE', INTERNAL_ERROR: 'INTERNAL_ERROR' },
  }),
);
vi.mock('../../utils/logger/api.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: mockLogInfo,
    logError: mockLogError,
    ErrorCode: { STORAGE_MIGRATION_FAILURE: 'STORAGE_MIGRATION_FAILURE', INTERNAL_ERROR: 'INTERNAL_ERROR' },
  }),
);

vi.mock('../sessionStore.js', () => ({
  SessionStore: {
    migrateFromLocalStorage: mockMigrateFromLocalStorage,
  },
}));

vi.mock('../migrationService.js', () => ({
  MigrationService: Object.assign(
    vi.fn(function MigrationService(this: { run: unknown; needsOpfsRecoveryMigration: unknown; migrateOpfsRecovery: unknown }) {
      this.run = mockRun;
      this.needsOpfsRecoveryMigration = mockNeedsOpfsRecoveryMigration;
      this.migrateOpfsRecovery = mockMigrateOpfsRecovery;
    }),
    { prototype: {} }
  ),
}));

describe('createDeferredMigrationRunner retry', () => {
  describe('transient failure', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockMigrateToSingleSettingsObject.mockResolvedValue(false);
      mockMigrateLoopbackProviderOriginConfirmations.mockResolvedValue(false);
      mockNeedsOpfsRecoveryMigration.mockResolvedValue(false);
    });

    it('retries the migration after a transient failure within the same runner', async () => {
      mockRun.mockRejectedValueOnce(new Error('transient'));
      const runner = createDeferredMigrationRunner({} as never);
      await runner();
      expect(mockRun).toHaveBeenCalledTimes(1);
      expect(mockLogError).toHaveBeenCalledWith(
        'Deferred startup migration failed',
        { error: 'transient' },
        'STORAGE_MIGRATION_FAILURE',
        'service-worker'
      );

      mockRun.mockResolvedValueOnce(undefined);
      await runner();
      expect(mockRun).toHaveBeenCalledTimes(2);
    });

    it('stays idempotent after a successful run', async () => {
      const runner = createDeferredMigrationRunner({} as never);
      await runner();
      await runner();
      expect(mockRun).toHaveBeenCalledTimes(1);
    });
  });
});
