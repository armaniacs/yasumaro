/**
 * RateLimitService-cas.test.ts
 * PBI 2026-11-27-08 (CWE-367 hardening): the failed-attempt counter write goes
 * through the storageTransaction CAS, so concurrent recordFailedAttempt calls
 * can no longer lose an increment — an undercount would stretch the
 * brute-force budget. The retry wait is the service's own no-op seam, so the
 * conflict path spends no wall time.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { RateLimitService } from '../RateLimitService.js';
import type { Clock, StoragePort, StorageArea } from '../ports.js';

const ATTEMPTS_KEY = 'passwordFailedAttempts';
const FIRST_KEY = 'firstFailedAttemptTime';

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

/**
 * Deterministic interleaving without real-time waits: the next get() that
 * asks for a CAS version key returns the PRE-concurrent-write snapshot after
 * the test releases the gate, reproducing the lost-update interleaving
 * (writer A reads, writer B commits, A writes) under test control.
 */
class GatedStorageArea extends InMemoryStorageArea {
  private blocked: Promise<void> = Promise.resolve();
  private resolveBlocked: (() => void) | null = null;
  private armed = false;

  holdNextVersionRead(): void {
    this.blocked = new Promise<void>((resolve) => {
      this.resolveBlocked = resolve;
    });
    this.armed = true;
  }

  releaseGate(): void {
    this.resolveBlocked?.();
    this.resolveBlocked = null;
    this.armed = false;
  }

  override async get<T extends Record<string, unknown>>(keys: string[]): Promise<Partial<T>> {
    const snapshot = await super.get<T>(keys);
    if (keys.some((k) => k.endsWith('_version')) && this.armed) {
      // One-shot: the resolver stays reachable for releaseGate(), only the
      // armed flag marks the gate as consumed.
      this.armed = false;
      await this.blocked;
    }
    return snapshot;
  }
}

class FakeClock implements Clock {
  constructor(private time: number) {}
  now(): number {
    return this.time;
  }
}

describe('RateLimitService CAS counter write (PBI 2026-11-27-08)', () => {
  let clock: FakeClock;
  let local: GatedStorageArea;
  let session: InMemoryStorageArea;
  let service: RateLimitService;

  beforeEach(() => {
    clock = new FakeClock(1_000_000);
    local = new GatedStorageArea();
    session = new InMemoryStorageArea();
    service = new RateLimitService(clock, { session, local });
  });

  test('recovers the increment a concurrent writer commits mid-read (no lost update)', async () => {
    // Old read-then-write behavior: both writers compute 0+1 and the count
    // lands at 1 despite two failures. The CAS retry re-derives from the
    // committed state instead.
    local.holdNextVersionRead();
    const first = service.recordFailedAttempt();
    await service.recordFailedAttempt();
    local.releaseGate();
    await first;

    const localData = await local.get<Record<string, number>>([ATTEMPTS_KEY]);
    const sessionData = await session.get<Record<string, number>>([ATTEMPTS_KEY]);
    expect(localData[ATTEMPTS_KEY]).toBe(2);
    expect(sessionData[ATTEMPTS_KEY]).toBe(2);
  });

  test('converges two concurrent recordFailedAttempt calls to two increments', async () => {
    await Promise.all([service.recordFailedAttempt(), service.recordFailedAttempt()]);

    const localData = await local.get<Record<string, number>>([ATTEMPTS_KEY]);
    const sessionData = await session.get<Record<string, number>>([ATTEMPTS_KEY]);
    expect(localData[ATTEMPTS_KEY]).toBe(2);
    expect(sessionData[ATTEMPTS_KEY]).toBe(2);
  });

  test('writes CAS version companions next to the counters and advances them', async () => {
    await service.recordFailedAttempt();
    const afterFirst = await local.get<Record<string, number>>([
      `${ATTEMPTS_KEY}_version`,
      `${FIRST_KEY}_version`,
    ]);
    expect(afterFirst[`${ATTEMPTS_KEY}_version`]).toBe(1);
    expect(afterFirst[`${FIRST_KEY}_version`]).toBe(1);

    await service.recordFailedAttempt();
    const afterSecond = await local.get<Record<string, number>>([
      `${ATTEMPTS_KEY}_version`,
      `${FIRST_KEY}_version`,
    ]);
    expect(afterSecond[`${ATTEMPTS_KEY}_version`]).toBe(2);
    expect(afterSecond[`${FIRST_KEY}_version`]).toBe(2);
  });

  test('keeps merged max+1 semantics when session holds the higher counter (crash divergence)', async () => {
    // An older SW death between the two store writes can leave session > local;
    // the counter must still move to merged max + 1 in BOTH stores.
    await local.set({ [ATTEMPTS_KEY]: 4, [FIRST_KEY]: clock.now() });
    await session.set({ [ATTEMPTS_KEY]: 5, [FIRST_KEY]: clock.now() });

    await service.recordFailedAttempt();

    const localData = await local.get<Record<string, number>>([ATTEMPTS_KEY]);
    const sessionData = await session.get<Record<string, number>>([ATTEMPTS_KEY]);
    expect(localData[ATTEMPTS_KEY]).toBe(6);
    expect(sessionData[ATTEMPTS_KEY]).toBe(6);
  });

  test('clears the CAS version companions in resetFailedAttempts', async () => {
    await service.recordFailedAttempt();
    await service.recordFailedAttempt();

    await service.resetFailedAttempts();

    const versions = await local.get<Record<string, number>>([
      `${ATTEMPTS_KEY}_version`,
      `${FIRST_KEY}_version`,
    ]);
    expect(versions[`${ATTEMPTS_KEY}_version`]).toBeUndefined();
    expect(versions[`${FIRST_KEY}_version`]).toBeUndefined();
  });
});
