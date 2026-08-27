/**
 * SessionAlarmService.test.ts
 * SessionAlarmService (AlarmPort + Clock + StoragePort 注入) のテスト。
 * chrome global mock なしに自動ロック・アラーム二重登録防止を純粋テストする。
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
  created: { name: string; alarmInfo: { periodInMinutes?: number } }[] = [];
  cleared: string[] = [];
  private listeners: ((alarm: { name: string }) => void)[] = [];

  async create(name: string, alarmInfo: { periodInMinutes?: number }): Promise<void> {
    this.created.push({ name, alarmInfo });
  }

  async clear(name: string): Promise<void> {
    this.cleared.push(name);
  }

  onAlarm(listener: (alarm: { name: string }) => void): void {
    this.listeners.push(listener);
  }

  fire(name: string): void {
    for (const listener of this.listeners) {
      listener({ name });
    }
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
  let service: SessionAlarmService;

  beforeEach(() => {
    clock = new FakeClock(1_000_000);
    storage = createInMemoryStoragePort();
    alarms = new FakeAlarmPort();
    sendMessage = vi.fn().mockResolvedValue(undefined);
    service = new SessionAlarmService(alarms, clock, storage, sendMessage);
  });

  test('startTimeoutChecker はアラームを作成しリスナーを1つだけ登録する', async () => {
    await service.startTimeoutChecker();
    await service.startTimeoutChecker(); // 2回呼んでも重複登録しない

    expect(alarms.created).toHaveLength(2);
    expect(alarms.listenerCount).toBe(1);
  });

  test('stopTimeoutChecker はアラームをクリアする', async () => {
    await service.startTimeoutChecker();
    await service.stopTimeoutChecker();

    expect(alarms.cleared).toContain('check_session_timeout');
  });

  test('updateActivity は最終アクティビティ時刻を保存する', async () => {
    await service.updateActivity();

    const result = await storage.local.get<Record<string, number>>(['session_last_activity']);
    expect(result.session_last_activity).toBe(clock.now());
  });

  test('マスターパスワード未設定の場合はタイムアウトしてもロックしない', async () => {
    await storage.local.set({ session_last_activity: clock.now() });
    await service.startTimeoutChecker();

    clock.advance(31 * 60 * 1000);
    alarms.fire('check_session_timeout');
    await vi.waitFor(() => expect(sendMessage).not.toHaveBeenCalled());

    const result = await storage.local.get<Record<string, boolean>>([IS_LOCKED_KEY]);
    expect(result[IS_LOCKED_KEY]).toBeUndefined();
  });

  test('30分経過するとlockSessionが呼ばれ、ロック通知が送信される', async () => {
    await storage.local.set({
      [MASTER_PASSWORD_ENABLED_KEY]: true,
      session_last_activity: clock.now(),
    });
    await service.startTimeoutChecker();

    clock.advance(31 * 60 * 1000);
    alarms.fire('check_session_timeout');

    await vi.waitFor(async () => {
      const result = await storage.local.get<Record<string, boolean>>([IS_LOCKED_KEY]);
      expect(result[IS_LOCKED_KEY]).toBe(true);
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  test('ロック通知が失敗した場合は3回リトライする', async () => {
    sendMessage.mockRejectedValue(new Error('no receiver'));
    await storage.local.set({
      [MASTER_PASSWORD_ENABLED_KEY]: true,
      session_last_activity: clock.now(),
    });
    await service.startTimeoutChecker();

    clock.advance(31 * 60 * 1000);
    alarms.fire('check_session_timeout');

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(3));
  });

  test('タイムアウト未経過の場合はロックしない', async () => {
    await storage.local.set({
      [MASTER_PASSWORD_ENABLED_KEY]: true,
      session_last_activity: clock.now(),
    });
    await service.startTimeoutChecker();

    clock.advance(10 * 60 * 1000); // 10分のみ経過
    alarms.fire('check_session_timeout');
    await Promise.resolve();

    const result = await storage.local.get<Record<string, boolean>>([IS_LOCKED_KEY]);
    expect(result[IS_LOCKED_KEY]).toBeUndefined();
  });

  test('initialize は startTimeoutChecker を呼ぶ', async () => {
    await service.initialize();

    expect(alarms.created).toHaveLength(1);
  });
});
