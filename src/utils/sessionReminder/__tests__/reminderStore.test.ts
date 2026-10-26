/**
 * reminderStore.test.ts
 * PBI 2026-10-22-04 box (b) ― dismiss / re-notify / discard transitions,
 * eligibility, fail-closed validation, and the storage round trip.
 */
import { describe, it, expect } from 'vitest';
import {
  defaultReminderState,
  discardReminder,
  dismissReminder,
  isRecordEligible,
  loadReminderState,
  markReminderFired,
  saveReminderState,
  snoozeReminder,
  validateReminderState,
  SESSION_REMINDER_STORAGE_KEY,
} from '../reminderStore.js';
import type { StorageArea } from '../../ports.js';

class InMemoryStorageArea implements StorageArea {
  private readonly data = new Map<string, unknown>();

  async get<T extends Record<string, unknown>>(keys: string[]): Promise<Partial<T>> {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (this.data.has(key)) result[key] = this.data.get(key);
    }
    return result as Partial<T>;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) this.data.set(key, value);
  }

  async remove(keys: string[]): Promise<void> {
    for (const key of keys) this.data.delete(key);
  }

  raw(key: string): unknown {
    return this.data.get(key);
  }
}

describe('reminderStore', () => {
  describe('dismissReminder', () => {
    it('hides the record for the rest of the day and re-admits it tomorrow', () => {
      const state = dismissReminder(defaultReminderState(), 5, '2026-10-24');
      expect(isRecordEligible(state, 5, '2026-10-24', 1_000)).toBe(false);
      expect(isRecordEligible(state, 5, '2026-10-25', 2_000)).toBe(true);
      expect(isRecordEligible(state, 6, '2026-10-24', 1_000)).toBe(true);
    });
  });

  describe('snoozeReminder', () => {
    it('hides the record until the instant and re-admits it at the instant', () => {
      const state = snoozeReminder(defaultReminderState(), 5, 10_000);
      expect(isRecordEligible(state, 5, '2026-10-24', 9_999)).toBe(false);
      expect(isRecordEligible(state, 5, '2026-10-24', 10_000)).toBe(true);
    });
  });

  describe('discardReminder', () => {
    it('excludes the record id on every day', () => {
      const state = discardReminder(defaultReminderState(), 5);
      expect(isRecordEligible(state, 5, '2026-10-24', 1_000)).toBe(false);
      expect(isRecordEligible(state, 5, '2026-11-30', 9_999_999)).toBe(false);
      expect(isRecordEligible(state, 6, '2026-10-24', 1_000)).toBe(true);
    });
  });

  describe('markReminderFired', () => {
    it('records the fired day for the daily gate', () => {
      const state = markReminderFired(defaultReminderState(), '2026-10-24');
      expect(state.lastFiredDay).toBe('2026-10-24');
    });
  });

  describe('validateReminderState', () => {
    it('falls back to the default state on missing or corrupt input', () => {
      expect(validateReminderState(null)).toEqual(defaultReminderState());
      expect(validateReminderState(undefined)).toEqual(defaultReminderState());
      expect(validateReminderState(JSON.parse('{"lastFiredDay":42,"records":"nope"}'))).toEqual(
        defaultReminderState(),
      );
    });

    it('keeps valid entries and drops only the corrupt ones', () => {
      const state = validateReminderState({
        lastFiredDay: '2026-10-24',
        records: {
          '5': { kind: 'dismissed', day: '2026-10-24' },
          '6': { kind: 'nope' },
          '7': { kind: 'snoozed' },
          '8': { kind: 'discarded' },
        },
      });
      expect(state.lastFiredDay).toBe('2026-10-24');
      expect(Object.keys(state.records).sort()).toEqual(['5', '8']);
    });

    it('drops prototype-pollution keys instead of assigning them', () => {
      const state = validateReminderState(
        JSON.parse('{"records":{"__proto__":{"kind":"discarded"},"5":{"kind":"discarded"}}}'),
      );
      expect(Object.keys(state.records)).toEqual(['5']);
      expect({} as Record<string, string>).not.toHaveProperty('kind');
    });

    it('stores ids only, never urls or titles', async () => {
      const storage = new InMemoryStorageArea();
      await saveReminderState(storage, dismissReminder(defaultReminderState(), 5, '2026-10-24'));
      const rawText = JSON.stringify(storage.raw(SESSION_REMINDER_STORAGE_KEY));
      expect(rawText).toContain('5');
      expect(rawText).not.toContain('http');
    });
  });

  describe('loadReminderState + saveReminderState', () => {
    it('round-trips the dismissed state through the storage port', async () => {
      const storage = new InMemoryStorageArea();
      expect(await loadReminderState(storage)).toEqual(defaultReminderState());
      const next = dismissReminder(await loadReminderState(storage), 9, '2026-10-24');
      await saveReminderState(storage, next);
      const reloaded = await loadReminderState(storage);
      expect(isRecordEligible(reloaded, 9, '2026-10-24', 1_000)).toBe(false);
      expect(isRecordEligible(reloaded, 9, '2026-10-25', 2_000)).toBe(true);
    });
  });
});
