/**
 * reminderNotify.ts (neutral layer, src/utils/sessionReminder/)
 *
 * Reminder send-path policy (PBI 2026-10-22-04, box (c)). Pure selection +
 * pure payload: which candidate fires today and what the notification says.
 * Lives in the neutral layer so both the dashboard panel and the background
 * alarm service import it without a layer violation (background → dashboard
 * imports are prohibited; see dev-docs/LAYERS.md). The candidate type here
 * is structural on purpose: the dashboard aggregate's ReminderCandidate
 * carries extra fields and stays assignable without this layer importing
 * the dashboard.
 *
 * Cap rationale (Why-analysis, recorded in the PBI): REMINDER_MAX_PER_DAY=1
 * follows the BDD scenario's "1件通知され" directly; overflow candidates
 * stay visible in the playback panel, and dismissed ones become re-eligible
 * tomorrow, so nothing is silently dropped.
 */

import { isRecordEligible, type SessionReminderState } from './reminderStore.js';

/** At most one reminder notification fires per local day (BDD: 1件通知). */
export const REMINDER_MAX_PER_DAY = 1;

/** Notification id prefix for reminder notifications. */
export const REMINDER_NOTIFICATION_PREFIX = 'session-reminder-';

/** Structural minimum a candidate needs for the pick + payload. */
export interface RemindableRecord {
  id: number;
  title: string;
  url: string;
}

export interface ReminderCandidateLike {
  record: RemindableRecord;
  scrollRatio: number;
}

export function reminderNotificationId(recordId: number): string {
  return `${REMINDER_NOTIFICATION_PREFIX}${recordId}`;
}

/**
 * Picks the one candidate to fire today: the daily gate (lastFiredDay)
 * first, then the stored dismiss/snooze/discard actions. Candidates arrive
 * oldest-first and capped, so the first eligible one wins.
 */
export function pickReminderToFire(
  candidates: ReminderCandidateLike[],
  state: SessionReminderState,
  today: string,
  nowMs: number,
): ReminderCandidateLike | null {
  // Same gate as shouldFireReminderToday(lastFiredDay, today) in the
  // dashboard aggregate, inlined so this neutral layer never imports the
  // dashboard (prohibited edge; behavior pinned by the tests on both sides).
  if (state.lastFiredDay === today) return null;
  // Eligibility first, then the send-path bound: the first eligible
  // candidate wins and the cap holds even if the caller passes an
  // uncapped list.
  const eligible = candidates.filter((candidate) =>
    isRecordEligible(state, candidate.record.id, today, nowMs),
  );
  return eligible.slice(0, REMINDER_MAX_PER_DAY)[0] ?? null;
}

/** Pure payload inputs for one reminder notification. */
export interface ReminderNotificationInput {
  title: string;
  url: string;
  iconUrl: string;
  /**
   * Optional action labels for the notification's buttons. Absent = no
   * buttons (the tests keep the 3-field input). Chrome allows at most 2
   * buttons per notification, so the store's 3 actions map to the click
   * (open) plus dismiss and discard; snooze needs a time picker and stays a
   * later slice (PBI 2026-10-22-04 O2).
   */
  actions?: { dismiss: string; discard: string };
}

/**
 * Pure payload builder. The message carries the title and host only — never
 * the full URL (notification-center text outlives the session and can leak
 * through screenshots). Shape matches NotificationPayload so the background
 * single write point accepts it unchanged.
 */
export function reminderNotificationOptions(input: ReminderNotificationInput): {
  type: 'basic';
  iconUrl: string;
  title: string;
  message: string;
  buttons?: Array<{ title: string }>;
  requireInteraction?: boolean;
} {
  let host = '';
  try {
    host = new URL(input.url).hostname;
  } catch {
    host = '';
  }
  const where = host !== '' ? ` (${host})` : '';
  return {
    type: 'basic',
    iconUrl: input.iconUrl,
    title: 'Unread page reminder',
    message: `Continue reading "${input.title}"${where}?`,
    // The reminder must outlive the user's glance (requireInteraction, the
    // privacy-confirm convention) and carries the two non-click actions;
    // a click on the body itself opens the record (sessionReminderClick.ts).
    ...(input.actions
      ? {
          buttons: [{ title: input.actions.dismiss }, { title: input.actions.discard }],
          requireInteraction: true,
        }
      : {}),
  };
}
