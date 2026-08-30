/**
 * RateLimitService.test.ts
 * RateLimitService (Clock + StoragePort injected) のテスト。
 * chrome global mock なしに NTP skew / 二重ロック挙動を純粋テストする。
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { RateLimitService } from '../RateLimitService.js';
import type { Clock, StoragePort, StorageArea } from '../ports.js';

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

describe('RateLimitService', () => {
  let clock: FakeClock;
  let storage: StoragePort;
  let service: RateLimitService;

  beforeEach(() => {
    clock = new FakeClock(1_000_000);
    storage = createInMemoryStoragePort();
    service = new RateLimitService(clock, storage);
  });

  test('初回認証は許可される', async () => {
    const result = await service.checkRateLimit();
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('5回失敗すると30分ロックされる', async () => {
    for (let i = 0; i < 5; i++) {
      await service.recordFailedAttempt();
    }

    const result = await service.checkRateLimit();

    expect(result.success).toBe(false);
    expect(result.error).toContain('30 minutes');
  });

  test('ロック中はcheckRateLimitが失敗し続ける', async () => {
    for (let i = 0; i < 5; i++) {
      await service.recordFailedAttempt();
    }
    await service.checkRateLimit(); // establishes lockedUntil

    clock.advance(10 * 60 * 1000); // 10分経過、まだロック中
    const result = await service.checkRateLimit();

    expect(result.success).toBe(false);
  });

  test('ロック期間経過後はcheckRateLimitが成功する', async () => {
    for (let i = 0; i < 5; i++) {
      await service.recordFailedAttempt();
    }
    await service.checkRateLimit(); // establishes lockedUntil at now + 30min

    clock.advance(30 * 60 * 1000 + 1);
    const result = await service.checkRateLimit();

    expect(result.success).toBe(true);
  });

  test('評価ウインドウ(5分)経過後は失敗回数がリセットされる', async () => {
    for (let i = 0; i < 4; i++) {
      await service.recordFailedAttempt();
    }
    clock.advance(5 * 60 * 1000 + 1);
    await service.recordFailedAttempt();

    const result = await service.checkRateLimit();
    expect(result.success).toBe(true);
  });

  test('resetFailedAttemptsは失敗回数とロックをクリアする', async () => {
    for (let i = 0; i < 5; i++) {
      await service.recordFailedAttempt();
    }
    await service.checkRateLimit();

    await service.resetFailedAttempts();
    const result = await service.checkRateLimit();

    expect(result.success).toBe(true);
  });

  test('NTP skew: local と session の lockedUntil の大きい方を採用する (二重ロック)', async () => {
    // session storage に古いロック解除時刻、local storage に新しいロック解除時刻を直接注入し、
    // max(session, local) が使われることを検証する。
    const futureLocal = clock.now() + 20 * 60 * 1000;
    const pastSession = clock.now() - 1000;
    await storage.local.set({ lockedUntil: futureLocal });
    await storage.session.set({ lockedUntil: pastSession });

    const result = await service.checkRateLimit();

    expect(result.success).toBe(false);
  });

  // M3: local 永続化 — session clear でもカウンタが継続すること
  test('recordFailedAttempt は local にも永続化され、session clear 後も継続する', async () => {
    for (let i = 0; i < 3; i++) {
      await service.recordFailedAttempt();
    }

    // session をクリアしても local に残る
    await storage.session.remove(['passwordFailedAttempts', 'firstFailedAttemptTime']);

    // さらに2回失敗を追加（local の3回 + 新たに2回 = 5回相当）
    await service.recordFailedAttempt();
    await service.recordFailedAttempt();

    // local には 5回蓄積されているはず
    const localData = await storage.local.get<{ passwordFailedAttempts: number }>(['passwordFailedAttempts']);
    expect(localData.passwordFailedAttempts).toBe(5);

    const result = await service.checkRateLimit();
    expect(result.success).toBe(false);
  });

  test('checkRateLimit は session と local の attempts の大きい方を採用する', async () => {
    // attacker が session だけクリアしても local が残るケース
    await storage.local.set({ passwordFailedAttempts: 4, firstFailedAttemptTime: clock.now() });
    await storage.session.set({ passwordFailedAttempts: 1, firstFailedAttemptTime: clock.now() });

    // 1回追加 -> max(4,1)+1 =5
    await service.recordFailedAttempt();

    const sessionAfter = await storage.session.get<{ passwordFailedAttempts: number }>(['passwordFailedAttempts']);
    const localAfter = await storage.local.get<{ passwordFailedAttempts: number }>(['passwordFailedAttempts']);
    expect(sessionAfter.passwordFailedAttempts).toBe(5);
    expect(localAfter.passwordFailedAttempts).toBe(5);
  });

  test('resetFailedAttempts は local のカウンタもクリアする', async () => {
    for (let i = 0; i < 5; i++) {
      await service.recordFailedAttempt();
    }
    await service.checkRateLimit(); // lock

    await service.resetFailedAttempts();

    const localData = await storage.local.get<{ passwordFailedAttempts: number; lockedUntil: number }>([
      'passwordFailedAttempts',
      'lockedUntil',
    ]);
    const sessionData = await storage.session.get<{ passwordFailedAttempts: number; lockedUntil: number }>([
      'passwordFailedAttempts',
      'lockedUntil',
    ]);

    expect(localData.passwordFailedAttempts).toBeUndefined();
    expect(localData.lockedUntil).toBeUndefined();
    expect(sessionData.passwordFailedAttempts).toBeUndefined();
    expect(sessionData.lockedUntil).toBeUndefined();
  });
});
