/**
 * SessionAlarmService.test.ts
 * SessionAlarmService (AlarmPort + Clock + StoragePort 注入) のテスト。
 * chrome global mock なしに自動ロック判定を純粋テストする。
 */


import { describe, test, expect, beforeEach, vi } from 'vitest';
import { SessionAlarmService } from '../SessionAlarmService.js';
import type { Clock, StoragePort, StorageArea, AlarmPort } from '../../utils/ports.js';

// PBI 2026-10-18-20: the unconfirmed-delivery failure log is the observable
// contract of BDD scenario 3 (no silent success). Wrap the real logger in
// spies so tests can assert on it without changing logger behavior.
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
  private data = new Map<string, unknown>();

  async get<T extends Record<string, unknown>>(keys: string[]): Promise<Partial<T>> {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (this.data.has(key)) {
        result[key] = this.data.get(key);
      }
    }
    return result as Partial<T>;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) {
      this.data.set(key, value);
    }
  }

  async remove(keys: string[]): Promise<void> {
    for (const key of keys) {
      this.data.delete(key);
    }
  }
}

function createInMemoryStoragePort(): StoragePort {
  return { local: new InMemoryStorageArea(), session: new InMemoryStorageArea() };
}

class FakeClock implements Clock {
  constructor(private time: number) {}
  now(): number {
    return this.time;
  }
  advance(ms: number): void {
    this.time += ms;
  }
}

class FakeAlarmPort implements AlarmPort {
  created: { name: string; alarmInfo: chrome.alarms.AlarmCreateInfo }[] = [];
  cleared: string[] = [];
  private listeners: ((alarm: { name: string }) => void)[] = [];

  async create(name: string, alarmInfo: chrome.alarms.AlarmCreateInfo): Promise<void> {
    this.created.push({ name, alarmInfo });
  }

  async clear(name: string): Promise<void> {
    this.cleared.push(name);
  }

  onAlarm(listener: (alarm: { name: string }) => void): void {
    this.listeners.push(listener);
  }

  get listenerCount(): number {
    return this.listeners.length;
  }
}

const MASTER_PASSWORD_ENABLED_KEY = 'master_password_enabled';
const IS_LOCKED_KEY = 'is_locked';

describe('SessionAlarmService', () => {
  let clock: FakeClock;
  let storage: StoragePort;
  let alarms: FakeAlarmPort;
  let sendMessage: ReturnType<typeof vi.fn>;
  let stepDelay: ReturnType<typeof vi.fn<NonNullable<ConstructorParameters<typeof SessionAlarmService>[4]>>>;
  let service: SessionAlarmService;

  beforeEach(() => {
    clock = new FakeClock(1_000_000);
    storage = createInMemoryStoragePort();
    alarms = new FakeAlarmPort();
    // PBI 2026-10-18-20: success is judged by the response body, so the base
    // fake is a confirming receiver ({ success: true }, the response contract
    // in messaging/types.ts). Tests that need the receiver-less or rejecting
    // shape override below.
    sendMessage = vi.fn().mockResolvedValue({ success: true });
    stepDelay = vi.fn<Exclude<ConstructorParameters<typeof SessionAlarmService>[4], undefined>>(async () => {});
    service = new SessionAlarmService(
      alarms,
      clock,
      storage,
      sendMessage as unknown as ConstructorParameters<typeof SessionAlarmService>[3],
      stepDelay
    );
  });

  test('startTimeoutChecker creates the alarm and never registers its own alarm listener', async () => {
    await service.startTimeoutChecker();
    await service.startTimeoutChecker();

    expect(alarms.created).toHaveLength(2);
    // alarmRegistry is the single dispatch path; a listener here would run
    // checkTimeout a second time on every firing.
    expect(alarms.listenerCount).toBe(0);
  });

  test('stopTimeoutChecker clears the alarm', async () => {
    await service.startTimeoutChecker();
    await service.stopTimeoutChecker();

    expect(alarms.cleared).toContain('check_session_timeout');
  });

  test('updateActivity saves the last activity timestamp', async () => {
    await service.updateActivity();

    const result = await storage.local.get<Record<string, number>>(['session_last_activity']);
    expect(result.session_last_activity).toBe(clock.now());
  });

  test('does not lock on timeout when no master password is set', async () => {
    await storage.local.set({ session_last_activity: clock.now() });
    await service.startTimeoutChecker();

    clock.advance(31 * 60 * 1000);
    await service.checkTimeout();
    expect(sendMessage).not.toHaveBeenCalled();
    const result = await storage.local.get<Record<string, boolean>>([IS_LOCKED_KEY]);
    expect(result[IS_LOCKED_KEY]).toBeUndefined();
  });

  test('calls lockSession and sends a lock notification after 30 minutes', async () => {
    await storage.local.set({
      [MASTER_PASSWORD_ENABLED_KEY]: true,
      session_last_activity: clock.now(),
    });
    await service.startTimeoutChecker();

    clock.advance(31 * 60 * 1000);
    await service.checkTimeout();

    const result = await storage.local.get<Record<string, boolean>>([IS_LOCKED_KEY]);
    expect(result[IS_LOCKED_KEY]).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  test('retries 3 times when the lock notification fails', async () => {
    sendMessage.mockRejectedValue(new Error('no receiver'));
    await storage.local.set({
      [MASTER_PASSWORD_ENABLED_KEY]: true,
      session_last_activity: clock.now(),
    });
    await service.startTimeoutChecker();

    clock.advance(31 * 60 * 1000);
    await service.checkTimeout();

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(stepDelay).toHaveBeenCalledTimes(2);
    expect(stepDelay).toHaveBeenNthCalledWith(1, 100);
    expect(stepDelay).toHaveBeenNthCalledWith(2, 100);
  });

  test('drives the SESSION_LOCK_REQUEST retry wait through the injected delay and succeeds when the third attempt confirms delivery', async () => {
    // PBI 2026-10-18-20: the success criterion changed from "sendMessage
    // resolved" to "the response body confirms receipt ({ success: true })".
    // The third attempt must therefore answer with the confirming body
    // instead of a bare resolution, so the base fake now provides it after
    // the two rejections (the old mock resolved with undefined, which the new
    // criterion treats as an unconfirmed receiver-less delivery).
    sendMessage
      .mockRejectedValueOnce(new Error('no receiver'))
      .mockRejectedValueOnce(new Error('no receiver'));
    await storage.local.set({
      [MASTER_PASSWORD_ENABLED_KEY]: true,
      session_last_activity: clock.now(),
    });
    await service.startTimeoutChecker();

    clock.advance(31 * 60 * 1000);
    await service.checkTimeout();

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: 'SESSION_LOCK_REQUEST' })
    );
    expect(sendMessage).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ type: 'SESSION_LOCK_REQUEST' })
    );
    // The ceiling itself schedules no timer: waits happen only between attempts.
    expect(stepDelay).toHaveBeenCalledTimes(2);
    expect(stepDelay).toHaveBeenNthCalledWith(1, 100);
    expect(stepDelay).toHaveBeenNthCalledWith(2, 100);
  });

  test('treats a receiver-less resolution (undefined response) as unconfirmed and ends in an explicit failure log', async () => {
    // PBI 2026-10-18-20, BDD scenario 3: Chrome resolves a receiver-less
    // sendMessage with undefined (and the sender's own onMessage never fires,
    // the same platform fact recorded in privacyConsent.ts), so the old
    // "resolved = success" marked a lock nobody applied. The unconfirmed send
    // must retry to the ceiling and leave the observable failure log instead
    // of a silent success.
    sendMessage.mockResolvedValue(undefined);
    await storage.local.set({
      [MASTER_PASSWORD_ENABLED_KEY]: true,
      session_last_activity: clock.now(),
    });
    await service.startTimeoutChecker();

    clock.advance(31 * 60 * 1000);
    await service.checkTimeout();

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(stepDelay).toHaveBeenCalledTimes(2);
    const { logError } = await import('../../utils/logger/api.js');
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('never confirmed'),
      expect.objectContaining({ confirmed: false }),
      expect.any(String),
      expect.any(String)
    );
  });

  test('treats a { success: false } response body as unconfirmed', async () => {
    // PBI 2026-10-18-20, unit strategy: the three response shapes
    // (undefined / { success: true } / { success: false }) pin that the
    // success decision reads the response body, not the resolution.
    sendMessage.mockResolvedValue({ success: false });
    await storage.local.set({
      [MASTER_PASSWORD_ENABLED_KEY]: true,
      session_last_activity: clock.now(),
    });
    await service.startTimeoutChecker();

    clock.advance(31 * 60 * 1000);
    await service.checkTimeout();

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(stepDelay).toHaveBeenCalledTimes(2);
    const { logError } = await import('../../utils/logger/api.js');
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('never confirmed'),
      expect.objectContaining({ confirmed: false }),
      expect.any(String),
      expect.any(String)
    );
  });

  test('stops after the first attempt when the response body confirms receipt', async () => {
    // PBI 2026-10-18-20, BDD scenario 5: a context with a
    // SESSION_LOCK_REQUEST handler answers { success: true }, so one attempt
    // suffices and no retry wait is scheduled.
    sendMessage.mockResolvedValue({ success: true });
    await storage.local.set({
      [MASTER_PASSWORD_ENABLED_KEY]: true,
      session_last_activity: clock.now(),
    });
    await service.startTimeoutChecker();

    clock.advance(31 * 60 * 1000);
    await service.checkTimeout();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(stepDelay).not.toHaveBeenCalled();
    const { logError } = await import('../../utils/logger/api.js');
    expect(logError).not.toHaveBeenCalled();
  });

  test('does not lock when the timeout has not elapsed', async () => {
    await storage.local.set({
      [MASTER_PASSWORD_ENABLED_KEY]: true,
      session_last_activity: clock.now(),
    });
    await service.startTimeoutChecker();

    clock.advance(10 * 60 * 1000); // 10分のみ経過
    await service.checkTimeout();

    const result = await storage.local.get<Record<string, boolean>>([IS_LOCKED_KEY]);
    expect(result[IS_LOCKED_KEY]).toBeUndefined();
  });

  test('initialize calls startTimeoutChecker', async () => {
    await service.initialize();

    expect(alarms.created).toHaveLength(1);
  });
});
