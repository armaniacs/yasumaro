/**
 * lifecycleHandlers-pendingQueue.test.ts
 * M14: handleStartup() must flush the pending SQLite queue so records
 * that failed to insert during a prior outage get retried once the
 * Service Worker restarts.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../recordingLogic.js', () => ({
  RecordingLogic: {
    invalidateSettingsCache: vi.fn(),
    loadCacheFromSession: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../utils/storage.js', () => ({
  getSettings: vi.fn().mockResolvedValue({}),
  updateDomainFilterCache: vi.fn().mockResolvedValue(undefined),
}));

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

import { createLifecycleHandlers } from '../lifecycleHandlers.js';

describe('handleStartup — pending SQLite queue flush (M14)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flushes the pending queue on startup with the shared sqliteClient', async () => {
    const sqliteClient = { insert: vi.fn() } as any;
    const { handleStartup } = createLifecycleHandlers({
      isCacheInitialized: { value: true },
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
      isCacheInitialized: { value: true },
      rateLimiter: { reload: vi.fn().mockResolvedValue(undefined) } as any,
      sqliteClient,
    });

    await expect(handleStartup()).resolves.toBeUndefined();
  });
});
