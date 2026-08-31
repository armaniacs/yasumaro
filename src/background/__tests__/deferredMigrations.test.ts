import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDeferredMigrationRunner } from '../deferredMigrations.js';

const mockMigrateToSingleSettingsObject = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const mockMigrateLegacyPendingPagesKey = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockMigrateFromLocalStorage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockRun = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockNeedsOpfsRecoveryMigration = vi.hoisted(() => vi.fn().mockResolvedValue(false));
const mockMigrateOpfsRecovery = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true, migrated: 1 }));
const mockLogInfo = vi.hoisted(() => vi.fn());
const mockLogError = vi.hoisted(() => vi.fn());

vi.mock('../../utils/storage/settingsMigration.js', () => ({
  migrateToSingleSettingsObject: mockMigrateToSingleSettingsObject,
}));
// keep barrel mock for compatibility
vi.mock('../../utils/storage.js', () => ({
  migrateToSingleSettingsObject: mockMigrateToSingleSettingsObject,
}));

vi.mock('../../utils/pendingStorage.js', () => ({
  migrateLegacyPendingPagesKey: mockMigrateLegacyPendingPagesKey,
}));

vi.mock('../../utils/logger.js', () => ({
  logInfo: mockLogInfo,
  logError: mockLogError,
  ErrorCode: {
    STORAGE_MIGRATION_FAILURE: 'STORAGE_MIGRATION_FAILURE',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
  },
}));

vi.mock('../sessionStore.js', () => ({
  SessionStore: {
    migrateFromLocalStorage: mockMigrateFromLocalStorage,
  },
}));

vi.mock('../migrationService.js', () => ({
  MigrationService: Object.assign(
    vi.fn(function MigrationService(this: any) {
      this.run = mockRun;
      this.needsOpfsRecoveryMigration = mockNeedsOpfsRecoveryMigration;
      this.migrateOpfsRecovery = mockMigrateOpfsRecovery;
    }),
    { prototype: {} }
  ),
}));

describe('createDeferredMigrationRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMigrateToSingleSettingsObject.mockResolvedValue(false);
    mockNeedsOpfsRecoveryMigration.mockResolvedValue(false);
  });

  it('runs all migrations once', async () => {
    const sqliteClient = {} as any;
    const runner = createDeferredMigrationRunner(sqliteClient);
    await runner();
    expect(mockMigrateToSingleSettingsObject).toHaveBeenCalledTimes(1);
    expect(mockMigrateLegacyPendingPagesKey).toHaveBeenCalledTimes(1);
    expect(mockMigrateFromLocalStorage).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — does not run twice', async () => {
    const sqliteClient = {} as any;
    const runner = createDeferredMigrationRunner(sqliteClient);
    await runner();
    await runner();
    expect(mockMigrateToSingleSettingsObject).toHaveBeenCalledTimes(1);
  });

  it('logs when settings migration returns true', async () => {
    mockMigrateToSingleSettingsObject.mockResolvedValue(true);
    const runner = createDeferredMigrationRunner({} as any);
    await runner();
    expect(mockLogInfo).toHaveBeenCalledWith(
      'Settings migrated to single object',
      { migrated: true },
      'service-worker'
    );
  });

  it('logs error when settings migration throws', async () => {
    mockMigrateToSingleSettingsObject.mockRejectedValue(new Error('fail'));
    const runner = createDeferredMigrationRunner({} as any);
    await runner();
    expect(mockLogError).toHaveBeenCalledWith(
      'Failed to migrate settings',
      { error: 'fail' },
      'STORAGE_MIGRATION_FAILURE',
      'service-worker'
    );
  });

  it('logs error when settings migration throws a non-Error', async () => {
    mockMigrateToSingleSettingsObject.mockRejectedValue('string error');
    const runner = createDeferredMigrationRunner({} as any);
    await runner();
    expect(mockLogError).toHaveBeenCalledWith(
      'Failed to migrate settings',
      { error: 'string error' },
      'STORAGE_MIGRATION_FAILURE',
      'service-worker'
    );
  });

  it('triggers OPFS recovery when needed and succeeds', async () => {
    mockNeedsOpfsRecoveryMigration.mockResolvedValue(true);
    const runner = createDeferredMigrationRunner({} as any);
    await runner();
    expect(mockMigrateOpfsRecovery).toHaveBeenCalledTimes(1);
    expect(mockLogInfo).toHaveBeenCalledWith(
      'OPFS recovery completed',
      { migrated: 1 },
      'service-worker'
    );
  });

  it('triggers OPFS recovery when needed and fails', async () => {
    mockNeedsOpfsRecoveryMigration.mockResolvedValue(true);
    mockMigrateOpfsRecovery.mockResolvedValue({ success: false, error: 'disk full' });
    const runner = createDeferredMigrationRunner({} as any);
    await runner();
    expect(mockLogError).toHaveBeenCalledWith(
      'OPFS recovery failed',
      { error: 'disk full' },
      'STORAGE_MIGRATION_FAILURE',
      'service-worker'
    );
  });

  it('logs error when OPFS recovery returns unknown error', async () => {
    mockNeedsOpfsRecoveryMigration.mockResolvedValue(true);
    mockMigrateOpfsRecovery.mockResolvedValue({ success: false });
    const runner = createDeferredMigrationRunner({} as any);
    await runner();
    expect(mockLogError).toHaveBeenCalledWith(
      'OPFS recovery failed',
      { error: 'Unknown error' },
      'STORAGE_MIGRATION_FAILURE',
      'service-worker'
    );
  });

  it('logs error when main migration body throws', async () => {
    mockRun.mockRejectedValue(new Error('runtime fail'));
    const runner = createDeferredMigrationRunner({} as any);
    await runner();
    expect(mockLogError).toHaveBeenCalledWith(
      'Deferred startup migration failed',
      { error: 'Error: runtime fail' },
      'STORAGE_MIGRATION_FAILURE',
      'service-worker'
    );
  });

  it('logs error when SessionStore migration rejects', async () => {
    mockMigrateFromLocalStorage.mockRejectedValue(new Error('session fail'));
    const runner = createDeferredMigrationRunner({} as any);
    await runner();
    expect(mockLogError).toHaveBeenCalledWith(
      'SessionStore migration failed',
      { error: 'Error: session fail' },
      'STORAGE_MIGRATION_FAILURE',
      'service-worker'
    );
  });
});
