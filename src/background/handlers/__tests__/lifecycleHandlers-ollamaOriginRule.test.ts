/**
 * lifecycleHandlers-ollamaOriginRule.test.ts
 * handleInstalled（update時）とhandleStartupは、現在のOllama baseUrlに合わせて
 * declarativeNetRequestの動的ルール（Originヘッダー削除）を同期しなければならない。
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../utils/storage/settingsStore.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getSettings: vi.fn().mockResolvedValue({}),
  };
});

vi.mock('../../../utils/storage/domainFilterCache.js', () => ({
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

vi.mock('../../pendingSqliteQueue.js', () => ({
  flushPendingRecords: vi.fn().mockResolvedValue(undefined),
}));

const mockSyncOllamaOriginRule = vi.fn().mockResolvedValue(undefined);
vi.mock('../../net/ollamaOriginRule.js', () => ({
  OLLAMA_ORIGIN_RULE_ID: 1,
  syncOllamaOriginRule: (...args: unknown[]) => mockSyncOllamaOriginRule(...args),
}));

import { getSettings } from '../../../utils/storage/settingsStore.js';
import { createLifecycleHandlers } from '../lifecycleHandlers.js';
import { StorageKeys } from '../../../utils/storage/types.js';

const mockGetSettings = vi.mocked(getSettings);

function createCtx() {
  return {
    isCacheInitialized: { value: true, restore: vi.fn().mockResolvedValue(undefined) },
    rateLimiter: { reload: vi.fn().mockResolvedValue(undefined) } as any,
    sqliteClient: { insert: vi.fn() } as any,
  };
}

describe('handleStartup — Ollama Origin ヘッダー削除ルールの同期', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('設定されたOLLAMA_BASE_URLでsyncOllamaOriginRuleを呼ぶ', async () => {
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

  it('OLLAMA_BASE_URL未設定時はデフォルトURL（localhost:11434）でフォールバックする', async () => {
    mockGetSettings.mockResolvedValue({} as any);

    const { handleStartup } = createLifecycleHandlers(createCtx());
    await handleStartup();

    expect(mockSyncOllamaOriginRule).not.toHaveBeenCalled();
  });

  it('syncOllamaOriginRuleが失敗してもstartup処理全体は継続する（例外を投げない）', async () => {
    mockGetSettings.mockResolvedValue({
      [StorageKeys.OLLAMA_BASE_URL]: 'http://localhost:11434/v1',
    } as any);
    mockSyncOllamaOriginRule.mockRejectedValueOnce(new Error('updateDynamicRules failed'));

    const { handleStartup } = createLifecycleHandlers(createCtx());

    await expect(handleStartup()).resolves.toBeUndefined();
  });

  it('warm wake（キャッシュ初期化済み）ではsyncOllamaOriginRuleが呼ばれない', async () => {
    const ctx = {
      isCacheInitialized: { value: true, restore: vi.fn().mockResolvedValue(undefined) },
      rateLimiter: { reload: vi.fn().mockResolvedValue(undefined) } as any,
      sqliteClient: { insert: vi.fn() } as any,
    };
    const { handleStartup } = createLifecycleHandlers(ctx);
    await handleStartup();

    expect(mockSyncOllamaOriginRule).not.toHaveBeenCalled();
  });

  it('cold start（キャッシュ未初期化）でもhandleStartupはsyncOllamaOriginRuleを呼ばない', async () => {
    // handleStartupでの同期は削除済み（onInstalled + observer でカバー）
    const ctx = {
      isCacheInitialized: { value: false, restore: vi.fn().mockResolvedValue(undefined) },
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

  it('update時に設定されたOLLAMA_BASE_URLでsyncOllamaOriginRuleを呼ぶ', async () => {
    mockGetSettings.mockResolvedValue({
      [StorageKeys.OLLAMA_BASE_URL]: 'http://ollama-host:11434/v1',
    } as any);

    const { handleInstalled } = createLifecycleHandlers(createCtx());
    await handleInstalled({ reason: 'update', previousVersion: '1.0.0' });

    expect(mockSyncOllamaOriginRule).toHaveBeenCalledWith('http://ollama-host:11434/v1');
  });

  it('install時（新規インストール）もsyncOllamaOriginRuleを呼ぶ（onStartupが発火しない環境向け）', async () => {
    mockGetSettings.mockResolvedValue({
      [StorageKeys.OLLAMA_BASE_URL]: 'http://localhost:11434/v1',
    } as any);

    const { handleInstalled } = createLifecycleHandlers(createCtx());
    await handleInstalled({ reason: 'install' });

    expect(mockSyncOllamaOriginRule).toHaveBeenCalledWith('http://localhost:11434/v1');
  });

  it('OLLAMA_BASE_URL未設定時はデフォルトURLでフォールバックする', async () => {
    mockGetSettings.mockResolvedValue({} as any);

    const { handleInstalled } = createLifecycleHandlers(createCtx());
    await handleInstalled({ reason: 'update', previousVersion: '1.0.0' });

    expect(mockSyncOllamaOriginRule).toHaveBeenCalledWith('http://localhost:11434/v1');
  });
});
