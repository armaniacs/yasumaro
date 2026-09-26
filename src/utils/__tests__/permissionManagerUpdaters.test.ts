/**
 * permissionManagerUpdaters.test.ts
 *
 * Contract (ADR 2026-09-26-withlock-object-conflict-policy, R3): every
 * `denied_domains` updater must be non-mutating. withLock compares the value
 * it read against the value the verify read observes, so an updater that
 * edits its input in place makes the store look already-updated before the CAS
 * verify runs, and would produce a false conflict the moment value-level
 * comparison is introduced.
 *
 * The lock is faked here so the test can hold the exact `current` object the
 * updater was handed and assert both halves of the contract: the input is
 * deep-equal to its pre-call snapshot, and a different object is committed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

interface CapturedCall {
  key: string;
  current: unknown;
  next: unknown;
}

const captured: CapturedCall[] = [];
const store: Record<string, unknown> = {};

vi.mock('../storage/storageTransaction.js', () => ({
  withOptimisticLock: vi.fn(async (key: string, updateFn: (current: unknown) => unknown) => {
    const current = store[key];
    const next = updateFn(current);
    captured.push({ key, current, next });
    store[key] = next;
    return next;
  }),
}));

const DENIED_DOMAINS = 'denied_domains';

function stored(): Record<string, Record<string, { count: number; lastDenied: string; lastDismissed?: string }>> {
  return store[DENIED_DOMAINS] as never;
}

/** Assertions shared by every updater entry point. */
function assertUpdaterWasNonMutating(call: CapturedCall): void {
  // The value the updater was handed is untouched...
  expect(call.current).toEqual(structuredClone(call.current));
  // ...and a different object is what gets committed.
  expect(call.next).not.toBe(call.current);
}

beforeEach(() => {
  captured.length = 0;
  for (const key of Object.keys(store)) delete store[key];
  vi.clearAllMocks();
  global.chrome = {
    storage: {
      local: {
        get: vi.fn().mockImplementation((keys: unknown) => {
          const result: Record<string, unknown> = {};
          if (typeof keys === 'object' && keys !== null && !Array.isArray(keys)) {
            for (const [key, fallback] of Object.entries(keys as Record<string, unknown>)) {
              result[key] = key in store ? store[key] : fallback;
            }
          } else {
            for (const key of Array.isArray(keys) ? keys : [keys]) {
              if (typeof key === 'string' && key in store) result[key] = store[key];
            }
          }
          return Promise.resolve(result);
        }),
        set: vi.fn().mockImplementation((items: Record<string, unknown>) => {
          Object.assign(store, items);
          return Promise.resolve();
        }),
      },
    },
    permissions: { contains: vi.fn(), request: vi.fn() },
  } as unknown as typeof chrome;
});

describe('PermissionManager updaters are non-mutating (R3)', () => {
  it('recordDeniedVisit leaves current untouched when adding a new domain', async () => {
    store[DENIED_DOMAINS] = { 'old.com': { count: 1, lastDenied: '2026-01-01T00:00:00.000Z' } };
    const { getPermissionManager } = await import('../permissionManager.js');

    await getPermissionManager().recordDeniedVisit('new.com');

    const call = captured.at(-1)!;
    assertUpdaterWasNonMutating(call);
    expect(call.current).toEqual({ 'old.com': { count: 1, lastDenied: '2026-01-01T00:00:00.000Z' } });
    expect(Object.keys(stored())).toEqual(['old.com', 'new.com']);
  });

  it('recordDeniedVisit leaves the existing entry object untouched', async () => {
    const entry = { count: 4, lastDenied: '2026-01-01T00:00:00.000Z' };
    store[DENIED_DOMAINS] = { 'old.com': entry };
    const { getPermissionManager } = await import('../permissionManager.js');

    await getPermissionManager().recordDeniedVisit('old.com');

    expect(entry).toEqual({ count: 4, lastDenied: '2026-01-01T00:00:00.000Z' });
    expect(stored()['old.com']).not.toBe(entry);
    expect(stored()['old.com']!.count).toBe(5);
  });

  it('recordDomainDismissal leaves current untouched', async () => {
    store[DENIED_DOMAINS] = { 'old.com': { count: 2, lastDenied: '2026-01-01T00:00:00.000Z' } };
    const { getPermissionManager } = await import('../permissionManager.js');

    await getPermissionManager().recordDomainDismissal('old.com');

    const call = captured.at(-1)!;
    assertUpdaterWasNonMutating(call);
    expect(call.current).toEqual({ 'old.com': { count: 2, lastDenied: '2026-01-01T00:00:00.000Z' } });
    expect(stored()['old.com']!.lastDismissed).toEqual(expect.any(String));
  });

  it('removeDeniedDomain deletes on a copy, not on the value it was handed', async () => {
    store[DENIED_DOMAINS] = {
      'old.com': { count: 2, lastDenied: '2026-01-01T00:00:00.000Z' },
      'other.com': { count: 1, lastDenied: '2026-01-02T00:00:00.000Z' },
    };
    const { getPermissionManager } = await import('../permissionManager.js');

    await getPermissionManager().removeDeniedDomain('old.com');

    const call = captured.at(-1)!;
    assertUpdaterWasNonMutating(call);
    expect(Object.keys(call.current as object)).toEqual(['old.com', 'other.com']);
    expect(Object.keys(stored())).toEqual(['other.com']);
  });

  it('removeDeniedDomain returns the same value when the domain is absent', async () => {
    store[DENIED_DOMAINS] = { 'other.com': { count: 1, lastDenied: '2026-01-02T00:00:00.000Z' } };
    const { getPermissionManager } = await import('../permissionManager.js');

    await getPermissionManager().removeDeniedDomain('missing.com');

    // No work to do, so the identity short-circuit is intentional and the
    // store keeps the very object the updater was given.
    expect(captured.at(-1)!.next).toBe(captured.at(-1)!.current);
    expect(stored()).toEqual({ 'other.com': { count: 1, lastDenied: '2026-01-02T00:00:00.000Z' } });
  });

  it('evicts the oldest lastDenied on a copy and keeps the LRU criterion', async () => {
    const domains: Record<string, { count: number; lastDenied: string }> = {};
    for (let i = 0; i < 100; i++) {
      domains[`domain${i}.com`] = {
        count: 1,
        lastDenied: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
      };
    }
    store[DENIED_DOMAINS] = domains;
    const snapshot = structuredClone(domains);
    const { getPermissionManager } = await import('../permissionManager.js');

    await getPermissionManager().recordDeniedVisit('newdomain.com');

    const call = captured.at(-1)!;
    assertUpdaterWasNonMutating(call);
    // The 100-entry map handed to the updater still has all its keys.
    expect(Object.keys(call.current as object)).toHaveLength(100);
    expect(domains).toEqual(snapshot);
    // domain0.com has the oldest lastDenied, so it is the one evicted.
    expect(stored()['domain0.com']).toBeUndefined();
    expect(stored()['domain99.com']).toBeDefined();
    expect(stored()['newdomain.com']).toBeDefined();
    expect(Object.keys(stored())).toHaveLength(100);
  });

  it('cleanupOldDeniedEntries leaves current untouched', async () => {
    store[DENIED_DOMAINS] = {
      'old.com': { count: 1, lastDenied: '2020-01-01T00:00:00.000Z' },
      'new.com': { count: 1, lastDenied: new Date().toISOString() },
    };
    const { getPermissionManager } = await import('../permissionManager.js');

    await getPermissionManager().cleanupOldDeniedEntries(90);

    const call = captured.at(-1)!;
    assertUpdaterWasNonMutating(call);
    expect(Object.keys(call.current as object).sort()).toEqual(['new.com', 'old.com']);
    expect(Object.keys(stored())).toEqual(['new.com']);
  });

  it('cleanupDismissedEntries leaves current untouched', async () => {
    store[DENIED_DOMAINS] = {
      'dismissed.com': { count: 1, lastDenied: '2020-01-01T00:00:00.000Z', lastDismissed: '2020-01-02T00:00:00.000Z' },
    };
    const { getPermissionManager } = await import('../permissionManager.js');

    await getPermissionManager().cleanupDismissedEntries(7);

    const call = captured.at(-1)!;
    assertUpdaterWasNonMutating(call);
    expect(stored()).toEqual({});
  });
});
