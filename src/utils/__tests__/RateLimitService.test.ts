/**
 * RateLimitService.test.ts
 * RateLimitService (Clock + StoragePort injected) のテスト。
 * chrome global mock なしに NTP skew / 二重ロック挙動を純粋テストする。
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimitService, RATE_LIMIT_WRITE_COALESCE_MS } from '../RateLimitService.js';
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

class CountingStorageArea extends InMemoryStorageArea {
  setCalls = 0;
  override async set(items: Record<string, unknown>): Promise<void> {
    this.setCalls++;
    await super.set(items);
  }
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

  test('allows the first auth attempt', async () => {
    const result = await service.checkRateLimit();
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test('locks for 30 minutes after 5 failures', async () => {
    for (let i = 0; i < 5; i++) {
      await service.recordFailedAttempt();
    }

    const result = await service.checkRateLimit();

    expect(result.success).toBe(false);
    expect(result.error).toContain('30 minutes');
  });

  test('keeps checkRateLimit failing while locked', async () => {
    for (let i = 0; i < 5; i++) {
      await service.recordFailedAttempt();
    }
    await service.checkRateLimit(); // establishes lockedUntil

    clock.advance(10 * 60 * 1000); // 10分経過、まだロック中
    const result = await service.checkRateLimit();

    expect(result.success).toBe(false);
  });

  test('passes checkRateLimit after the lock expires', async () => {
    for (let i = 0; i < 5; i++) {
      await service.recordFailedAttempt();
    }
    await service.checkRateLimit(); // establishes lockedUntil at now + 30min

    clock.advance(30 * 60 * 1000 + 1);
    const result = await service.checkRateLimit();

    expect(result.success).toBe(true);
  });

  test('resets the failure count after the 5-minute evaluation window', async () => {
    for (let i = 0; i < 4; i++) {
      await service.recordFailedAttempt();
    }
    clock.advance(5 * 60 * 1000 + 1);
    await service.recordFailedAttempt();

    const result = await service.checkRateLimit();
    expect(result.success).toBe(true);
  });

  test('clears failures and the lock in resetFailedAttempts', async () => {
    for (let i = 0; i < 5; i++) {
      await service.recordFailedAttempt();
    }
    await service.checkRateLimit();

    await service.resetFailedAttempts();
    const result = await service.checkRateLimit();

    expect(result.success).toBe(true);
  });

  test('NTP skew: adopts the later lockedUntil of local and session (double lock)', async () => {
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
  test('persists recordFailedAttempt to local so it survives a session clear', async () => {
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

  test('adopts the larger attempts count of session and local in checkRateLimit', async () => {
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

  test('clears the local counter in resetFailedAttempts', async () => {
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

describe('RateLimitService 書き込み合体 (PBI-17)', () => {
  let clock: FakeClock;
  let session: CountingStorageArea;
  let local: CountingStorageArea;
  let service: RateLimitService;

  beforeEach(() => {
    vi.useFakeTimers();
    clock = new FakeClock(1_000_000);
    session = new CountingStorageArea();
    local = new CountingStorageArea();
    service = new RateLimitService(clock, { session, local });
  });

  afterEach(async () => {
    await service.flushPendingWrites();
    vi.useRealTimers();
  });

  test('coalesces writes from consecutive failed attempts', async () => {
    await service.recordFailedAttempt();
    await service.recordFailedAttempt();
    await service.recordFailedAttempt();

    // 合体ウィンドウ内はストレージ書き込みが発生しない
    expect(session.setCalls).toBe(0);
    expect(local.setCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(RATE_LIMIT_WRITE_COALESCE_MS);

    // 最終値のみ1回ずつ書き込まれる
    expect(session.setCalls).toBe(1);
    expect(local.setCalls).toBe(1);
    const sessionData = await session.get<{ passwordFailedAttempts: number; firstFailedAttemptTime: number }>([
      'passwordFailedAttempts',
      'firstFailedAttemptTime',
    ]);
    expect(sessionData.passwordFailedAttempts).toBe(3);
    expect(sessionData.firstFailedAttemptTime).toBe(1_000_000);
  });

  test('flushes both stores immediately on lockout without delay', async () => {
    for (let i = 0; i < 4; i++) {
      await service.recordFailedAttempt();
    }
    expect(session.setCalls).toBe(0);

    await service.recordFailedAttempt();

    // タイマーを進めなくても5回目で即時書き込まれる
    expect(session.setCalls).toBe(1);
    expect(local.setCalls).toBe(1);

    const result = await service.checkRateLimit();
    expect(result.success).toBe(false);
    const sessionLock = await session.get<{ lockedUntil: number }>(['lockedUntil']);
    const localLock = await local.get<{ lockedUntil: number }>(['lockedUntil']);
    expect(sessionLock.lockedUntil).toBe(1_000_000 + 30 * 60 * 1000);
    expect(localLock.lockedUntil).toBe(1_000_000 + 30 * 60 * 1000);
  });

  test('reads the latest in-memory value in checkRateLimit during debounce', async () => {
    await session.set({ passwordFailedAttempts: 4, firstFailedAttemptTime: clock.now() });
    await local.set({ passwordFailedAttempts: 4, firstFailedAttemptTime: clock.now() });
    session.setCalls = 0;
    local.setCalls = 0;

    // 5回目: 閾値到達で即時フラッシュされるが、check がタイマー待ちなくロックアウトする
    await service.recordFailedAttempt();
    const result = await service.checkRateLimit();

    expect(result.success).toBe(false);
    expect(result.error).toContain('30 minutes');
  });

  test('discards pending writes in resetFailedAttempts without resurrecting them', async () => {
    await service.recordFailedAttempt();
    await service.recordFailedAttempt();
    await service.resetFailedAttempts();

    await vi.advanceTimersByTimeAsync(RATE_LIMIT_WRITE_COALESCE_MS);

    expect(session.setCalls).toBe(0);
    expect(local.setCalls).toBe(0);
    const result = await service.checkRateLimit();
    expect(result.success).toBe(true);
  });
});
