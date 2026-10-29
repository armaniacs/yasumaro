/**
 * sessionReminderClick.ts
 *
 * Reminder notification click/button path (PBI 2026-10-22-04, O2 + O4).
 *
 * The notification id carries the record id (reminderNotificationId), and an
 * id alone carries no URL — the record DB is re-read before anything opens
 * (攻撃者視点で ID 解析を安全に: the id is parsed strictly and the URL comes
 * only from the stored row, never from the notification id). Only a
 * chrome-generated reminder id is processed, only a non-private record is
 * opened, and only http(s) URLs open a tab.
 *
 * O4: the click also appends one TODO line to the Daily Note through the
 * noteSectionEditor seam (obsidianClient.appendToDailyNote runs
 * NoteSectionEditor.insertIntoSection internally). The append is an
 * additional action: a failed Daily Note write logs a warning and never
 * clears the notification, so the user can click again to retry the TODO
 * (失敗時は通知は消さない).
 *
 * O2 釦: button 0 dismisses (hidden for the rest of the local day, the
 * re-notify-tomorrow action), button 1 discards (id excluded forever). The
 * state transitions live in reminderStore (already persisted + tested); this
 * module only wires the two notification buttons — snooze needs a time
 * picker and stays a later slice (Chrome allows 2 buttons per notification).
 */

import { REMINDER_NOTIFICATION_PREFIX } from '../utils/sessionReminder/reminderNotify.js';
import {
  dismissReminder,
  discardReminder,
  loadReminderState,
  saveReminderState,
  type SessionReminderState,
} from '../utils/sessionReminder/reminderStore.js';
import type { StoragePort } from '../utils/ports.js';
import { CHROME_STORAGE_PORT, SYSTEM_CLOCK, type Clock } from '../utils/ports.js';
import { isSecureUrl } from '../utils/urlUtils.js';
import {
  sanitizeForMarkdownLinkText,
  sanitizeUrlForMarkdownTarget,
} from '../utils/markdownSanitizer.js';
import { normalizeSingleLine } from '../utils/markdownFormatter.js';
import { formatLocalDateString } from '../utils/localDate.js';
import { errorMessage } from '../utils/errorUtils.js';
import { logError, logInfo, logWarn } from '../utils/logger/api.js';
import { ErrorCode } from '../utils/logger/types.js';

/** The one record view the click path reads (id, privacy verdict, url). */
export interface ReminderRecordView {
  id: number;
  url: string;
  title?: string | null;
  masked_count?: number | null;
}

export interface SessionReminderClickDeps {
  /** Record DB read (id → row). null when the row is gone (purged). */
  queryRecordById: (recordId: number) => Promise<ReminderRecordView | null>;
  /** Tab write point (chrome.tabs.create behind it). */
  openTab: (url: string) => void;
  /** Notification write point (chrome.notifications.clear behind it). */
  dismissNotification: (notificationId: string) => void;
  /** Daily Note append (obsidianClient.appendToDailyNote, the editor seam). */
  appendTodoToDailyNote: (todoLine: string) => Promise<void>;
  /** Storage for the dismiss/discard state (injected for tests). */
  storage?: StoragePort;
  /** Local clock for the dismiss day (injected for tests). */
  clock?: Clock;
}

/** Dismiss lives in the notification's first button; discard in the second. */
const DISMISS_BUTTON_INDEX = 0;
const DISCARD_BUTTON_INDEX = 1;

/**
 * Parses the record id out of a chrome-generated reminder id. The suffix must
 * be plain digits and must re-serialize unchanged — a foreign prefix, an
 * empty suffix, or a decorated number is not ours and never opens anything.
 */
export function parseReminderRecordId(notificationId: string): number | null {
  if (!notificationId.startsWith(REMINDER_NOTIFICATION_PREFIX)) return null;
  const raw = notificationId.slice(REMINDER_NOTIFICATION_PREFIX.length);
  if (raw.length === 0 || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return null;
  return String(parsed) === raw ? parsed : null;
}

/**
 * The one TODO line the click appends (BDD 後段: Daily NoteにTODOとして残せる).
 * The link text is a stored record title (attacker-controlled) and the URL
 * target must stay inside the link, so both go through the SSOT sanitize
 * chain before the wrapper is applied — normalizeSingleLine FIRST (a title
 * carrying \n / U+2028 / U+2029 / U+0085 would otherwise forge Markdown
 * lines under the section), then the link-text sanitizer.
 */
export function buildReminderTodoLine(title: string, url: string): string {
  const sanitizedTitle = sanitizeForMarkdownLinkText(normalizeSingleLine(title));
  const sanitizedUrl = sanitizeUrlForMarkdownTarget(url);
  return `- [ ] [${sanitizedTitle}](${sanitizedUrl})`;
}

export function createSessionReminderClickHandlers(deps: SessionReminderClickDeps) {
  const storage = deps.storage ?? CHROME_STORAGE_PORT;
  const clock: Clock = deps.clock ?? SYSTEM_CLOCK;

  /** One shared guard: only a real, non-private, http(s) record may open. */
  async function resolvableRecord(notificationId: string): Promise<ReminderRecordView | null> {
    const recordId = parseReminderRecordId(notificationId);
    if (recordId === null) return null;
    const record = await deps.queryRecordById(recordId);
    if (record === null) {
      await logInfo(
        'Reminder record no longer exists (purged)',
        { notificationId },
        'sessionReminderClick.ts',
      );
      return null;
    }
    // 私物判定記録は開かない (the playback panel's isPlaybackExcluded contract).
    if ((record.masked_count ?? 0) > 0) {
      await logInfo(
        'Reminder record is judged private — not opened',
        { notificationId },
        'sessionReminderClick.ts',
      );
      return null;
    }
    if (!isSecureUrl(record.url)) {
      await logWarn(
        'Reminder record url is not http(s) — not opened',
        { notificationId },
        ErrorCode.UNKNOWN_ERROR,
        'sessionReminderClick.ts',
      );
      return null;
    }
    return record;
  }

  /**
   * chrome.notifications.onClicked entry: open the record and append the
   * Daily Note TODO. The tab open is the primary action; the TODO append is
   * the additional one and its failure keeps the notification on screen.
   */
  async function onClicked(notificationId: string): Promise<void> {
    try {
      if (!notificationId.startsWith(REMINDER_NOTIFICATION_PREFIX)) return;
      const record = await resolvableRecord(notificationId);
      if (record === null) return;
      deps.openTab(record.url);
      let appended = true;
      try {
        await deps.appendTodoToDailyNote(
          buildReminderTodoLine(record.title ?? record.url, record.url),
        );
      } catch (error) {
        // The append is 追加動作: a failed Daily Note write never blocks the
        // tab open and never clears the notification (the user can click
        // again to retry the TODO).
        appended = false;
        await logWarn(
          'Failed to append the reminder TODO to the Daily Note',
          { notificationId, error: errorMessage(error) },
          ErrorCode.UNKNOWN_ERROR,
          'sessionReminderClick.ts',
        );
      }
      if (appended) {
        deps.dismissNotification(notificationId);
      }
    } catch (error) {
      await logError(
        'Failed to handle the reminder notification click',
        { notificationId, error: errorMessage(error) },
        ErrorCode.INTERNAL_ERROR,
        'sessionReminderClick.ts',
      );
    }
  }

  /**
   * chrome.notifications.onButtonClicked entry: dismiss (hidden for the rest
   * of the local day, re-eligible tomorrow) or discard (id excluded forever).
   * The state is persisted before the notification clears, so a failed write
   * leaves the reminder on screen.
   */
  async function onButtonClicked(notificationId: string, buttonIndex: number): Promise<void> {
    try {
      if (!notificationId.startsWith(REMINDER_NOTIFICATION_PREFIX)) return;
      const recordId = parseReminderRecordId(notificationId);
      if (recordId === null) return;
      const today = formatLocalDateString(clock.now());
      const state = await loadReminderState(storage.local);
      let next: SessionReminderState;
      if (buttonIndex === DISMISS_BUTTON_INDEX) {
        next = dismissReminder(state, recordId, today);
      } else if (buttonIndex === DISCARD_BUTTON_INDEX) {
        next = discardReminder(state, recordId);
      } else {
        return;
      }
      await saveReminderState(storage.local, next);
      deps.dismissNotification(notificationId);
    } catch (error) {
      await logError(
        'Failed to handle the reminder notification button',
        { notificationId, buttonIndex, error: errorMessage(error) },
        ErrorCode.INTERNAL_ERROR,
        'sessionReminderClick.ts',
      );
    }
  }

  return { onClicked, onButtonClicked };
}
