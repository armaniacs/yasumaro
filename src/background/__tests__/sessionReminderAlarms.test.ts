/**
 * sessionReminderAlarms.test.ts
 * PBI 2026-10-22-04 box (c) ― the background send path: hourly tick, daily
 * gate, candidate query skipped while the gate is closed, one notification
 * plus the persisted fired day.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SessionReminderAlarms,
  SESSION_REMINDER_ALARM_NAME,
  SESSION_REMINDER_CHECK_INTERVAL_MINUTES,
} from '../sessionReminderAlarms.js';
import {
  dismissReminder,
  saveReminderState,
  SESSION_REMINDER_STORAGE_KEY,
} from '../../utils/sessionReminder/reminderStore.js';
import type { ReminderCandidateLike } from '../../utils/sessionReminder/reminderNotify.js';
import { formatLocalDateString } from '../../utils/localDate.js';
import type { AlarmPort, Clock, StorageArea, StoragePort } from '../../utils/ports.js';

vi.mock('../../utils/logger/api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/logger/api.js')>();
  return {
    ...actual,
    logInfo: vi.fn(actual.logInfo),
    logWarn: vi.fn(actual.logWarn),
    logError: vi.fn(actual.logError),
  };
});

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
}

class FakeAlarmPort implements AlarmPort {
  created: Array<{ name: string; alarmInfo: chrome.alarms.AlarmCreateInfo }> = [];
  cleared: string[] = [];
  /** Existing alarms by name (the get-then-create guard reads these). */
  registered: Map<string, chrome.alarms.Alarm> = new Map();

  async create(name: string, alarmInfo: chrome.alarms.AlarmCreateInfo): Promise<void> {
    this.created.push({ name, alarmInfo });
    this.registered.set(name, { name, periodInMinutes: alarmInfo.periodInMinutes });
  }

  async clear(name: string): Promise<void> {
    this.cleared.push(name);
    this.registered.delete(name);
  }

  async get(name: string): Promise<chrome.alarms.Alarm | undefined> {
    return this.registered.get(name);
  }

  onAlarm(_listener: (alarm: { name: string }) => void): void {
    // Listener registration belongs to the service-worker wiring (deferred).
  }
}

const NOW_MS = new Date(2026, 9, 24, 10, 0, 0).getTime();
const TODAY = formatLocalDateString(NOW_MS);

function makeCandidate(id: number): ReminderCandidateLike {
  return {
    record: {
      id,
      title: `Page ${id}`,
      url: `https://example.com/p${id}`,
    },
    scrollRatio: 0.3,
  };
}

describe('SessionReminderAlarms', () => {
  let storage: StoragePort;
  let alarms: FakeAlarmPort;
  let clock: Clock;
  let shown: Array<{ id: string; payload: { type: string; title: string; message: string; buttons?: Array<{ title: string }> } }>;
  let queried: number;

  beforeEach(() => {
    const local = new InMemoryStorageArea();
    storage = { local, session: new InMemoryStorageArea() };
    alarms = new FakeAlarmPort();
    clock = { now: () => NOW_MS };
    shown = [];
    queried = 0;
  });

  function createService(candidates: ReminderCandidateLike[], actionLabels?: { dismiss: string; discard: string }) {
    return new SessionReminderAlarms({
      alarms,
      clock,
      storage,
      queryCandidates: () => {
        queried += 1;
        return Promise.resolve(candidates);
      },
      show: (id, payload) => {
        shown.push({ id, payload });
      },
      iconUrl: () => 'icon.png',
      ...(actionLabels !== undefined ? { actionLabels } : {}),
    });
  }

  describe('start', () => {
    it('registers the hourly reminder alarm', async () => {
      await createService([]).start();
      expect(alarms.created.some((c) => c.name === SESSION_REMINDER_ALARM_NAME)).toBe(true);
      const created = alarms.created.find((c) => c.name === SESSION_REMINDER_ALARM_NAME);
      expect(created?.alarmInfo.periodInMinutes).toBe(SESSION_REMINDER_CHECK_INTERVAL_MINUTES);
    });

    it('creates only when no alarm is registered under the name (get-then-create)', async () => {
      // chrome.alarms.create cancels and replaces a same-name alarm and
      // recomputes a periodInMinutes-only alarm's first firing from creation
      // time — recreating on every SW startup resets the countdown (the
      // standingAlarmGuard contract this service must share).
      await createService([]).start();
      await createService([]).start();
      await createService([]).start();
      expect(alarms.created.filter((c) => c.name === SESSION_REMINDER_ALARM_NAME)).toHaveLength(1);
    });

    it('never clears the reminder alarm (a clear would destroy its scheduledTime)', async () => {
      await createService([]).start();
      expect(alarms.cleared).not.toContain(SESSION_REMINDER_ALARM_NAME);
    });

    it('keeps the existing scheduledTime across restarts', async () => {
      await createService([]).start();
      const first = alarms.registered.get(SESSION_REMINDER_ALARM_NAME);
      // A restart with the alarm already armed re-runs start(): the
      // guard must leave the registered alarm (and its countdown) intact.
      await createService([]).start();
      expect(alarms.registered.get(SESSION_REMINDER_ALARM_NAME)).toBe(first);
    });
  });

  describe('checkToday', () => {
    it('fires one notification and persists the fired day', async () => {
      await createService([makeCandidate(11)]).checkToday();
      expect(shown).toHaveLength(1);
      expect(shown[0]?.id).toBe('session-reminder-11');
      expect(shown[0]?.payload.message).toContain('Page 11');
      const stored = await storage.local.get<Record<string, { lastFiredDay?: string | null }>>([
        SESSION_REMINDER_STORAGE_KEY,
      ]);
      expect(stored[SESSION_REMINDER_STORAGE_KEY]?.lastFiredDay).toBe(TODAY);
    });

    it('carries the action labels as the notification buttons (O2 釦)', async () => {
      await createService([makeCandidate(11)], { dismiss: 'Not today', discard: "Don't remind me" }).checkToday();
      expect(shown[0]?.payload.buttons).toEqual([
        { title: 'Not today' },
        { title: "Don't remind me" },
      ]);
    });

    it('omits the buttons when no action labels are supplied', async () => {
      await createService([makeCandidate(11)]).checkToday();
      expect(shown[0]?.payload.buttons).toBeUndefined();
    });

    it('fires at most once per day without querying candidates again', async () => {
      const service = createService([makeCandidate(11)]);
      await service.checkToday();
      await service.checkToday();
      expect(shown).toHaveLength(1);
      expect(queried).toBe(1);
    });

    it('fires nothing when no candidate is eligible', async () => {
      await createService([]).checkToday();
      expect(shown).toHaveLength(0);
    });

    it('skips the dismissed candidate and fires the next one', async () => {
      const { defaultReminderState } = await import('../../utils/sessionReminder/reminderStore.js');
      await saveReminderState(storage.local, dismissReminder(defaultReminderState(), 11, TODAY));
      await createService([makeCandidate(11), makeCandidate(12)]).checkToday();
      expect(shown).toHaveLength(1);
      expect(shown[0]?.id).toBe('session-reminder-12');
    });
  });
});
