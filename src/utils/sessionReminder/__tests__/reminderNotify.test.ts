/**
 * reminderNotify.test.ts
 * PBI 2026-10-22-04 box (c) ― the one-per-day pick honoring stored actions,
 * and the host-only notification payload.
 */
import { describe, it, expect } from 'vitest';
import {
  pickReminderToFire,
  reminderNotificationId,
  reminderNotificationOptions,
  REMINDER_MAX_PER_DAY,
  REMINDER_NOTIFICATION_PREFIX,
  type ReminderCandidateLike,
} from '../reminderNotify.js';
import {
  defaultReminderState,
  discardReminder,
  dismissReminder,
  markReminderFired,
  snoozeReminder,
} from '../reminderStore.js';

function makeCandidate(id: number): ReminderCandidateLike {
  return {
    record: { id, title: `Page ${id}`, url: `https://example.com/p${id}` },
    scrollRatio: 0.4,
  };
}

describe('reminderNotify', () => {
  describe('REMINDER_MAX_PER_DAY', () => {
    it('pins the daily cap at one (BDD: 1件通知)', () => {
      expect(REMINDER_MAX_PER_DAY).toBe(1);
    });

    it('uses a namespaced notification id per record', () => {
      expect(reminderNotificationId(7)).toBe(`${REMINDER_NOTIFICATION_PREFIX}7`);
    });
  });

  describe('pickReminderToFire', () => {
    it('picks the oldest eligible candidate when the day gate is open', () => {
      const picked = pickReminderToFire(
        [makeCandidate(1), makeCandidate(2)],
        defaultReminderState(),
        '2026-10-24',
        5_000,
      );
      expect(picked?.record.id).toBe(1);
    });

    it('fires nothing after today already fired (1日1件)', () => {
      const state = markReminderFired(defaultReminderState(), '2026-10-24');
      expect(pickReminderToFire([makeCandidate(1)], state, '2026-10-24', 5_000)).toBeNull();
      expect(pickReminderToFire([makeCandidate(1)], state, '2026-10-25', 5_000)?.record.id).toBe(1);
    });

    it('skips dismissed-today, unexpired snoozes, and discarded ids', () => {
      let state = defaultReminderState();
      state = dismissReminder(state, 1, '2026-10-24');
      state = snoozeReminder(state, 2, 9_999);
      state = discardReminder(state, 3);
      const picked = pickReminderToFire(
        [makeCandidate(1), makeCandidate(2), makeCandidate(3), makeCandidate(4)],
        state,
        '2026-10-24',
        5_000,
      );
      expect(picked?.record.id).toBe(4);
    });

    it('re-admits dismissed ids the next day', () => {
      const state = dismissReminder(defaultReminderState(), 1, '2026-10-24');
      expect(pickReminderToFire([makeCandidate(1)], state, '2026-10-25', 5_000)?.record.id).toBe(1);
    });

    it('fires nothing when every candidate is excluded', () => {
      const state = discardReminder(defaultReminderState(), 1);
      expect(pickReminderToFire([makeCandidate(1)], state, '2026-10-24', 5_000)).toBeNull();
      expect(pickReminderToFire([], defaultReminderState(), '2026-10-24', 5_000)).toBeNull();
    });
  });

  describe('reminderNotificationOptions', () => {
    it('carries the title and host but never the full url', () => {
      const options = reminderNotificationOptions({
        title: 'Deep page',
        url: 'https://example.com/some/path?q=1',
        iconUrl: 'icon.png',
      });
      expect(options.type).toBe('basic');
      expect(options.iconUrl).toBe('icon.png');
      expect(options.message).toContain('Deep page');
      expect(options.message).toContain('example.com');
      expect(options.message).not.toContain('/some/path');
    });

    it('degrades gracefully on an unparseable url', () => {
      const options = reminderNotificationOptions({ title: 'T', url: '::not a url', iconUrl: 'i' });
      expect(options.message).toContain('T');
    });
  });
});
