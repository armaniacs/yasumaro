/**
 * dailyPurgeExpiredPages.test.ts
 * The daily purge alarm must call clearExpiredPages so expired pending
 * pages are deleted, not merely hidden by the read-side filter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDailyPurgeAlarm } from '../dailyPurgeHandler.js';
import { settingsRepository } from '../../utils/storage/SettingsRepository.js';

vi.mock('../../utils/logger/types.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: 'fn',
    logError: 'fn',
    logWarn: 'fn',
    logDebug: 'fn',
    ErrorCode: { STORAGE_READ_FAILURE: 'x', STORAGE_WRITE_FAILURE: 'x' },
  }),
);
vi.mock('../../utils/logger/core.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: 'fn',
    logError: 'fn',
    logWarn: 'fn',
    logDebug: 'fn',
    ErrorCode: { STORAGE_READ_FAILURE: 'x', STORAGE_WRITE_FAILURE: 'x' },
  }),
);
vi.mock('../../utils/logger/api.js', async () =>
  (await import('../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: 'fn',
    logError: 'fn',
    logWarn: 'fn',
    logDebug: 'fn',
    ErrorCode: { STORAGE_READ_FAILURE: 'x', STORAGE_WRITE_FAILURE: 'x' },
  }),
);

describe('handleDailyPurgeAlarm × clearExpiredPages', () => {
  beforeEach(() => {
    settingsRepository.clearCache();
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => {}),
          remove: vi.fn(async () => {}),
        },
      },
    } as unknown as typeof chrome;
  });

  it('invokes the injected clearExpiredPages exactly once', async () => {
    const purgeFn = vi.fn().mockResolvedValue({ success: true, data: { purged: 0 } });
    const clearExpiredPages = vi.fn().mockResolvedValue(undefined);

    await handleDailyPurgeAlarm(purgeFn, undefined, clearExpiredPages);

    expect(clearExpiredPages).toHaveBeenCalledTimes(1);
  });
});
