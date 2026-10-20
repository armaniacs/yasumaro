/**
 * SessionAlarmService.ts
 * セッションタイムアウト管理 (chrome.alarms API)。
 * AlarmPort / Clock / StoragePort を注入することで chrome global mock なしに
 * 自動ロック判定を単体テスト可能にする。
 */

import { ErrorCode } from '../utils/logger/types.js';
import { logInfo, logWarn, logError } from '../utils/logger/api.js';
import { errorMessage } from '../utils/errorUtils.js';
import { StorageKeys } from '../utils/storage/types.js';
import { CURRENT_PROTOCOL_VERSION } from '../messaging/protocol.js';
import { isPlainRecord } from '../utils/objectUtils.js';
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

const realStepDelay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class SessionAlarmService {
  constructor(
    private readonly alarms: AlarmPort = CHROME_ALARM_PORT,
    private readonly clock: Clock = SYSTEM_CLOCK,
    private readonly storage: StoragePort = CHROME_STORAGE_PORT,
    private readonly sendMessage: SendMessageFn = defaultSendMessage,
    private readonly stepDelay: (ms: number) => Promise<void> = realStepDelay
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

  /**
   * Sole entry point for the timeout check: alarmRegistry owns the
   * `check_session_timeout` firing and calls this through its run hook, so an
   * extra onAlarm listener here would run the check twice per firing.
   */
  async checkTimeout(): Promise<void> {
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

      // VULN-017 fix (PBI 2026-10-18-20): retry the lock notification up to 3
      // times so extension-page contexts holding a cached key can drop it.
      // Platform fact (same one recorded in privacyConsent.ts):
      // chrome.runtime.sendMessage is never delivered to the sender's own
      // context, so the SW's own MessageRouter handler cannot receive this
      // send. Delivery is confirmed only by the response body
      // ({ success: true }, messaging/types.ts): a receiver-less fan-out also
      // resolves, so marking success on resolution would report a lock nobody
      // applied.
      let retries = LOCK_NOTIFICATION_MAX_RETRIES;
      let confirmed = false;
      while (retries > 0 && !confirmed) {
        try {
          const response = await this.sendMessage({
            type: 'SESSION_LOCK_REQUEST',
            protocolVersion: CURRENT_PROTOCOL_VERSION,
          });
          confirmed = isPlainRecord(response) && response['success'] === true;
        } catch {
          // A rejected send is an unconfirmed delivery too.
        }
        if (!confirmed) {
          retries--;
          if (retries > 0) {
            await this.stepDelay(LOCK_NOTIFICATION_RETRY_DELAY_MS);
          }
        }
      }
      if (!confirmed) {
        logError(
          'Lock notification was never confirmed: no context with a SESSION_LOCK_REQUEST handler responded. Session will be locked via IS_LOCKED flag check in getOrCreateEncryptionKey.',
          { retries, confirmed: false },
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
}
