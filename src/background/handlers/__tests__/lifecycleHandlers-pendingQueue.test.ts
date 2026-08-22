/**
 * lifecycleHandlers-pendingQueue.test.ts
 * M14: handleStartup() must flush the pending SQLite queue so records
 * that failed to insert during a prior outage get retried once the
 * Service Worker restarts.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../utils/storage/settingsStore.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSettings: vi.fn().mockResolvedValue({}),
    updateDomainFilterCache: vi.fn().mockResolvedValue(undefined),

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
vi.mock('../../../utils/storage/domainFilterCache.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    getSettings: vi.fn().mockResolvedValue({}),
    updateDomainFilterCache: vi.fn().mockResolvedValue(undefined),

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

vi.mock('../../../popup/privacyConsent.js', () => ({
  migrateLegacyPrivacyConsent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../utils/permissionManager.js', () => ({
  cleanupOldDeniedEntries: vi.fn().mockResolvedValue(undefined),
  cleanupDismissedEntries: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../utils/logger.js', () => ({
  logInfo: vi.fn(),
  logDebug: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  ErrorCode: { UNKNOWN_ERROR: 'UNKNOWN_ERROR', STORAGE_READ_FAILURE: 'STORAGE_READ_FAILURE' },
}));

vi.mock('../../consentBadge.js', () => ({
  updateConsentBadge: vi.fn().mockResolvedValue(undefined),
}));

const mockFlushPendingRecords = vi.fn().mockResolvedValue(undefined);
vi.mock('../../pendingSqliteQueue.js', () => ({
  flushPendingRecords: (...args: unknown[]) => mockFlushPendingRecords(...args),
}));

import { createLifecycleHandlers, restoreRecordingCacheOnWake } from '../lifecycleHandlers.js';
import { RecordingCache } from '../../__tests__/helpers/recordingCache.js';

describe('handleStartup — pending SQLite queue flush (M14)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flushes the pending queue on startup with the shared sqliteClient', async () => {
    const sqliteClient = { insert: vi.fn() } as any;
    const { handleStartup } = createLifecycleHandlers({
      isCacheInitialized: { value: true, restore: vi.fn().mockResolvedValue(undefined) },
      rateLimiter: { reload: vi.fn().mockResolvedValue(undefined) } as any,
      sqliteClient,
    });

    await handleStartup();

    expect(mockFlushPendingRecords).toHaveBeenCalledWith(sqliteClient);
  });

  it('does not throw when flushPendingRecords fails', async () => {
    mockFlushPendingRecords.mockRejectedValueOnce(new Error('flush failed'));
    const sqliteClient = { insert: vi.fn() } as any;
    const { handleStartup } = createLifecycleHandlers({
      isCacheInitialized: { value: true, restore: vi.fn().mockResolvedValue(undefined) },
      rateLimiter: { reload: vi.fn().mockResolvedValue(undefined) } as any,
      sqliteClient,
    });

    await expect(handleStartup()).resolves.toBeUndefined();
  });
});

describe('restoreRecordingCacheOnWake — SW wake-up cache rehydration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restores the recording cache from session storage', async () => {
    const spy = vi.spyOn(RecordingCache, 'loadCacheFromSession');
    await restoreRecordingCacheOnWake(RecordingCache as unknown as import('../../recordingCache.js').RecordingCacheInstance);

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
