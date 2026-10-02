/**
 * sessionAlarmsManager のテスト
 *
 * 検証対象:
 * - updateActivity: chrome.storage.local に last_activity を保存
 * - startTimeoutChecker: chrome.alarms.create でアラーム作成
 * - stopTimeoutChecker: chrome.alarms.clear でアラーム削除
 * - checkTimeout: タイムアウト判定とセッションロック（実行は alarmRegistry 経由）
 * - タイムアウト: SESSION_TIMEOUT_MS 超過時にセッションロック
 * - 初期化: initialize() で startTimeoutChecker を呼ぶ
 */

import { vi } from 'vitest';;
import type { Mock } from 'vitest';

vi.mock('../../../../utils/logger/types.js', () => ({
  logInfo: vi.fn().mockResolvedValue(undefined),
  logWarn: vi.fn().mockResolvedValue(undefined),
  logError: vi.fn().mockResolvedValue(undefined),
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));
vi.mock('../../../../utils/logger/core.js', () => ({
  logInfo: vi.fn().mockResolvedValue(undefined),
  logWarn: vi.fn().mockResolvedValue(undefined),
  logError: vi.fn().mockResolvedValue(undefined),
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));
vi.mock('../../../../utils/logger/api.js', () => ({
  logInfo: vi.fn().mockResolvedValue(undefined),
  logWarn: vi.fn().mockResolvedValue(undefined),
  logError: vi.fn().mockResolvedValue(undefined),
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));
vi.mock('../../../../utils/storage/types.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: { IS_LOCKED: 'IS_LOCKED', MASTER_PASSWORD_ENABLED: 'MASTER_PASSWORD_ENABLED' },

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
vi.mock('../../../../utils/storage/defaults.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: { IS_LOCKED: 'IS_LOCKED', MASTER_PASSWORD_ENABLED: 'MASTER_PASSWORD_ENABLED' },

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
vi.mock('../../../../utils/storage/encryptionSession.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: { IS_LOCKED: 'IS_LOCKED', MASTER_PASSWORD_ENABLED: 'MASTER_PASSWORD_ENABLED' },

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
vi.mock('../../../../utils/storage/savedUrlRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: { IS_LOCKED: 'IS_LOCKED', MASTER_PASSWORD_ENABLED: 'MASTER_PASSWORD_ENABLED' },

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
vi.mock('../../../../utils/storage/domainFilterCache.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: { IS_LOCKED: 'IS_LOCKED', MASTER_PASSWORD_ENABLED: 'MASTER_PASSWORD_ENABLED' },

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
vi.mock('../../../../utils/storage/quota.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const overrides = {

    StorageKeys: { IS_LOCKED: 'IS_LOCKED', MASTER_PASSWORD_ENABLED: 'MASTER_PASSWORD_ENABLED' },

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

// chrome.alarms のモック
let mockAlarmsCreate: Mock;
let mockAlarmsClear: Mock;

function setupChromeAlarms() {
  mockAlarmsCreate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined as any);
  mockAlarmsClear = vi.fn<() => Promise<boolean>>().mockResolvedValue(true as any);

  (global as any).chrome = (global as any).chrome || {};
  (global as any).chrome.alarms = {
    create: mockAlarmsCreate,
    clear: mockAlarmsClear,
    onAlarm: { addListener: vi.fn() },
  };
}

// ストレージデータ
let storageData: Record<string, any>;

function setupStorageMocks() {
  storageData = {};
  chrome.storage.local.get = vi.fn((keys: any) => {
    const result: Record<string, any> = {};
    if (typeof keys === 'string') {
      if (keys in storageData) result[keys] = storageData[keys];
    } else if (Array.isArray(keys)) {
      for (const k of keys) {
        if (k in storageData) result[k] = storageData[k];
      }
    } else if (typeof keys === 'object' && keys !== null) {
      for (const k of Object.keys(keys)) {
        result[k] = k in storageData ? storageData[k] : keys[k];
      }
    }
    return Promise.resolve(result);
  }) as any;
  chrome.storage.local.set = vi.fn((items: Record<string, any>) => {
    Object.assign(storageData, items);
    return Promise.resolve();
  }) as any;
}

// Helper: load a fresh module instance (per-test singleton state)
async function loadFreshModule() {
  vi.resetModules();
  setupChromeAlarms();
  setupStorageMocks();
  const mod = await import('../../../sessionAlarmsManager.js');
  return mod;
}

/**
 * checkTimeout is not re-exported by the compat shim, and alarmRegistry is now
 * the only caller of it in production, so drive it through the service class
 * with the same injected-in-terms-of-chrome mocks.
 */
async function loadFreshService() {
  vi.resetModules();
  setupChromeAlarms();
  setupStorageMocks();
  const { SessionAlarmService } = await import('../../../SessionAlarmService.js');
  return new SessionAlarmService();
}

describe('sessionAlarmsManager', () => {
  describe('updateActivity', () => {
    it('saves last_activity to chrome.storage.local', async () => {
      const { updateActivity } = await loadFreshModule();
      await updateActivity();

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ session_last_activity: expect.any(Number) })
      );
    });

    it('does not throw even when chrome.storage.local.set fails', async () => {
      const { updateActivity } = await loadFreshModule();
      (chrome.storage.local.set as Mock).mockRejectedValueOnce(new Error('Storage error'));

      await expect(updateActivity()).resolves.not.toThrow();
    });
  });

  describe('startTimeoutChecker', () => {
    it('clears the existing alarm before creating a new alarm', async () => {
      const { startTimeoutChecker } = await loadFreshModule();
      await startTimeoutChecker();

      expect(mockAlarmsClear).toHaveBeenCalledWith('check_session_timeout');
      expect(mockAlarmsCreate).toHaveBeenCalledWith(
        'check_session_timeout',
        expect.objectContaining({ periodInMinutes: expect.any(Number) })
      );
    });

    it('does not throw even when chrome.alarms fails', async () => {
      const { startTimeoutChecker } = await loadFreshModule();
      mockAlarmsCreate.mockRejectedValueOnce(new Error('Alarm error'));

      await expect(startTimeoutChecker()).resolves.not.toThrow();
    });

    it('logs an INFO message', async () => {
      const { startTimeoutChecker } = await loadFreshModule();
      await startTimeoutChecker();

      const logInfo = (await import('../../../../utils/logger/api.js')).logInfo;
      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('started'),
        expect.any(Object),
        expect.any(String)
      );
    });

    it('never registers an alarm listener of its own', async () => {
      const { startTimeoutChecker } = await loadFreshModule();
      await startTimeoutChecker();
      await startTimeoutChecker();

      // alarmRegistry owns the check_session_timeout firing; a listener here
      // would run checkTimeout twice per firing.
      expect(chrome.alarms.onAlarm.addListener).not.toHaveBeenCalled();
      expect(mockAlarmsClear).toHaveBeenCalledTimes(2);
      expect(mockAlarmsCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('stopTimeoutChecker', () => {
    it('calls chrome.alarms.clear', async () => {
      const { stopTimeoutChecker } = await loadFreshModule();
      await stopTimeoutChecker();

      expect(mockAlarmsClear).toHaveBeenCalledWith('check_session_timeout');
    });

    it('does not throw even when chrome.alarms.clear fails', async () => {
      const { stopTimeoutChecker } = await loadFreshModule();
      mockAlarmsClear.mockRejectedValueOnce(new Error('Clear error'));

      await expect(stopTimeoutChecker()).resolves.not.toThrow();
    });

    it('logs a WARN on error', async () => {
      const { stopTimeoutChecker } = await loadFreshModule();
      mockAlarmsClear.mockRejectedValueOnce(new Error('Clear error'));

      await stopTimeoutChecker();

      const logWarn = (await import('../../../../utils/logger/api.js')).logWarn;
      expect(logWarn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to stop'),
        expect.objectContaining({ error: expect.stringContaining('Clear error') }),
        undefined,
        expect.any(String)
      );
    });
  });

  describe('initialize', () => {
    it('calls startTimeoutChecker', async () => {
      const { initialize } = await loadFreshModule();
      await initialize();

      expect(mockAlarmsCreate).toHaveBeenCalled();
    });

    it('does not throw even when startTimeoutChecker fails', async () => {
      const { initialize } = await loadFreshModule();
      mockAlarmsCreate.mockRejectedValueOnce(new Error('Create error'));

      await expect(initialize()).resolves.not.toThrow();
    });

    it('logs an ERROR on initialize failure', async () => {
      const { initialize } = await loadFreshModule();
      mockAlarmsCreate.mockRejectedValueOnce(new Error('Init alarm error'));

      await initialize();

      // エラーは startTimeoutChecker 内でキャッチされる
      const logError = (await import('../../../../utils/logger/api.js')).logError;
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('start session timeout checker'),
        expect.objectContaining({ error: expect.stringContaining('Init alarm error') }),
        expect.any(String),
        expect.any(String)
      );
    });
  });

  describe('checkTimeout', () => {
    it('locks on the check_session_timeout check only when timed out with the master password enabled', async () => {
      const service = await loadFreshService();

      storageData['MASTER_PASSWORD_ENABLED'] = true;
      storageData['session_last_activity'] = Date.now() - 31 * 60 * 1000;
      await service.checkTimeout();

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ IS_LOCKED: true })
      );
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SESSION_LOCK_REQUEST' })
      );
    });

    it('logs an INFO on timeout', async () => {
      const service = await loadFreshService();

      storageData['MASTER_PASSWORD_ENABLED'] = true;
      storageData['session_last_activity'] = Date.now() - 31 * 60 * 1000;
      await service.checkTimeout();

      const logInfo = (await import('../../../../utils/logger/api.js')).logInfo;
      await vi.waitFor(() => {
        expect(logInfo).toHaveBeenCalledWith(
          expect.stringContaining('locked'),
          expect.objectContaining({ timeoutMinutes: expect.any(Number) }),
          expect.any(String)
        );
      });
    });

    it('does not throw on lockSession storage errors', async () => {
      const service = await loadFreshService();

      storageData['MASTER_PASSWORD_ENABLED'] = true;
      storageData['session_last_activity'] = Date.now() - 31 * 60 * 1000;
      (chrome.storage.local.set as Mock).mockRejectedValueOnce(new Error('Lock storage error'));

      await service.checkTimeout();

      const logError = (await import('../../../../utils/logger/api.js')).logError;
      await vi.waitFor(() => {
        expect(logError).toHaveBeenCalledWith(
          expect.stringContaining('lock'),
          expect.objectContaining({ error: expect.stringContaining('Lock storage error') }),
          expect.any(String),
          expect.any(String)
        );
      });
    });

    it('does not lock on timeout when the master password is unset', async () => {
      const service = await loadFreshService();

      // MASTER_PASSWORD_ENABLED を明示的に設定しない（未設定ユーザーを再現）
      storageData['session_last_activity'] = Date.now() - 31 * 60 * 1000;
      await service.checkTimeout();

      const setCalls = (chrome.storage.local.set as Mock).mock.calls.filter(
        (call: unknown[]) => (call[0] as any)?.IS_LOCKED !== undefined
      );
      expect(setCalls.length).toBe(0);
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SESSION_LOCK_REQUEST' })
      );
    });

    it('does not lock when no activity is recorded', async () => {
      const service = await loadFreshService();

      await service.checkTimeout();

      const setCalls = (chrome.storage.local.set as Mock).mock.calls.filter(
        (call: unknown[]) => (call[0] as any)?.IS_LOCKED !== undefined
      );
      expect(setCalls.length).toBe(0);
    });

    it('does not lock before the timeout elapses', async () => {
      const service = await loadFreshService();

      storageData['session_last_activity'] = Date.now() - 10 * 60 * 1000;
      await service.checkTimeout();

      const setCalls = (chrome.storage.local.set as Mock).mock.calls.filter(
        (call: unknown[]) => (call[0] as any)?.IS_LOCKED !== undefined
      );
      expect(setCalls.length).toBe(0);
    });

    it('does not throw on checkTimeout storage errors', async () => {
      const service = await loadFreshService();

      (chrome.storage.local.get as Mock).mockRejectedValueOnce(new Error('Get error'));

      await service.checkTimeout();

      const logError = (await import('../../../../utils/logger/api.js')).logError;
      await vi.waitFor(() => {
        expect(logError).toHaveBeenCalledWith(
          expect.stringContaining('check session timeout'),
          expect.objectContaining({ error: expect.stringContaining('Get error') }),
          expect.any(String),
          expect.any(String)
        );
      });
    });
  });
});
