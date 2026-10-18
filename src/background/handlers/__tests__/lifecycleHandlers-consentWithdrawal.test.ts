/**
 * lifecycleHandlers-consentWithdrawal.test.ts
 *
 * 拡張機能の更新（handleInstalled / reason:'update'）で走るレガシー同意
 * マイグレーションが、撤回済みの同意を再付与しないことを固定する（GDPR Art.7）。
 *
 * この経路は privacyConsent.ts をモックせず実物を通す。ユニットテストは
 * 「migrateLegacyPrivacyConsent が再付与しない」ことを、ここは「更新時に実際に
 * その関数が呼ばれ、storage が書き換わらない」ことを固定する（合成の検証）。
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

vi.mock('../../../utils/permissionManager.js', () => ({
  cleanupOldDeniedEntries: vi.fn().mockResolvedValue(undefined),
  cleanupDismissedEntries: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../utils/logger/types.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: 'fn',
    logDebug: 'fn',
    logWarn: 'fn',
    logError: 'fn',
    ErrorCode: { UNKNOWN_ERROR: 'UNKNOWN_ERROR', STORAGE_READ_FAILURE: 'STORAGE_READ_FAILURE' },
  }),
);
vi.mock('../../../utils/logger/core.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: 'fn',
    logDebug: 'fn',
    logWarn: 'fn',
    logError: 'fn',
    ErrorCode: { UNKNOWN_ERROR: 'UNKNOWN_ERROR', STORAGE_READ_FAILURE: 'STORAGE_READ_FAILURE' },
  }),
);
vi.mock('../../../utils/logger/api.js', async () =>
  (await import('../../../../testDir/mocks/logger.js')).createLoggerModuleMock({
    logInfo: 'fn',
    logDebug: 'fn',
    logWarn: 'fn',
    logError: 'fn',
    ErrorCode: { UNKNOWN_ERROR: 'UNKNOWN_ERROR', STORAGE_READ_FAILURE: 'STORAGE_READ_FAILURE' },
  }),
);

vi.mock('../../consentBadge.js', () => ({
  updateConsentBadge: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../pendingSqliteQueue.js', () => ({
  flushPendingRecords: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../net/ollamaOriginRule.js', () => ({
  OLLAMA_ORIGIN_RULE_ID: 1,
  syncOllamaOriginRule: vi.fn().mockResolvedValue(undefined),
}));

// chrome.storage mock — privacyConsent の署名鍵（HMAC wrapping key）は session に
// 置かれるため、local と session の両方を用意する。
const storageMock: Record<string, unknown> = {};
const sessionMock: Record<string, unknown> = {};

(global as any).chrome = {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) => {
        const ks = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(ks.map(k => [k, storageMock[k]]));
      }),
      set: vi.fn(async (data: Record<string, unknown>) => {
        Object.assign(storageMock, data);
      }),
    },
    session: {
      get: vi.fn(async (keys: string | string[]) => {
        const ks = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(ks.map(k => [k, sessionMock[k]]));
      }),
      set: vi.fn(async (data: Record<string, unknown>) => {
        Object.assign(sessionMock, data);
      }),
    },
  },
};

import { createLifecycleHandlers } from '../lifecycleHandlers.js';
import { StorageKeys } from '../../../utils/storage/types.js';
import {
  getPrivacyConsent,
  getConsentWithdrawalHistory,
  savePrivacyConsent,
  withdrawPrivacyConsent,
} from '../../../utils/storage/privacyConsent.js';

function createCtx() {
  return {
    isCacheInitialized: { value: true, set: vi.fn(), restore: vi.fn().mockResolvedValue(undefined) },
    rateLimiter: { reload: vi.fn().mockResolvedValue(undefined) } as any,
    sqliteClient: { insert: vi.fn() } as any,
  };
}

describe('handleInstalled（reason: update） — 撤回済み同意の保全', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettingsHoisted.mockResolvedValue({});
    Object.keys(storageMock).forEach(k => delete storageMock[k]);
    Object.keys(sessionMock).forEach(k => delete sessionMock[k]);
  });

  it('keeps the withdrawal record when the master password evidence key is left behind', async () => {
    await savePrivacyConsent();
    await withdrawPrivacyConsent();
    const withdrawnRecord = storageMock[StorageKeys.PRIVACY_CONSENT];
    storageMock[StorageKeys.MASTER_PASSWORD_ENABLED] = true;

    const { handleInstalled } = createLifecycleHandlers(createCtx());
    await handleInstalled({ reason: 'update', previousVersion: '6.9.48' });

    expect(await getPrivacyConsent()).toMatchObject({ hasConsented: false });
    await expect(getConsentWithdrawalHistory()).resolves.not.toBeNull();
    // 書き換えが起きていないこと（参照が変われば再付与された）
    expect(storageMock[StorageKeys.PRIVACY_CONSENT]).toBe(withdrawnRecord);
  });

  it('still migrates a never-consented profile that shows legacy usage evidence', async () => {
    storageMock[StorageKeys.PRIVACY_MODE] = 'mask';

    const { handleInstalled } = createLifecycleHandlers(createCtx());
    await handleInstalled({ reason: 'update', previousVersion: '6.9.48' });

    expect(await getPrivacyConsent()).toMatchObject({ hasConsented: true });
  });
});
