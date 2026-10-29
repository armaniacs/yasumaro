/**
 * sessionReminderClick.test.ts
 * PBI 2026-10-22-04 O2/O4 ― the notification click/button path: the strict
 * id parse, the fail-closed record re-read (purged / 私物 / non-http(s) rows
 * never open a tab), the Daily Note TODO append with its keep-on-failure
 * policy, and the dismiss/discard buttons persisting before the clear.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildReminderTodoLine,
  createSessionReminderClickHandlers,
  parseReminderRecordId,
} from '../sessionReminderClick.js';
import {
  dismissReminder,
  discardReminder,
  saveReminderState,
  SESSION_REMINDER_STORAGE_KEY,
} from '../../utils/sessionReminder/reminderStore.js';
import { REMINDER_NOTIFICATION_PREFIX } from '../../utils/sessionReminder/reminderNotify.js';
import type { StorageArea, StoragePort } from '../../utils/ports.js';

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

const NOW_MS = new Date(2026, 9, 24, 10, 0, 0).getTime();
const TODAY = '2026-10-24';

function makeDeps(overrides: Partial<Parameters<typeof createSessionReminderClickHandlers>[0]> = {}) {
  const local = new InMemoryStorageArea();
  const opened: string[] = [];
  const cleared: string[] = [];
  const appended: string[] = [];
  return {
    deps: {
      queryRecordById: vi.fn(async (recordId: number) =>
        recordId === 11
          ? { id: 11, url: 'https://example.com/p11', title: 'Page 11', masked_count: 0 }
          : null,
      ),
      openTab: (url: string) => {
        opened.push(url);
      },
      dismissNotification: (notificationId: string) => {
        cleared.push(notificationId);
      },
      appendTodoToDailyNote: async (todoLine: string) => {
        appended.push(todoLine);
      },
      storage: { local, session: new InMemoryStorageArea() } as StoragePort,
      clock: { now: () => NOW_MS },
      ...overrides,
    },
    opened,
    cleared,
    appended,
    local,
  };
}

function reminderId(recordId: number): string {
  return `${REMINDER_NOTIFICATION_PREFIX}${recordId}`;
}

describe('parseReminderRecordId', () => {
  it('parses a chrome-generated reminder id', () => {
    expect(parseReminderRecordId('session-reminder-42')).toBe(42);
  });

  it('rejects a foreign prefix, an empty suffix, and decorated numbers', () => {
    expect(parseReminderRecordId('privacy-confirm-aHR0cA')).toBeNull();
    expect(parseReminderRecordId('session-reminder-')).toBeNull();
    expect(parseReminderRecordId('session-reminder-007')).toBeNull();
    expect(parseReminderRecordId('session-reminder-4x')).toBeNull();
    expect(parseReminderRecordId('session-reminder--1')).toBeNull();
  });
});

describe('buildReminderTodoLine', () => {
  it('builds one checkbox line through the sanitize chain', () => {
    expect(buildReminderTodoLine('Deep dive', 'https://example.com/a(b)')).toBe(
      '- [ ] [Deep dive](https://example.com/a%28b%29)',
    );
  });

  it('escapes a title that would close the link early', () => {
    const line = buildReminderTodoLine('T](https://evil.example)', 'https://example.com/p');
    expect(line).toBe('- [ ] [T\\]\\(https://evil.example\\)](https://example.com/p)');
  });
});

describe('createSessionReminderClickHandlers — onClicked', () => {
  let harness: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    harness = makeDeps();
  });

  it('opens the record url and appends the TODO, then clears', async () => {
    const { deps, opened, appended, cleared } = harness;
    await createSessionReminderClickHandlers(deps).onClicked(reminderId(11));
    expect(opened).toEqual(['https://example.com/p11']);
    expect(appended).toEqual(['- [ ] [Page 11](https://example.com/p11)']);
    expect(cleared).toEqual([reminderId(11)]);
  });

  it('opens nothing for a foreign notification id', async () => {
    const { deps, opened, appended, cleared } = harness;
    await createSessionReminderClickHandlers(deps).onClicked('privacy-confirm-x');
    expect(opened).toEqual([]);
    expect(appended).toEqual([]);
    expect(cleared).toEqual([]);
    expect(deps.queryRecordById).not.toHaveBeenCalled();
  });

  it('opens nothing when the record is gone', async () => {
    const { deps, opened, cleared } = harness;
    await createSessionReminderClickHandlers(deps).onClicked(reminderId(99));
    expect(opened).toEqual([]);
    expect(cleared).toEqual([]);
  });

  it('never opens a 私物判定 record', async () => {
    const { deps, opened, cleared } = harness;
    const handlers = createSessionReminderClickHandlers({
      ...deps,
      queryRecordById: vi.fn(async () => ({ id: 11, url: 'https://example.com/p11', masked_count: 3 })),
    });
    await handlers.onClicked(reminderId(11));
    expect(opened).toEqual([]);
    expect(cleared).toEqual([]);
  });

  it('never opens a non-http(s) record url', async () => {
    const { deps, opened, cleared } = harness;
    const handlers = createSessionReminderClickHandlers({
      ...deps,
      queryRecordById: vi.fn(async () => ({ id: 11, url: 'javascript:alert(1)', masked_count: 0 })),
    });
    await handlers.onClicked(reminderId(11));
    expect(opened).toEqual([]);
    expect(cleared).toEqual([]);
  });

  it('keeps the notification when the Daily Note append fails (追記は追加動作)', async () => {
    const { deps, opened, appended, cleared } = harness;
    const handlers = createSessionReminderClickHandlers({
      ...deps,
      appendTodoToDailyNote: vi.fn(async () => {
        throw new Error('obsidian connection refused');
      }),
    });
    await handlers.onClicked(reminderId(11));
    expect(opened).toEqual(['https://example.com/p11']);
    expect(appended).toEqual([]);
    expect(cleared).toEqual([]);
  });
});

describe('createSessionReminderClickHandlers — onButtonClicked', () => {
  let harness: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    harness = makeDeps();
  });

  it('dismisses for the rest of the local day and clears', async () => {
    const { deps, local, cleared } = harness;
    await createSessionReminderClickHandlers(deps).onButtonClicked(reminderId(11), 0);
    const stored = await local.get<Record<string, { records?: Record<string, { kind: string; day?: string }> }>>([
      SESSION_REMINDER_STORAGE_KEY,
    ]);
    expect(stored[SESSION_REMINDER_STORAGE_KEY]?.records?.['11']).toEqual({
      kind: 'dismissed',
      day: TODAY,
    });
    expect(cleared).toEqual([reminderId(11)]);
  });

  it('discards permanently and clears', async () => {
    const { deps, local, cleared } = harness;
    await createSessionReminderClickHandlers(deps).onButtonClicked(reminderId(11), 1);
    const stored = await local.get<Record<string, { records?: Record<string, { kind: string }> }>>([
      SESSION_REMINDER_STORAGE_KEY,
    ]);
    expect(stored[SESSION_REMINDER_STORAGE_KEY]?.records?.['11']).toEqual({ kind: 'discarded' });
    expect(cleared).toEqual([reminderId(11)]);
  });

  it('keeps prior state and applies the transition on top', async () => {
    const { deps, local } = harness;
    await saveReminderState(
      local,
      dismissReminder(discardReminder({ lastFiredDay: null, records: {} }, 12), 13, TODAY),
    );
    await createSessionReminderClickHandlers(deps).onButtonClicked(reminderId(11), 0);
    const stored = await local.get<Record<string, { records?: Record<string, { kind: string }> }>>([
      SESSION_REMINDER_STORAGE_KEY,
    ]);
    expect(stored[SESSION_REMINDER_STORAGE_KEY]?.records?.['12']).toEqual({ kind: 'discarded' });
    expect(stored[SESSION_REMINDER_STORAGE_KEY]?.records?.['13']).toEqual({
      kind: 'dismissed',
      day: TODAY,
    });
    expect(stored[SESSION_REMINDER_STORAGE_KEY]?.records?.['11']).toEqual({
      kind: 'dismissed',
      day: TODAY,
    });
  });

  it('leaves the notification on screen when the state write fails', async () => {
    const { deps, cleared } = harness;
    const handlers = createSessionReminderClickHandlers({
      ...deps,
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {
            throw new Error('quota exceeded');
          },
          remove: async () => undefined,
        },
        session: new InMemoryStorageArea(),
      },
    });
    await handlers.onButtonClicked(reminderId(11), 0);
    expect(cleared).toEqual([]);
  });

  it('ignores an unknown button index and a foreign id', async () => {
    const { deps, cleared, local } = harness;
    await createSessionReminderClickHandlers(deps).onButtonClicked(reminderId(11), 2);
    await createSessionReminderClickHandlers(deps).onButtonClicked('privacy-confirm-x', 0);
    const stored = await local.get<Record<string, { records?: Record<string, unknown> }>>([
      SESSION_REMINDER_STORAGE_KEY,
    ]);
    expect(stored[SESSION_REMINDER_STORAGE_KEY]?.records?.['11']).toBeUndefined();
    expect(cleared).toEqual([]);
  });

  it('does not touch the record DB (buttons are store-only actions)', async () => {
    const { deps } = harness;
    await createSessionReminderClickHandlers(deps).onButtonClicked(reminderId(11), 0);
    expect(deps.queryRecordById).not.toHaveBeenCalled();
  });
});

describe('discard round-trip with the send path', () => {
  it('a discarded id is never a candidate again (isRecordEligible contract)', async () => {
    const { deps, local } = makeDeps();
    const handlers = createSessionReminderClickHandlers(deps);
    await handlers.onButtonClicked(reminderId(11), 1);
    const { isRecordEligible, loadReminderState } = await import(
      '../../utils/sessionReminder/reminderStore.js'
    );
    const state = await loadReminderState(local);
    expect(isRecordEligible(state, 11, TODAY, NOW_MS)).toBe(false);
  });
});
