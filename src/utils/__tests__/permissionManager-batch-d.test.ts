/**
 * permissionManager-batch-d.test.ts — PBI 2026-11-08-16 (item 2) pins.
 *
 * The day arithmetic in cleanupOldDeniedEntries / cleanupDismissedEntries
 * shares the single MS_PER_DAY day unit instead of an inline
 * `24 * 60 * 60 * 1000` expression. These tests pin the retention boundary
 * at millisecond precision against the shared DAY_MS constant: an entry
 * 1ms inside the window survives, one 1ms outside is swept. Any literal
 * that disagrees with the shared unit by more than a millisecond fails.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTimerClock } from '../../../testDir/waitPolicy.js';
import { PermissionManager } from '../permissionManager.js';
import { DAY_MS } from '../localDate.js';
import { StorageKeys } from '../storage/types.js';

const store = new Map<string, unknown>();

function installChromeMock(): void {
  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn((keys: unknown) => {
          const keyArray = Array.isArray(keys) ? keys : [keys as string];
          const result: Record<string, unknown> = {};
          for (const key of keyArray) {
            if (store.has(key)) result[key] = store.get(key);
          }
          return Promise.resolve(result);
        }),
        set: vi.fn((items: unknown) => {
          for (const [key, value] of Object.entries(items as Record<string, unknown>)) {
            store.set(key, value);
          }
          return Promise.resolve();
        }),
        remove: vi.fn((keys: unknown) => {
          const keyArray = Array.isArray(keys) ? keys : [keys as string];
          for (const key of keyArray) store.delete(key);
          return Promise.resolve();
        }),
      },
    },
  };
}

const NOW = new Date('2026-06-15T12:00:00.000Z').getTime();

describe('PermissionManager shared day unit (PBI 2026-11-08-16 item 2)', () => {
  beforeEach(() => {
    store.clear();
    installChromeMock();
    useTimerClock();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('sweeps denied entries at exactly days * MS_PER_DAY (90-day boundary)', async () => {
    await store.set(StorageKeys.DENIED_DOMAINS, {
      'inside.example': { count: 5, lastDenied: new Date(NOW - 90 * DAY_MS + 1).toISOString() },
      'outside.example': { count: 5, lastDenied: new Date(NOW - 90 * DAY_MS - 1).toISOString() },
    });
    const manager = new PermissionManager();
    await manager.cleanupOldDeniedEntries(90);

    const remaining = store.get(StorageKeys.DENIED_DOMAINS) as Record<string, unknown>;
    expect(Object.keys(remaining)).toEqual(['inside.example']);
  });

  it('sweeps dismissed entries at exactly days * MS_PER_DAY (7-day boundary)', async () => {
    await store.set(StorageKeys.DENIED_DOMAINS, {
      'recent.example': {
        count: 5,
        lastDenied: new Date(NOW - 30 * DAY_MS).toISOString(),
        lastDismissed: new Date(NOW - 7 * DAY_MS + 1).toISOString(),
      },
      'old.example': {
        count: 5,
        lastDenied: new Date(NOW - 30 * DAY_MS).toISOString(),
        lastDismissed: new Date(NOW - 7 * DAY_MS - 1).toISOString(),
      },
    });
    const manager = new PermissionManager();
    await manager.cleanupDismissedEntries(7);

    const remaining = store.get(StorageKeys.DENIED_DOMAINS) as Record<string, unknown>;
    expect(Object.keys(remaining)).toEqual(['recent.example']);
  });
});
