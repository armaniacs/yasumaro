/**
 * sessionAlarmsManager のテスト
 *
 * 検証対象:
 * - updateActivity: chrome.storage.local に last_activity を保存
 * - startTimeoutChecker: chrome.alarms.create でアラーム作成 + リスナー設定
 * - stopTimeoutChecker: chrome.alarms.clear でアラーム削除
 * - アラームリスナー: check_session_timeout アラームでタイムアウトチェック実行
 * - タイムアウト: SESSION_TIMEOUT_MS 超過時にセッションロック
 * - 初期化: initialize() で startTimeoutChecker を呼ぶ
 */

import { vi } from 'vitest';;

vi.mock('../../../../utils/logger.js', () => ({
  logInfo: vi.fn().mockResolvedValue(undefined),
  logWarn: vi.fn().mockResolvedValue(undefined),
  logError: vi.fn().mockResolvedValue(undefined),
  ErrorCode: { INTERNAL_ERROR: 'INT_001', UNKNOWN_ERROR: 'UNKN_001' },
}));
vi.mock('../../../../utils/storage.js', () => ({
  StorageKeys: { IS_LOCKED: 'IS_LOCKED' },
}));

// chrome.alarms のモック
let mockAlarmsCreate: vi.Mock;
let mockAlarmsClear: vi.Mock;
let capturedListener: ((alarm: chrome.alarms.Alarm) => void) | null = null;

function setupChromeAlarms() {
  mockAlarmsCreate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined as any);
  mockAlarmsClear = vi.fn<() => Promise<boolean>>().mockResolvedValue(true as any);
  capturedListener = null;

  (global as any).chrome = (global as any).chrome || {};
  (global as any).chrome.alarms = {
    create: mockAlarmsCreate,
    clear: mockAlarmsClear,
    onAlarm: {
      addListener: vi.fn((listener: (alarm: chrome.alarms.Alarm) => void) => {
        capturedListener = listener;
      }),
    },
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

// Helper: load a fresh module instance (resets alarmListenerSetUp)
async function loadFreshModule() {
  vi.resetModules();
  setupChromeAlarms();
  setupStorageMocks();
  const mod = await import('../../../../background/sessionAlarmsManager.js');
  return mod;
}

describe('sessionAlarmsManager', () => {
  describe('updateActivity', () => {
    it('chrome.storage.local に last_activity を保存する', async () => {
      const { updateActivity } = await loadFreshModule();
      await updateActivity();

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ session_last_activity: expect.any(Number) })
      );
    });

    it('chrome.storage.local.set が失敗しても throw しない', async () => {
      const { updateActivity } = await loadFreshModule();
      (chrome.storage.local.set as vi.Mock).mockRejectedValueOnce(new Error('Storage error'));

      await expect(updateActivity()).resolves.not.toThrow();
    });
  });

  describe('startTimeoutChecker', () => {
    it('既存アラームをクリアしてから新規アラームを作成する', async () => {
      const { startTimeoutChecker } = await loadFreshModule();
      await startTimeoutChecker();

      expect(mockAlarmsClear).toHaveBeenCalledWith('check_session_timeout');
      expect(mockAlarmsCreate).toHaveBeenCalledWith(
        'check_session_timeout',
        expect.objectContaining({ periodInMinutes: expect.any(Number) })
      );
    });

    it('chrome.alarms が失敗しても throw しない', async () => {
      const { startTimeoutChecker } = await loadFreshModule();
      mockAlarmsCreate.mockRejectedValueOnce(new Error('Alarm error'));

      await expect(startTimeoutChecker()).resolves.not.toThrow();
    });

    it('INFO ログが出力される', async () => {
      const { startTimeoutChecker } = await loadFreshModule();
      await startTimeoutChecker();

      const logInfo = (await import('../../../../utils/logger.js')).logInfo;
      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('started'),
        expect.any(Object),
        expect.any(String)
      );
    });

    it('アラームリスナーが登録される', async () => {
      const { startTimeoutChecker } = await loadFreshModule();
      await startTimeoutChecker();

      expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalled();
      expect(capturedListener).not.toBeNull();
    });

    it('2回目のstartTimeoutCheckerでもリスナーは重複登録されない', async () => {
      const { startTimeoutChecker } = await loadFreshModule();
      await startTimeoutChecker();
      await startTimeoutChecker();

      expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalledTimes(1);
    });
  });

  describe('stopTimeoutChecker', () => {
    it('chrome.alarms.clear が呼ばれる', async () => {
      const { stopTimeoutChecker } = await loadFreshModule();
      await stopTimeoutChecker();

      expect(mockAlarmsClear).toHaveBeenCalledWith('check_session_timeout');
    });

    it('chrome.alarms.clear が失敗しても throw しない', async () => {
      const { stopTimeoutChecker } = await loadFreshModule();
      mockAlarmsClear.mockRejectedValueOnce(new Error('Clear error'));

      await expect(stopTimeoutChecker()).resolves.not.toThrow();
    });

    it('エラー時にWARNログが出力される', async () => {
      const { stopTimeoutChecker } = await loadFreshModule();
      mockAlarmsClear.mockRejectedValueOnce(new Error('Clear error'));

      await stopTimeoutChecker();

      const logWarn = (await import('../../../../utils/logger.js')).logWarn;
      expect(logWarn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to stop'),
        expect.objectContaining({ error: expect.stringContaining('Clear error') }),
        undefined,
        expect.any(String)
      );
    });
  });

  describe('initialize', () => {
    it('startTimeoutChecker を呼び出す', async () => {
      const { initialize } = await loadFreshModule();
      await initialize();

      expect(mockAlarmsCreate).toHaveBeenCalled();
    });

    it('startTimeoutChecker が失敗しても throw しない', async () => {
      const { initialize } = await loadFreshModule();
      mockAlarmsCreate.mockRejectedValueOnce(new Error('Create error'));

      await expect(initialize()).resolves.not.toThrow();
    });

    it('initialize のエラー時にERRORログが出る', async () => {
      const { initialize } = await loadFreshModule();
      mockAlarmsCreate.mockRejectedValueOnce(new Error('Init alarm error'));

      await initialize();

      // エラーは startTimeoutChecker 内でキャッチされる
      const logError = (await import('../../../../utils/logger.js')).logError;
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('start session timeout checker'),
        expect.objectContaining({ error: expect.stringContaining('Init alarm error') }),
        expect.any(String),
        expect.any(String)
      );
    });
  });

  describe('アラームリスナー', () => {
    it('check_session_timeout アラームでロックが実行される（タイムアウト超過時）', async () => {
      const { startTimeoutChecker } = await loadFreshModule();
      await startTimeoutChecker();
      expect(capturedListener).not.toBeNull();

      storageData['session_last_activity'] = Date.now() - 31 * 60 * 1000;
      capturedListener!({ name: 'check_session_timeout' } as chrome.alarms.Alarm);

      await new Promise((r) => setTimeout(r, 100));

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({ IS_LOCKED: true })
      );
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SESSION_LOCK_REQUEST' })
      );
    });

    it('タイムアウト時にINFOログが出る', async () => {
      const { startTimeoutChecker } = await loadFreshModule();
      await startTimeoutChecker();

      storageData['session_last_activity'] = Date.now() - 31 * 60 * 1000;
      capturedListener!({ name: 'check_session_timeout' } as chrome.alarms.Alarm);

      await new Promise((r) => setTimeout(r, 100));

      const logInfo = (await import('../../../../utils/logger.js')).logInfo;
      expect(logInfo).toHaveBeenCalledWith(
        expect.stringContaining('locked'),
        expect.objectContaining({ timeoutMinutes: expect.any(Number) }),
        expect.any(String)
      );
    });

    it('lockSession の storage エラー時も throw しない', async () => {
      const { startTimeoutChecker } = await loadFreshModule();
      await startTimeoutChecker();

      storageData['session_last_activity'] = Date.now() - 31 * 60 * 1000;
      (chrome.storage.local.set as vi.Mock).mockRejectedValueOnce(new Error('Lock storage error'));

      capturedListener!({ name: 'check_session_timeout' } as chrome.alarms.Alarm);

      await new Promise((r) => setTimeout(r, 100));

      const logError = (await import('../../../../utils/logger.js')).logError;
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('lock'),
        expect.objectContaining({ error: expect.stringContaining('Lock storage error') }),
        expect.any(String),
        expect.any(String)
      );
    });

    it('check_session_timeout 以外のアラームは無視される', async () => {
      const { startTimeoutChecker } = await loadFreshModule();
      await startTimeoutChecker();

      capturedListener!({ name: 'other_alarm' } as chrome.alarms.Alarm);

      await new Promise((r) => setTimeout(r, 50));

      const setCalls = (chrome.storage.local.set as vi.Mock).mock.calls.filter(
        (call: unknown[]) => (call[0] as any)?.IS_LOCKED !== undefined
      );
      expect(setCalls.length).toBe(0);
    });

    it('アクティビティ記録がない場合はロックしない', async () => {
      const { startTimeoutChecker } = await loadFreshModule();
      await startTimeoutChecker();

      capturedListener!({ name: 'check_session_timeout' } as chrome.alarms.Alarm);

      await new Promise((r) => setTimeout(r, 100));

      const setCalls = (chrome.storage.local.set as vi.Mock).mock.calls.filter(
        (call: unknown[]) => (call[0] as any)?.IS_LOCKED !== undefined
      );
      expect(setCalls.length).toBe(0);
    });

    it('タイムアウト未満の場合はロックしない', async () => {
      const { startTimeoutChecker } = await loadFreshModule();
      await startTimeoutChecker();

      storageData['session_last_activity'] = Date.now() - 10 * 60 * 1000;
      capturedListener!({ name: 'check_session_timeout' } as chrome.alarms.Alarm);

      await new Promise((r) => setTimeout(r, 100));

      const setCalls = (chrome.storage.local.set as vi.Mock).mock.calls.filter(
        (call: unknown[]) => (call[0] as any)?.IS_LOCKED !== undefined
      );
      expect(setCalls.length).toBe(0);
    });

    it('checkTimeout の storage エラー時も throw しない', async () => {
      const { startTimeoutChecker } = await loadFreshModule();
      await startTimeoutChecker();

      (chrome.storage.local.get as vi.Mock).mockRejectedValueOnce(new Error('Get error'));

      capturedListener!({ name: 'check_session_timeout' } as chrome.alarms.Alarm);

      await new Promise((r) => setTimeout(r, 100));

      const logError = (await import('../../../../utils/logger.js')).logError;
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('check session timeout'),
        expect.objectContaining({ error: expect.stringContaining('Get error') }),
        expect.any(String),
        expect.any(String)
      );
    });
  });
});
