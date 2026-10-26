/**
 * sessionReminderAlarms.ts
 *
 * Reminder send path (PBI 2026-10-22-04, box (c), background side).
 * An hourly chrome.alarms tick re-evaluates the daily reminder; the local
 * day gate (lastFiredDay) keeps the surface to one notification per day.
 *
 * Why hourly and not daily: the service worker can restart at any time, and
 * snoozed instants expire between days — an hourly re-check with an early
 * return is cheap (one storage read; the candidate query runs only when the
 * day gate is open), while a periodInMinutes: 1440 alarm would miss both
 * restarts and snooze expiries. Zero chrome.* access here: AlarmPort /
 * Clock / StoragePort plus injected show() and queryCandidates() keep the
 * whole path unit-testable without a chrome global mock (SessionAlarmService
 * 流儀). Wiring the alarm listener + notification click-through into
 * service-worker.ts stays a deferred slice (shared-file edit, see PBI).
 */

import type { ReminderCandidateLike } from '../utils/sessionReminder/reminderNotify.js';
import {
  loadReminderState,
  markReminderFired,
  saveReminderState,
} from '../utils/sessionReminder/reminderStore.js';
import {
  pickReminderToFire,
  reminderNotificationId,
  reminderNotificationOptions,
} from '../utils/sessionReminder/reminderNotify.js';
import { formatLocalDateString } from '../utils/localDate.js';
import { errorMessage } from '../utils/errorUtils.js';
import { logError, logInfo } from '../utils/logger/api.js';
import { ErrorCode } from '../utils/logger/types.js';
import {
  CHROME_ALARM_PORT,
  CHROME_STORAGE_PORT,
  SYSTEM_CLOCK,
  type AlarmPort,
  type Clock,
  type StoragePort,
} from '../utils/ports.js';

export const SESSION_REMINDER_ALARM_NAME = 'session_reminder_daily';
/** Hourly re-check; the day gate decides whether anything fires. */
export const SESSION_REMINDER_CHECK_INTERVAL_MINUTES = 60;

export interface SessionReminderAlarmsDeps {
  alarms?: AlarmPort;
  clock?: Clock;
  storage?: StoragePort;
  /**
   * Candidate provider (SQLite read). Skipped when the day gate is closed.
   * The dashboard aggregate's ReminderCandidate is structurally assignable —
   * the deferred wiring maps rows through it without a layer-violating
   * import.
   */
  queryCandidates?: () => Promise<ReminderCandidateLike[]>;
  /** Notification write point (chrome.notifications.create behind it). */
  show?: (notificationId: string, title: string, message: string, iconUrl: string) => void;
  /** Icon URL resolver (chrome.runtime.getURL in production). */
  iconUrl?: () => string;
}

const defaultQueryCandidates = (): Promise<ReminderCandidateLike[]> => Promise.resolve([]);

export class SessionReminderAlarms {
  private readonly alarms: AlarmPort;
  private readonly clock: Clock;
  private readonly storage: StoragePort;
  private readonly queryCandidates: () => Promise<ReminderCandidateLike[]>;
  private readonly show: (notificationId: string, title: string, message: string, iconUrl: string) => void;
  private readonly iconUrl: () => string;

  constructor(deps: SessionReminderAlarmsDeps = {}) {
    this.alarms = deps.alarms ?? CHROME_ALARM_PORT;
    this.clock = deps.clock ?? SYSTEM_CLOCK;
    this.storage = deps.storage ?? CHROME_STORAGE_PORT;
    this.queryCandidates = deps.queryCandidates ?? defaultQueryCandidates;
    this.show = deps.show ?? ((_id, _title, _message, _icon) => undefined);
    this.iconUrl = deps.iconUrl ?? (() => '');
  }

  async start(): Promise<void> {
    try {
      await this.alarms.clear(SESSION_REMINDER_ALARM_NAME);
      await this.alarms.create(SESSION_REMINDER_ALARM_NAME, {
        periodInMinutes: SESSION_REMINDER_CHECK_INTERVAL_MINUTES,
      });
      await logInfo(
        'Session reminder checker started',
        { alarmName: SESSION_REMINDER_ALARM_NAME },
        'sessionReminderAlarms.ts',
      );
    } catch (error) {
      logError(
        'Failed to start session reminder checker',
        { error: errorMessage(error) },
        ErrorCode.INTERNAL_ERROR,
        'sessionReminderAlarms.ts',
      );
    }
  }

  /**
   * Hourly entry point. Opens the day gate on one storage read; the heavier
   * candidate query runs only when today may still fire.
   */
  async checkToday(): Promise<void> {
    try {
      const nowMs = this.clock.now();
      const today = formatLocalDateString(nowMs);
      const state = await loadReminderState(this.storage.local);
      if (state.lastFiredDay === today) return;
      const candidates = await this.queryCandidates();
      const picked = pickReminderToFire(candidates, state, today, nowMs);
      if (picked === null) return;
      const options = reminderNotificationOptions({
        title: picked.record.title,
        url: picked.record.url,
        iconUrl: this.iconUrl(),
      });
      this.show(reminderNotificationId(picked.record.id), options.title, options.message, options.iconUrl);
      await saveReminderState(this.storage.local, markReminderFired(state, today));
      await logInfo(
        'Session reminder fired',
        { recordId: picked.record.id, day: today },
        'sessionReminderAlarms.ts',
      );
    } catch (error) {
      logError(
        'Failed to check session reminders',
        { error: errorMessage(error) },
        ErrorCode.INTERNAL_ERROR,
        'sessionReminderAlarms.ts',
      );
    }
  }
}
