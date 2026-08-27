/**
 * SessionAlarmService.ts
 * セッションタイムアウト管理 (chrome.alarms API)。
 * AlarmPort / Clock / StoragePort を注入することで chrome global mock なしに
 * 自動ロック・アラーム二重登録防止を単体テスト可能にする。
 */

import { logInfo, logWarn, logError, ErrorCode } from '../utils/logger.js';
import { errorMessage } from '../utils/errorUtils.js';
import { StorageKeys } from '../utils/storage/types.js';
import { CURRENT_PROTOCOL_VERSION } from './messageTypes.js';
import {
  SYSTEM_CLOCK,
  CHROME_STORAGE_PORT,
  CHROME_ALARM_PORT,
  type Clock,
  type StoragePort,
  type AlarmPort,
} from '../utils/ports.js';

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30分
const SESSION_CHECK_INTERVAL_MINUTES = 5; // セッションチェック間隔（バッテリー効率化）
const ALARM_NAME_CHECK_SESSION = 'check_session_timeout';
const STORAGE_KEY_LAST_ACTIVITY = 'session_last_activity';
const LOCK_NOTIFICATION_RETRY_DELAY_MS = 100; // ロック通知リトライ間の待機時間
const LOCK_NOTIFICATION_MAX_RETRIES = 3;

export type SendMessageFn = (message: unknown) => Promise<unknown>;

const defaultSendMessage: SendMessageFn = (message) => chrome.runtime.sendMessage(message);

export class SessionAlarmService {
  private alarmListenerSetUp = false;

  constructor(
    private readonly alarms: AlarmPort = CHROME_ALARM_PORT,
    private readonly clock: Clock = SYSTEM_CLOCK,
    private readonly storage: StoragePort = CHROME_STORAGE_PORT,
    private readonly sendMessage: SendMessageFn = defaultSendMessage
  ) {}

  async updateActivity(): Promise<void> {
    try {
      await this.storage.local.set({ [STORAGE_KEY_LAST_ACTIVITY]: this.clock.now() });
    } catch (error) {
      logWarn(
        'Failed to update activity',
        { error: errorMessage(error) },
        undefined,
        'SessionAlarmService.ts'
      );
    }
  }

  async startTimeoutChecker(): Promise<void> {
    try {
      await this.alarms.clear(ALARM_NAME_CHECK_SESSION);
      await this.alarms.create(ALARM_NAME_CHECK_SESSION, {
        periodInMinutes: SESSION_CHECK_INTERVAL_MINUTES,
      });

      this.setupAlarmListener();

      await logInfo(
        'Session timeout checker started',
        { alarmName: ALARM_NAME_CHECK_SESSION, timeoutMinutes: SESSION_TIMEOUT_MS / 60000 },
        'SessionAlarmService.ts'
      );
    } catch (error) {
      logError(
        'Failed to start session timeout checker',
        { error: errorMessage(error) },
        ErrorCode.INTERNAL_ERROR,
        'SessionAlarmService.ts'
      );
    }
  }

  async stopTimeoutChecker(): Promise<void> {
    try {
      await this.alarms.clear(ALARM_NAME_CHECK_SESSION);
      await logInfo(
        'Session timeout checker stopped',
        { alarmName: ALARM_NAME_CHECK_SESSION },
        'SessionAlarmService.ts'
      );
    } catch (error) {
      logWarn(
        'Failed to stop session timeout checker',
        { error: errorMessage(error) },
        undefined,
        'SessionAlarmService.ts'
      );
    }
  }

  async initialize(): Promise<void> {
    try {
      await this.startTimeoutChecker();
    } catch (error) {
      logError(
        'Failed to initialize session alarms manager',
        { error: errorMessage(error) },
        ErrorCode.INTERNAL_ERROR,
        'SessionAlarmService.ts'
      );
    }
  }

  private async checkTimeout(): Promise<void> {
    try {
      const result = await this.storage.local.get<Record<string, unknown>>([
        STORAGE_KEY_LAST_ACTIVITY,
        StorageKeys.MASTER_PASSWORD_ENABLED,
      ]);

      // No master password means "locked" is a meaningless concept for this
      // user; setting IS_LOCKED here would permanently break their
      // encrypt/decrypt path (see getOrCreateEncryptionKey's IS_LOCKED check).
      if (!result[StorageKeys.MASTER_PASSWORD_ENABLED]) {
        return;
      }

      const lastActivity = result[STORAGE_KEY_LAST_ACTIVITY] as number;
      if (!lastActivity) {
        return;
      }

      const elapsed = this.clock.now() - lastActivity;
      if (elapsed > SESSION_TIMEOUT_MS) {
        await this.lockSession();
        await logInfo(
          'Session locked due to inactivity',
          { timeoutMinutes: SESSION_TIMEOUT_MS / 60000, elapsedMinutes: elapsed / 60000 },
          'SessionAlarmService.ts'
        );
      }
    } catch (error) {
      logError(
        'Failed to check session timeout',
        { error: errorMessage(error) },
        ErrorCode.INTERNAL_ERROR,
        'SessionAlarmService.ts'
      );
    }
  }

  private async lockSession(): Promise<void> {
    try {
      await this.storage.local.set({ [StorageKeys.IS_LOCKED]: true });

      // VULN-017 fix: retry lock notification up to 3 times to ensure
      // encryption session receives the lock signal, preventing stale
      // cached decryption keys from remaining usable after auto-lock.
      let retries = LOCK_NOTIFICATION_MAX_RETRIES;
      let success = false;
      while (retries > 0 && !success) {
        try {
          await this.sendMessage({
            type: 'SESSION_LOCK_REQUEST',
            protocolVersion: CURRENT_PROTOCOL_VERSION,
          });
          success = true;
        } catch {
          retries--;
          if (retries > 0) {
            await new Promise((resolve) => setTimeout(resolve, LOCK_NOTIFICATION_RETRY_DELAY_MS));
          }
        }
      }
      if (!success) {
        logError(
          'Failed to deliver lock notification after retries. Session will be locked via IS_LOCKED flag check in getOrCreateEncryptionKey.',
          { retries },
          ErrorCode.INTERNAL_ERROR,
          'SessionAlarmService.ts'
        );
      }
    } catch (error) {
      logError(
        'Failed to lock session',
        { error: errorMessage(error) },
        ErrorCode.INTERNAL_ERROR,
        'SessionAlarmService.ts'
      );
    }
  }

  private setupAlarmListener(): void {
    if (this.alarmListenerSetUp) {
      return;
    }

    this.alarms.onAlarm((alarm) => {
      if (alarm.name === ALARM_NAME_CHECK_SESSION) {
        void this.checkTimeout();
      }
    });
    this.alarmListenerSetUp = true;
  }
}
