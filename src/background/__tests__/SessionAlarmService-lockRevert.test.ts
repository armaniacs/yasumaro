/**
 * SessionAlarmService-lockRevert.test.ts — PBI 2026-11-08-07(5).
 *
 * Writing IS_LOCKED=true before the lock notification is confirmed leaves a
 * divergence when nobody confirms it: storage claims "locked" while every
 * context still acts unlocked. On an unconfirmed delivery the service reverts
 * the flag to false so the next timeout cycle re-locks and re-notifies.
 */
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { SessionAlarmService } from '../SessionAlarmService.js';
import type { Clock, StoragePort, StorageArea, AlarmPort } from '../../utils/ports.js';

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
  async create(): Promise<void> {}
  async clear(): Promise<void> {}
  async get(): Promise<undefined> {
    return undefined;
  }
  onAlarm(): void {}
}

const MASTER_PASSWORD_ENABLED_KEY = 'master_password_enabled';
const IS_LOCKED_KEY = 'is_locked';

describe('SessionAlarmService', () => {
  describe('lock flag revert on unconfirmed notification', () => {
    let clock: FakeClock;
    let storage: StoragePort;
    let sendMessage: ReturnType<typeof vi.fn>;
    let stepDelay: ReturnType<typeof vi.fn>;
    let service: SessionAlarmService;

    beforeEach(() => {
      clock = new FakeClock(1_000_000);
      storage = createInMemoryStoragePort();
      sendMessage = vi.fn().mockResolvedValue({ success: true });
      stepDelay = vi.fn(async () => {});
      service = new SessionAlarmService(
        new FakeAlarmPort(),
        clock,
        storage,
        sendMessage as unknown as ConstructorParameters<typeof SessionAlarmService>[3],
        stepDelay as unknown as ConstructorParameters<typeof SessionAlarmService>[4],
      );
    });

    async function expireSession(): Promise<void> {
      await storage.local.set({
        [MASTER_PASSWORD_ENABLED_KEY]: true,
        session_last_activity: clock.now(),
      });
      clock.advance(31 * 60 * 1000);
      await service.checkTimeout();
    }

    test('reverts IS_LOCKED to false when no context confirms the lock', async () => {
      sendMessage.mockResolvedValue(undefined);

      await expireSession();

      expect(sendMessage).toHaveBeenCalledTimes(3);
      const result = await storage.local.get<Record<string, boolean>>([IS_LOCKED_KEY]);
      expect(result[IS_LOCKED_KEY]).toBe(false);
      const { logError } = await import('../../utils/logger/api.js');
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('never confirmed'),
        expect.objectContaining({ confirmed: false }),
        expect.any(String),
        expect.any(String),
      );
    });

    test('keeps IS_LOCKED true when the notification is confirmed', async () => {
      sendMessage.mockResolvedValue({ success: true });

      await expireSession();

      expect(sendMessage).toHaveBeenCalledTimes(1);
      const result = await storage.local.get<Record<string, boolean>>([IS_LOCKED_KEY]);
      expect(result[IS_LOCKED_KEY]).toBe(true);
    });

    test('still reports the unconfirmed delivery when the revert write itself fails', async () => {
      sendMessage.mockResolvedValue(undefined);
      const area = storage.local;
      const realSet = area.set.bind(area);
      area.set = async (items: Record<string, unknown>): Promise<void> => {
        // Only the revert (IS_LOCKED=false) fails; the lock write succeeds.
        if (IS_LOCKED_KEY in items && items[IS_LOCKED_KEY] === false) {
          throw new Error('storage unavailable');
        }
        await realSet(items);
      };

      await expireSession();

      const result = await storage.local.get<Record<string, boolean>>([IS_LOCKED_KEY]);
      expect(result[IS_LOCKED_KEY]).toBe(true);
      const { logError, logWarn } = await import('../../utils/logger/api.js');
      expect(logWarn).toHaveBeenCalledWith(
        expect.stringContaining('revert'),
        expect.anything(),
        undefined,
        expect.any(String),
      );
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('never confirmed'),
        expect.objectContaining({ confirmed: false }),
        expect.any(String),
        expect.any(String),
      );
    });
    test('retries the lock on the next timeout check after an unconfirmed revert', async () => {
      sendMessage.mockResolvedValue(undefined);

      await expireSession();

      expect(sendMessage).toHaveBeenCalledTimes(3);
      const reverted = await storage.local.get<Record<string, boolean>>([IS_LOCKED_KEY]);
      expect(reverted[IS_LOCKED_KEY]).toBe(false);

      // Next periodic cycle: the delivery is confirmed this time, so the
      // re-attempted lock sticks. This pins the revert -> refire -> relock
      // chain the revert comment relies on.
      sendMessage.mockResolvedValue({ success: true });
      clock.advance(31 * 60 * 1000);
      await service.checkTimeout();

      expect(sendMessage).toHaveBeenCalledTimes(4);
      const relocked = await storage.local.get<Record<string, boolean>>([IS_LOCKED_KEY]);
      expect(relocked[IS_LOCKED_KEY]).toBe(true);
    });
  });
});
