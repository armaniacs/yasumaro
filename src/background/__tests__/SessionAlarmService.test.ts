/**
 * SessionAlarmService.test.ts
 * SessionAlarmService (AlarmPort + Clock + StoragePort 注入) のテスト。
 * chrome global mock なしに自動ロック判定を純粋テストする。
 */


import { describe, test, expect, beforeEach, vi } from 'vitest';
import { SessionAlarmService } from '../SessionAlarmService.js';
import type { Clock, StoragePort, StorageArea, AlarmPort } from '../../utils/ports.js';

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
    sendMessage = vi.fn().mockResolvedValue(undefined);
    stepDelay = vi.fn<ConstructorParameters<typeof SessionAlarmService>[4]>(async () => {});
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

  test('drives the SESSION_LOCK_REQUEST retry wait through the injected delay and succeeds on the third attempt', async () => {
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
