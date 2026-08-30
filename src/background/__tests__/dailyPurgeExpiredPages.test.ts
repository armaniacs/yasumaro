/**
 * dailyPurgeExpiredPages.test.ts
 * The daily purge alarm must call clearExpiredPages so expired pending
 * pages are deleted, not merely hidden by the read-side filter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDailyPurgeAlarm } from '../dailyPurgeHandler.js';
import { clearSettingsCache } from '../../utils/storage/settingsStore.js';

vi.mock('../../utils/logger.js', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
  ErrorCode: { STORAGE_READ_FAILURE: 'x', STORAGE_WRITE_FAILURE: 'x' },
}));

describe('handleDailyPurgeAlarm × clearExpiredPages', () => {
  beforeEach(() => {
    clearSettingsCache();
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
