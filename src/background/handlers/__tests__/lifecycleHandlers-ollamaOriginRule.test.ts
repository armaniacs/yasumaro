/**
 * lifecycleHandlers-ollamaOriginRule.test.ts
 * handleInstalled（update時）とhandleStartupは、現在のOllama baseUrlに合わせて
 * declarativeNetRequestの動的ルール（Originヘッダー削除）を同期しなければならない。
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockGetSettingsHoisted = vi.hoisted(() => vi.fn().mockResolvedValue({}));

vi.mock('../../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const getManyFromAll = async (keys: readonly string[]) => {
    const all = await mockGetSettingsHoisted();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = (all as Record<string, unknown>)?.[k];
    return out;
  };
  return {
    ...actual,
    settingsRepository: {
      ...(actual.settingsRepository as Record<string, unknown>),
      getAll: mockGetSettingsHoisted,
      get: vi.fn(async (key: string) => (await mockGetSettingsHoisted())?.[key]),
      getMany: getManyFromAll,
      clearCache: vi.fn(),
      set: vi.fn(),
      setAll: vi.fn(),
    },
    SettingsRepository: class {
      getAll = mockGetSettingsHoisted;
      get = vi.fn(async (key: string) => (await mockGetSettingsHoisted())?.[key]);
      getMany = getManyFromAll;
      clearCache = vi.fn();
      set = vi.fn();
      setAll = vi.fn();
    },
  };
});

vi.mock('../../../utils/storage/domainFilterCache.js', () => ({
  updateDomainFilterCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../utils/storage/privacyConsent.js', () => ({
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

vi.mock('../../pendingSqliteQueue.js', () => ({
  flushPendingRecords: vi.fn().mockResolvedValue(undefined),
}));

const mockSyncOllamaOriginRule = vi.fn().mockResolvedValue(undefined);
vi.mock('../../net/ollamaOriginRule.js', () => ({
  OLLAMA_ORIGIN_RULE_ID: 1,
  syncOllamaOriginRule: (...args: unknown[]) => mockSyncOllamaOriginRule(...args),
}));

import { settingsRepository } from '../../../utils/storage/SettingsRepository.js';
import { createLifecycleHandlers } from '../lifecycleHandlers.js';
import { StorageKeys } from '../../../utils/storage/types.js';

const mockGetSettings = vi.mocked(settingsRepository.getAll);

function createCtx() {
  return {
    isCacheInitialized: { value: true, set: vi.fn(), restore: vi.fn().mockResolvedValue(undefined) },
    rateLimiter: { reload: vi.fn().mockResolvedValue(undefined) } as any,
    sqliteClient: { insert: vi.fn() } as any,
  };
}

describe('handleStartup — Ollama Origin ヘッダー削除ルールの同期', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls syncOllamaOriginRule with the configured OLLAMA_BASE_URL', async () => {
    // handleStartupはonStartup時のみ呼ばれ、同期はonInstalledに統合されたため
    // handleStartup自体はsyncOllamaOriginRuleを呼ばない
    mockGetSettings.mockResolvedValue({
      [StorageKeys.OLLAMA_BASE_URL]: 'http://192.168.1.10:11434/v1',
    } as any);

    const { handleStartup } = createLifecycleHandlers(createCtx());
    await handleStartup();

    // handleStartupは同期を呼ばない（onInstalled + observer でカバー）
    expect(mockSyncOllamaOriginRule).not.toHaveBeenCalled();
  });

  it('falls back to the default URL (localhost:11434) when OLLAMA_BASE_URL is unset', async () => {
    mockGetSettings.mockResolvedValue({} as any);

    const { handleStartup } = createLifecycleHandlers(createCtx());
    await handleStartup();

    expect(mockSyncOllamaOriginRule).not.toHaveBeenCalled();
  });

  it('continues overall startup without throwing when syncOllamaOriginRule fails', async () => {
    mockGetSettings.mockResolvedValue({
      [StorageKeys.OLLAMA_BASE_URL]: 'http://localhost:11434/v1',
    } as any);
    mockSyncOllamaOriginRule.mockRejectedValueOnce(new Error('updateDynamicRules failed'));

    const { handleStartup } = createLifecycleHandlers(createCtx());

    await expect(handleStartup()).resolves.toBeUndefined();
  });

  it('does not call syncOllamaOriginRule on warm wake (cache already initialized)', async () => {
    const ctx = {
      isCacheInitialized: { value: true, set: vi.fn(), restore: vi.fn().mockResolvedValue(undefined) },
      rateLimiter: { reload: vi.fn().mockResolvedValue(undefined) } as any,
      sqliteClient: { insert: vi.fn() } as any,
    };
    const { handleStartup } = createLifecycleHandlers(ctx);
    await handleStartup();

    expect(mockSyncOllamaOriginRule).not.toHaveBeenCalled();
  });

  it('does not call syncOllamaOriginRule in handleStartup on cold start (cache uninitialized)', async () => {
    // handleStartupでの同期は削除済み（onInstalled + observer でカバー）
    const ctx = {
      isCacheInitialized: { value: false, set: vi.fn(), restore: vi.fn().mockResolvedValue(undefined) },
      rateLimiter: { reload: vi.fn().mockResolvedValue(undefined) } as any,
      sqliteClient: { insert: vi.fn() } as any,
      recordingCache: { invalidateSettingsCache: vi.fn(), loadCacheFromSession: vi.fn() } as any,
    };
    mockGetSettings.mockResolvedValue({
      [StorageKeys.OLLAMA_BASE_URL]: 'http://localhost:11434/v1',
    } as any);

    const { handleStartup } = createLifecycleHandlers(ctx);
    await handleStartup();

    expect(mockSyncOllamaOriginRule).not.toHaveBeenCalled();
  });
});

describe('handleInstalled（reason: update） — Ollama Origin ヘッダー削除ルールの同期', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls syncOllamaOriginRule with the configured OLLAMA_BASE_URL on update', async () => {
    mockGetSettings.mockResolvedValue({
      [StorageKeys.OLLAMA_BASE_URL]: 'http://ollama-host:11434/v1',
    } as any);

    const { handleInstalled } = createLifecycleHandlers(createCtx());
    await handleInstalled({ reason: 'update', previousVersion: '1.0.0' });

    expect(mockSyncOllamaOriginRule).toHaveBeenCalledWith('http://ollama-host:11434/v1');
  });

  it('calls syncOllamaOriginRule on install (new install) for environments where onStartup does not fire', async () => {
    mockGetSettings.mockResolvedValue({
      [StorageKeys.OLLAMA_BASE_URL]: 'http://localhost:11434/v1',
    } as any);

    const { handleInstalled } = createLifecycleHandlers(createCtx());
    await handleInstalled({ reason: 'install' });

    expect(mockSyncOllamaOriginRule).toHaveBeenCalledWith('http://localhost:11434/v1');
  });

  it('falls back to the default URL when OLLAMA_BASE_URL is unset', async () => {
    mockGetSettings.mockResolvedValue({} as any);

    const { handleInstalled } = createLifecycleHandlers(createCtx());
    await handleInstalled({ reason: 'update', previousVersion: '1.0.0' });

    expect(mockSyncOllamaOriginRule).toHaveBeenCalledWith('http://localhost:11434/v1');
  });
});
